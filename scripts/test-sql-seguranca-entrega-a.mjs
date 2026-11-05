/**
 * Entrega A da auditoria de segurança de 04/11/2026 (Financeiro), contra um
 * Postgres real (PGlite), rodando o código DE PRODUÇÃO.
 *
 * Cada bloco reproduz um ataque descrito na auditoria e prova que ele não
 * passa mais:
 *   FIN-04/11  chaves de API: a tela só vê máscara; no banco ficam cifradas
 *   FIN-02     uma agência não se liga à empresa fiscal de outra
 *   FIN-12     força bruta no login é cortada
 *   FIN-05     sessão de quem foi desativado, rebaixado ou saiu morre
 *   FIN-10     seed sem token de instalação não existe
 *
 * Uso: node --no-warnings scripts/test-sql-seguranca-entrega-a.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function erro(p) { try { await p; return null; } catch (e) { return e.constructor?.name || e.message; } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE config_fiscal (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE super_admins (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE tenants (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'ativo');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
const db = { query };

process.env.INTEGRACOES_MASTER_KEY = 'a'.repeat(64);
const C = await import('../src/lib/config-apis.ts');
const V = await import('../src/lib/vinculo-fiscal.ts');
const L = await import('../src/lib/limite-login.ts');
const S = await import('../src/lib/sessao-viva.ts');
const { seedAutorizado } = await import('../src/lib/seed-token.ts');
const F = await import('../src/lib/segundo-fator.ts');
const U = await import('../src/lib/usuarios-servico.ts');

console.log('--- FIN-04/11: chaves de API ---');
{
  // Registro antigo, em texto puro, como está hoje em produção.
  await query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ($1, 'ag-1', $2)`,
    [C.CONFIG_ID, JSON.stringify({ anthropic: { api_key: 'sk-ant-SEGREDO-1234', ativo: true, modelo: 'm' } })]);
  const lida = await C.lerConfigApis(db, 'ag-1');
  eq(lida.anthropic.api_key, 'sk-ant-SEGREDO-1234', 'servidor lê a chave antiga');
  const noBanco = (await query(`SELECT data FROM config_apis WHERE tenant_id='ag-1'`)).rows[0].data;
  eq(JSON.stringify(noBanco).includes('SEGREDO'), false, 'primeira leitura regrava cifrado: texto some do banco');
  eq(typeof noBanco.anthropic.api_key_cofre?.ct, 'string', 'envelope do cofre gravado');

  const tela = C.paraTela(await C.lerConfigApis(db, 'ag-1'));
  eq(JSON.stringify(tela).includes('SEGREDO'), false, 'tela nunca recebe a chave');
  eq(tela.anthropic.api_key_definida, true, 'tela sabe que existe chave');

  // A tela devolve a máscara: a chave continua a mesma.
  await C.salvarConfigApis(db, 'ag-1', { anthropic: { api_key: tela.anthropic.api_key, ativo: true } });
  eq((await C.lerConfigApis(db, 'ag-1')).anthropic.api_key, 'sk-ant-SEGREDO-1234', 'máscara de volta mantém a chave');
  await C.salvarConfigApis(db, 'ag-1', { anthropic: { api_key: 'sk-ant-NOVA-9999' } });
  eq((await C.lerConfigApis(db, 'ag-1')).anthropic.api_key, 'sk-ant-NOVA-9999', 'valor novo troca a chave');
  eq((await C.chaveAnthropic(db, 'ag-2', 'x')), null, 'outra agência não enxerga a chave');
  await C.salvarConfigApis(db, 'ag-1', { anthropic: { api_key_cofre: { v: 1, iv: 'x', tag: 'y', ct: 'z' } } });
  eq((await C.lerConfigApis(db, 'ag-1')).anthropic.api_key, 'sk-ant-NOVA-9999', 'corpo não grava envelope por conta própria');
  // Chave mestra trocada: a chave não decifra, mas também não pode sumir.
  process.env.INTEGRACOES_MASTER_KEY = 'b'.repeat(64);
  await C.salvarConfigApis(db, 'ag-1', { anthropic: { ativo: false } });
  process.env.INTEGRACOES_MASTER_KEY = 'a'.repeat(64);
  eq((await C.lerConfigApis(db, 'ag-1')).anthropic.api_key, 'sk-ant-NOVA-9999', 'falha ao decifrar não apaga a chave na gravação seguinte');
}

console.log('--- FIN-02: empresa fiscal tem dono único ---');
{
  await query(`INSERT INTO config_fiscal (id, tenant_id, data) VALUES ('cf','ag-1','{"empresa_id":501}'), ('cf','ag-2','{"empresa_id":502}')`);
  await pg.exec(V.VINCULO_FISCAL_SCHEMA_SQL);
  const donos = (await query(`SELECT empresa_id::int AS e, tenant_id FROM vinculo_fiscal ORDER BY 1`)).rows;
  eq(donos, [{ e: 501, tenant_id: 'ag-1' }, { e: 502, tenant_id: 'ag-2' }], 'quem já estava conectado vira dono');
  eq(await erro(V.garantirVinculoFiscal(db, 'ag-2', 501, '00')), 'ErroVinculoFiscal', 'ag-2 não toma a empresa da ag-1');
  eq(await erro(V.garantirVinculoFiscal(db, 'ag-1', 501)), null, 'dona reconecta normalmente');
  eq(await erro(V.garantirVinculoFiscal(db, 'ag-3', 777)), null, 'empresa nova ganha dono');
  eq(await erro(V.garantirVinculoFiscal(db, 'ag-1', 777)), 'ErroVinculoFiscal', 'e depois não muda de dono');
  eq(await erro(V.garantirVinculoFiscal(db, 'ag-1', -1)), 'ErroVinculoFiscal', 'id inválido recusado');
  await pg.exec(V.VINCULO_FISCAL_SCHEMA_SQL);
  eq((await query(`SELECT count(*)::int AS n FROM vinculo_fiscal`)).rows[0].n, 3, 'schema roda de novo sem duplicar');
}

console.log('--- FIN-12: limite de login ---');
{
  L.limparLimiteDeLoginParaTeste();
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) {
    L.bloqueioDeLogin('agencia', '1.1.1.1', 'vitima@x.com', t0);
    L.registrarFalhaDeLogin('agencia', 'vitima@x.com', '1.1.1.1', t0);
  }
  eq(L.bloqueioDeLogin('agencia', '1.1.1.1', 'vitima@x.com', t0) !== null, true, '8 senhas erradas do mesmo IP travam a conta para esse IP');
  eq(L.bloqueioDeLogin('agencia', '9.9.9.9', 'vitima@x.com', t0), null, 'a dona da conta, de outro IP, ainda entra');
  eq(L.bloqueioDeLogin('agencia', '1.1.1.1', 'vitima@x.com', t0 + 15 * 60_000 + 1), null, 'janela passou, libera');
  eq(L.bloqueioDeLogin('plataforma', '1.1.1.1', 'vitima@x.com', t0), null, 'escopos separados');
  L.limparLimiteDeLoginParaTeste();
  for (let i = 0; i < 100; i++) L.registrarFalhaDeLogin('agencia', 'alvo@x.com', `10.0.${i >> 8}.${i & 255}`, t0);
  eq(L.bloqueioDeLogin('agencia', '8.8.8.8', 'alvo@x.com', t0) !== null, true, 'força bruta espalhada em 100 IPs trava a conta');
  L.limparLimiteDeLoginParaTeste();
  let ultimo = null;
  for (let i = 0; i < 31; i++) ultimo = L.bloqueioDeLogin('agencia', '2.2.2.2', `conta${i}@x.com`, t0);
  eq(ultimo !== null, true, 'IP que testa muitas contas é cortado');
  eq(L.ipDoLogin(new Headers({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '6.6.6.6' })), '1.2.3.4', 'IP vem do proxy, não do X-Forwarded-For');
}

console.log('--- FIN-05: sessão revogável ---');
{
  await query(`INSERT INTO tenants (id, status) VALUES ('ag-1','ativo'), ('ag-susp','suspenso')`);
  const u = (id, tenant, extra = {}) => query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1,$2,$3)`,
    [id, tenant, JSON.stringify({ id, perfil: 'OPERADOR', ativo: true, ...extra })]);
  await u('op', 'ag-1');
  await u('inativo', 'ag-1', { ativo: false });
  await u('colab', 'ag-1', { perfil: 'COLABORADOR' });
  await u('susp', 'ag-susp');
  await query(`INSERT INTO super_admins (id, data) VALUES ('sa1', '{"ativo":true}'), ('sa2', '{"ativo":false}')`);

  const tv = await S.versaoAtualDaSessao({ userId: 'op', tenantId: 'ag-1' });
  eq(await S.sessaoViva({ userId: 'op', tenantId: 'ag-1', tv }), true, 'sessão válida passa');
  eq(await S.sessaoViva({ userId: 'op', tenantId: 'ag-2', tv }), false, 'mesmo id em outra agência não passa');
  eq(await S.sessaoViva({ userId: 'inativo', tenantId: 'ag-1', tv: 0 }), false, 'desativado não passa');
  eq(await S.sessaoViva({ userId: 'colab', tenantId: 'ag-1', tv: 0 }), false, 'perfil sem acesso não passa');
  eq(await S.sessaoViva({ userId: 'susp', tenantId: 'ag-susp', tv: 0 }), false, 'agência suspensa não passa');
  eq(await S.sessaoViva({ userId: 'fantasma', tenantId: 'ag-1', tv: 0 }), false, 'usuário apagado não passa');
  await S.revogarSessoes({ userId: 'op', tenantId: 'ag-1' });
  eq(await S.sessaoViva({ userId: 'op', tenantId: 'ag-1', tv }), false, 'depois de sair, o token antigo morre');
  const tv2 = await S.versaoAtualDaSessao({ userId: 'op', tenantId: 'ag-1' });
  eq(await S.sessaoViva({ userId: 'op', tenantId: 'ag-1', tv: tv2 }), true, 'login novo funciona');
  eq(await S.sessaoViva({ userId: 'sa1', isSuperAdmin: true, tv: 0 }), true, 'superadmin ativo passa');
  eq(await S.sessaoViva({ userId: 'sa2', isSuperAdmin: true, tv: 0 }), false, 'superadmin desativado não passa');
  eq(await S.sessaoViva({ userId: 'sa1', isSuperAdmin: true }), false, 'token antigo de superadmin (sem 2FA) cai');
  await u('op2', 'ag-1');
  eq(await S.sessaoViva({ userId: 'op2', tenantId: 'ag-1', perfil: 'OPERADOR' }), true, 'token antigo de operador segue valendo');
}

console.log('--- FIN-10: seed só com token de instalação ---');
{
  const req = h => new Request('http://x/api/auth/seed', { method: 'POST', headers: h });
  delete process.env.SEED_TOKEN;
  eq(seedAutorizado(req({ 'x-seed-token': '' })), false, 'sem SEED_TOKEN no servidor, rota fechada');
  process.env.SEED_TOKEN = 'curto';
  eq(seedAutorizado(req({ 'x-seed-token': 'curto' })), false, 'SEED_TOKEN curto não vale');
  process.env.SEED_TOKEN = 't'.repeat(40);
  eq(seedAutorizado(req({})), false, 'sem cabeçalho, recusa');
  eq(seedAutorizado(req({ 'x-seed-token': 't'.repeat(39) })), false, 'token errado, recusa');
  eq(seedAutorizado(req({ 'x-seed-token': 't'.repeat(40) })), true, 'token certo, passa');
}

console.log('--- FIN-12: segundo fator para administradores ---');
{
  // Vetor da RFC 6238 (SHA-1, segredo "12345678901234567890", T = 59 s).
  const rfc = F.base32(Buffer.from('12345678901234567890'));
  eq(F.codigoDoPasso(rfc, 1), '287082', 'código bate com a RFC 6238');
  eq(F.exigeSegundoFator('ADMIN'), true, 'ADMIN exige');
  eq(F.exigeSegundoFator('owner'), true, 'owner (ADMIN legado) exige');
  eq(F.exigeSegundoFator('VENDEDOR'), false, 'vendedor não exige');
  eq(F.exigeSegundoFator(undefined, true), true, 'superadmin exige');

  await query(`INSERT INTO usuarios (id, tenant_id, email, data) VALUES ('adm2fa','ag-1','a@x.com','{"id":"adm2fa","perfil":"ADMIN","ativo":true,"email":"a@x.com"}')`);
  const ler = async () => (await query(`SELECT data FROM usuarios WHERE id='adm2fa'`)).rows[0].data;
  const t = 1_700_000_000_000;
  let r = await F.etapaSegundoFator(db, 'usuarios', await ler(), {}, t);
  eq([r.ok, r.corpo?.precisa_cadastrar, r.contaComoFalha], [false, true, false], 'sem 2FA: oferece cadastro, não conta como falha');
  const segredo = r.corpo.segredo;
  r = await F.etapaSegundoFator(db, 'usuarios', await ler(), { segredo_novo: segredo, codigo: '000000' }, t);
  eq([r.ok, r.contaComoFalha], [false, true], 'cadastro com código errado não grava');
  eq(F.segredoGravado(await ler()), null, 'segredo continua vazio');
  const passo = Math.floor(t / 30000);
  r = await F.etapaSegundoFator(db, 'usuarios', await ler(), { segredo_novo: segredo, codigo: F.codigoDoPasso(segredo, passo) }, t);
  eq(r.ok, true, 'cadastro com código certo grava e entra');
  const gravado = await ler();
  eq(F.segredoGravado(gravado), segredo, 'segredo gravado no cofre');
  eq(JSON.stringify(gravado).includes(segredo), false, 'segredo não fica em texto no banco');

  r = await F.etapaSegundoFator(db, 'usuarios', gravado, {}, t + 60000);
  eq([r.ok, r.corpo?.precisa_codigo, r.contaComoFalha], [false, true, false], 'com 2FA: senha sozinha não entra');
  r = await F.etapaSegundoFator(db, 'usuarios', await ler(), { codigo: F.codigoDoPasso(segredo, passo) }, t + 1000);
  eq([r.ok, r.contaComoFalha], [false, true], 'código já usado não vale de novo');
  r = await F.etapaSegundoFator(db, 'usuarios', await ler(), { segredo_novo: F.gerarSegredo(), codigo: '123456' }, t + 60000);
  eq([r.ok, r.corpo?.precisa_codigo], [false, true], 'quem já tem 2FA não troca o segredo pelo login');
  r = await F.etapaSegundoFator(db, 'usuarios', await ler(), { codigo: F.codigoDoPasso(segredo, passo + 2) }, t + 60000);
  eq(r.ok, true, 'código seguinte entra');

  // "Sair" no meio de uma edição do admin não é desfeito pela edição.
  const antes = (await ler()).token_version ?? 0;
  const lidaAntes = await ler();
  await S.revogarSessoes({ userId: 'adm2fa', tenantId: 'ag-1' });
  await query(`INSERT INTO usuarios (id, tenant_id, email, data) VALUES ('adm-b','ag-1','b@x.com','{"id":"adm-b","perfil":"ADMIN","ativo":true}')`);
  await U.atualizarUsuario(db, { userId: 'adm-b', perfil: 'ADMIN' }, 'ag-1', 'adm2fa', { nome: 'Novo nome', ...lidaAntes });
  const depois = await ler();
  eq([depois.nome, depois.token_version], ['Novo nome', antes + 1], 'edição grava só o que mudou e mantém a revogação');
  eq(F.segredoGravado(depois), segredo, 'edição não apaga o 2FA');

  const lista = await U.listarUsuarios(db, { userId: 'x', perfil: 'ADMIN' }, 'ag-1');
  const item = lista.find(u => u.id === 'adm2fa');
  eq([item.tem_2fa, 'totp_cofre' in item, 'totp_ultimo_passo' in item, 'token_version' in item], [true, false, false, false], 'lista não expõe o segredo');
  await query(`UPDATE usuarios SET data = data || '{"vinculo":{"salario_base":9000}}'::jsonb WHERE id='op'`);
  const vistaDoVendedor = (await U.listarUsuarios(db, { userId: 'v', perfil: 'VENDEDOR' }, 'ag-1')).find(u => u.id === 'op');
  eq('vinculo' in vistaDoVendedor, false, 'vendedor não vê o salário dos outros');
  const vistaDoAdmin = (await U.listarUsuarios(db, { userId: 'x', perfil: 'ADMIN' }, 'ag-1')).find(u => u.id === 'op');
  eq(vistaDoAdmin.vinculo?.salario_base, 9000, 'admin vê a folha');
}

console.log('--- Sessão sem laço: a conferência consulta o banco como Sistema ---');
{
  // Em produção, cada consulta pede à auditoria quem está agindo, e a
  // auditoria pergunta a sessão. Se a conferência da sessão consultasse o
  // banco em nome da pessoa, pediria a sessão de novo, sem fim.
  const A = await import('../src/lib/audit-context.ts');
  const pool = globalThis.__POOL_DE_TESTE__;
  const original = pool.query;
  const atores = [];
  pool.query = async (text, values) => { atores.push((await A.getAuditContext()).source); return original(text, values); };
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ('op3', 'ag-1', '{"id":"op3","perfil":"OPERADOR","ativo":true}')`);
  const pessoa = { userId: 'op3', userName: 'Op', tenantId: 'ag-1', perfil: 'OPERADOR', source: 'USUARIO' };
  const viva = await A.runWithAuditContext(pessoa, () => S.sessaoViva({ userId: 'op3', tenantId: 'ag-1', tv: 0 }));
  pool.query = original;
  eq([viva, atores.length > 0, atores.every(a => a === 'SISTEMA')], [true, true, true], 'dentro do pedido da pessoa, a conferência lê o banco como Sistema');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
