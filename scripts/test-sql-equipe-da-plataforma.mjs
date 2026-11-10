/**
 * Equipe da plataforma (src/lib/equipe-da-plataforma.ts), a sessão viva do
 * CS (src/lib/sessao-viva.ts) e o login do painel (/api/admin/auth/login)
 * contra um Postgres real (PGlite). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) criar super admin e CS: senha provisória que entra, e-mail repetido
 *       (em qualquer caixa) recusado, nome/e-mail/papel inválidos recusados;
 *   (b) alterar: trocar papel, desativar e reativar, nova senha (a antiga
 *       para de valer), zerar o autenticador; cada uma sobe token_version;
 *   (c) travas: ninguém tira o próprio acesso; sempre sobra um super admin;
 *   (d) trocar a própria senha: confere a atual, exige 10 caracteres;
 *   (e) sessão viva: CS ativo vale; versão velha, desativado ou papel
 *       trocado no cadastro derrubam; super admin de antes continua valendo;
 *   (f) login do CS: pede o autenticador, cadastra, e o token sai com
 *       plataforma 'CS' e SEM isSuperAdmin; o do super admin sai com os dois.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-equipe-da-plataforma.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { decodeJwt } from 'jose';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function erro(p) { try { await p; return null; } catch (e) { return [e.status ?? null, e.message]; } }

process.env.JWT_SECRET = 'segredo-local-de-teste';
delete process.env.INTEGRACOES_MASTER_KEY; // segredo do autenticador em texto no teste

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE super_admins (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT,
    data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const db = { query };
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
// O pacote next não declara 'exports': fora do bundler, next/headers é com .js.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return n(s === 'next/headers' ? 'next/headers.js' : s, c); }`));

const E = await import('../src/lib/equipe-da-plataforma.ts');
const { sessaoViva } = await import('../src/lib/sessao-viva.ts');
const { verifyPassword } = await import('../src/lib/senha.ts');
const { codigoDoPasso } = await import('../src/lib/segundo-fator.ts');

const ler = async id => (await query(`SELECT data FROM super_admins WHERE id = $1`, [id])).rows[0].data;

// O super admin de hoje: cadastro antigo, sem papel nem token_version.
const { hashPassword } = await import('../src/lib/senha.ts');
await query(`INSERT INTO super_admins (id, email, nome, data) VALUES ('sa-bruno', 'Bruno@Entur.com.br', 'Bruno', $1::jsonb)`,
  [JSON.stringify({ id: 'sa-bruno', nome: 'Bruno', email: 'bruno@entur.com.br', senha_hash: await hashPassword('senha-do-bruno'), ativo: true })]);

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (a) criar ---');
const cs = await E.criarPessoaDaPlataforma(db, { nome: ' Carla CS ', email: ' Carla@Entur.com.br ', papel: 'CS' });
eq([cs.pessoa.nome, cs.pessoa.email, cs.pessoa.papel, cs.pessoa.ativo, cs.pessoa.autenticador], ['Carla CS', 'carla@entur.com.br', 'CS', true, false],
  'CS criada com nome e e-mail limpos, ativa e ainda sem autenticador');
eq([cs.senha.length, /^[A-Za-z2-9]{16}$/.test(cs.senha), /[0O1lI]/.test(cs.senha)], [16, true, false], 'senha provisória de 16 caracteres sem os que se confundem');
const dCs = await ler(cs.pessoa.id);
eq([await verifyPassword(cs.senha, dCs.senha_hash), dCs.senha_hash.includes(cs.senha), dCs.papel, dCs.token_version], [true, false, 'CS', 0], 'grava só o hash da senha, com papel CS');
const sa2 = await E.criarPessoaDaPlataforma(db, { nome: 'Dani', email: 'dani@entur.com.br', papel: 'SUPER_ADMIN' });
eq(sa2.pessoa.papel, 'SUPER_ADMIN', 'super admin criado');
eq(await erro(E.criarPessoaDaPlataforma(db, { nome: 'Outra', email: 'BRUNO@entur.com.br', papel: 'CS' })), [409, 'Já existe alguém da plataforma com este e-mail.'],
  'e-mail de quem já existe, em outra caixa, é recusado (inclusive o cadastro antigo com coluna em maiúscula)');
eq([
  (await erro(E.criarPessoaDaPlataforma(db, { nome: '', email: 'x@y.com', papel: 'CS' })))?.[1],
  (await erro(E.criarPessoaDaPlataforma(db, { nome: 'X', email: 'sem-arroba', papel: 'CS' })))?.[1],
  (await erro(E.criarPessoaDaPlataforma(db, { nome: 'X', email: 'x@y.com', papel: 'ADMIN' })))?.[1],
], ['Informe o nome.', 'Informe um e-mail válido.', 'Escolha o papel: Super admin ou CS.'], 'nome, e-mail e papel inválidos são recusados');
const lista = await E.listarEquipe(db);
eq(lista.map(p => [p.nome, p.papel]), [['Bruno', 'SUPER_ADMIN'], ['Carla CS', 'CS'], ['Dani', 'SUPER_ADMIN']], 'a lista tem o super admin de antes como super admin, a CS e o novo');
eq(lista.some(p => 'senha_hash' in p), false, 'a lista nunca leva o hash da senha');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) sessão viva, antes das mudanças ---');
const sessaoCs = { userId: cs.pessoa.id, plataforma: 'CS', tenantId: '__platform__', perfil: 'CS', tv: 0 };
eq(await sessaoViva(sessaoCs), true, 'sessão do CS ativa vale');
eq(await sessaoViva({ userId: 'sa-bruno', isSuperAdmin: true, tenantId: '__platform__', tv: 0 }), true, 'sessão do super admin de antes (sem papel no cadastro) continua valendo');
eq(await sessaoViva({ userId: cs.pessoa.id, isSuperAdmin: true, tenantId: '__platform__', tv: 0 }), false, 'token de super admin com o id de uma CS não vale');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) alterar ---');
let r = await E.alterarPessoaDaPlataforma(db, cs.pessoa.id, { papel: 'SUPER_ADMIN' }, 'sa-bruno');
eq([r.pessoa.papel, r.descricao, (await ler(cs.pessoa.id)).token_version], ['SUPER_ADMIN', ['papel: Super admin'], 1], 'CS vira super admin e a versão sobe');
const { esquecerSessaoEmCache } = await import('../src/lib/sessao-viva.ts');
esquecerSessaoEmCache({ userId: cs.pessoa.id, isSuperAdmin: true });
eq(await sessaoViva({ ...sessaoCs, tv: 1 }), false, 'a sessão de CS cai quando o cadastro virou super admin, mesmo com a versão nova');
r = await E.alterarPessoaDaPlataforma(db, cs.pessoa.id, { papel: 'CS' }, 'sa-bruno');
eq(r.pessoa.papel, 'CS', 'e volta a CS');
r = await E.alterarPessoaDaPlataforma(db, cs.pessoa.id, { ativo: false }, 'sa-bruno');
esquecerSessaoEmCache({ userId: cs.pessoa.id, isSuperAdmin: true });
eq([r.pessoa.ativo, await sessaoViva({ ...sessaoCs, tv: 3 })], [false, false], 'desativada: não entra, nem com a versão certa');
r = await E.alterarPessoaDaPlataforma(db, cs.pessoa.id, { ativo: true }, 'sa-bruno');
esquecerSessaoEmCache({ userId: cs.pessoa.id, isSuperAdmin: true });
eq([r.pessoa.ativo, await sessaoViva({ ...sessaoCs, tv: 3 }), await sessaoViva({ ...sessaoCs, tv: 4 })], [true, false, true], 'reativada: a sessão de antes não volta, a nova vale');
r = await E.alterarPessoaDaPlataforma(db, cs.pessoa.id, { nova_senha: true }, 'sa-bruno');
const dNova = await ler(cs.pessoa.id);
eq([typeof r.senha, await verifyPassword(r.senha, dNova.senha_hash), await verifyPassword(cs.senha, dNova.senha_hash)], ['string', true, false], 'nova senha: a provisória nova entra, a antiga não');
const senhaDaCarla = r.senha;
await query(`UPDATE super_admins SET data = data || '{"totp_segredo": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "totp_ultimo_passo": 1}'::jsonb WHERE id = $1`, [sa2.pessoa.id]);
r = await E.alterarPessoaDaPlataforma(db, sa2.pessoa.id, { zerar_autenticador: true }, 'sa-bruno');
const dZerado = await ler(sa2.pessoa.id);
eq([r.pessoa.autenticador, 'totp_segredo' in dZerado, 'totp_ultimo_passo' in dZerado], [false, false, false], 'zerar autenticador apaga o segredo: o próximo acesso cadastra de novo');
eq((await erro(E.alterarPessoaDaPlataforma(db, cs.pessoa.id, {}, 'sa-bruno')))?.[1], 'Nada para mudar.', 'pedido vazio não grava nada');
eq((await erro(E.alterarPessoaDaPlataforma(db, 'nao-existe', { ativo: false }, 'sa-bruno')))?.[0], 404, 'pessoa que não existe: 404');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) travas ---');
eq((await erro(E.alterarPessoaDaPlataforma(db, 'sa-bruno', { ativo: false }, 'sa-bruno')))?.[1], 'Você não pode tirar o próprio acesso. Peça a outro super admin.', 'ninguém se desativa');
eq((await erro(E.alterarPessoaDaPlataforma(db, 'sa-bruno', { papel: 'CS' }, 'sa-bruno')))?.[1], 'Você não pode tirar o próprio acesso. Peça a outro super admin.', 'ninguém se rebaixa a CS');
const dBrunoAntes = await ler('sa-bruno');
r = await E.alterarPessoaDaPlataforma(db, 'sa-bruno', { nova_senha: true }, 'sa-bruno');
eq(typeof r.senha, 'string', 'gerar a própria senha nova pode');
await query(`UPDATE super_admins SET data = $2::jsonb WHERE id = $1`, ['sa-bruno', JSON.stringify(dBrunoAntes)]);
r = await E.alterarPessoaDaPlataforma(db, sa2.pessoa.id, { ativo: false }, 'sa-bruno');
eq(r.pessoa.ativo, false, 'com dois super admins, um desativa o outro');
eq((await erro(E.alterarPessoaDaPlataforma(db, 'sa-bruno', { papel: 'CS' }, sa2.pessoa.id)))?.[1], 'A plataforma precisa de ao menos um super admin ativo.',
  'o último super admin ativo não vira CS (nem por outra pessoa)');
eq((await erro(E.alterarPessoaDaPlataforma(db, 'sa-bruno', { ativo: false }, cs.pessoa.id)))?.[1], 'A plataforma precisa de ao menos um super admin ativo.',
  'nem é desativado');
eq((await ler('sa-bruno')).ativo, true, 'e continua ativo');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) trocar a própria senha ---');
eq((await erro(E.trocarMinhaSenha(db, cs.pessoa.id, { senha_atual: 'errada', senha_nova: 'uma-senha-boa' })))?.[1], 'A senha atual não confere.', 'senha atual errada é recusada');
eq((await erro(E.trocarMinhaSenha(db, cs.pessoa.id, { senha_atual: senhaDaCarla, senha_nova: 'curta' })))?.[1], 'A senha nova precisa ter ao menos 10 caracteres.', 'senha curta é recusada');
const tvAntes = (await ler(cs.pessoa.id)).token_version;
await E.trocarMinhaSenha(db, cs.pessoa.id, { senha_atual: senhaDaCarla, senha_nova: 'carla-senha-nova' });
const dTrocada = await ler(cs.pessoa.id);
eq([await verifyPassword('carla-senha-nova', dTrocada.senha_hash), await verifyPassword(senhaDaCarla, dTrocada.senha_hash), dTrocada.token_version], [true, false, tvAntes + 1],
  'senha trocada: a nova entra, a provisória não, e as sessões caem');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) login do painel ---');
const { POST: entrar } = await import('../src/app/api/admin/auth/login/route.ts');
const pedido = corpo => new Request('http://localhost/api/admin/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 200) }, body: JSON.stringify(corpo),
});
let resp = await entrar(pedido({ email: 'carla@entur.com.br', senha: 'carla-senha-nova' }));
let corpo = await resp.json();
eq([resp.status, corpo.precisa_cadastrar, typeof corpo.segredo], [401, true, 'string'], 'CS sem autenticador: o login pede para cadastrar');
const segredo = corpo.segredo;
resp = await entrar(pedido({ email: 'carla@entur.com.br', senha: 'carla-senha-nova', segredo_novo: segredo, codigo: codigoDoPasso(segredo, Math.floor(Date.now() / 30000)) }));
corpo = await resp.json();
const tokenCs = (resp.headers.get('set-cookie') || '').match(/entur-session=([^;]+)/)?.[1];
const payloadCs = tokenCs ? decodeJwt(tokenCs) : {};
eq([resp.status, corpo.user?.perfil], [200, 'CS'], 'com o código, a CS entra');
eq([payloadCs.plataforma, payloadCs.perfil, payloadCs.tenantId, 'isSuperAdmin' in payloadCs], ['CS', 'CS', '__platform__', false],
  'o token da CS leva plataforma CS e NÃO leva isSuperAdmin');
eq(await sessaoViva(payloadCs), true, 'e a sessão emitida vale');
eq((await ler(cs.pessoa.id)).totp_segredo === segredo, true, 'o autenticador ficou cadastrado');

// Super admin, com o autenticador já cadastrado.
await query(`UPDATE super_admins SET data = data || '{"totp_segredo": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"}'::jsonb WHERE id = 'sa-bruno'`);
resp = await entrar(pedido({ email: 'bruno@entur.com.br', senha: 'senha-do-bruno', codigo: codigoDoPasso('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', Math.floor(Date.now() / 30000)) }));
const tokenSa = (resp.headers.get('set-cookie') || '').match(/entur-session=([^;]+)/)?.[1];
const payloadSa = tokenSa ? decodeJwt(tokenSa) : {};
eq([resp.status, payloadSa.isSuperAdmin, payloadSa.plataforma, payloadSa.perfil], [200, true, 'SUPER_ADMIN', 'SUPER_ADMIN'], 'o super admin entra com isSuperAdmin, como sempre');

// Desativado não entra.
resp = await entrar(pedido({ email: 'dani@entur.com.br', senha: sa2.senha }));
eq(resp.status, 401, 'super admin desativado não entra');

const auditoria = (await query(`SELECT acao, data->>'descricao' AS d FROM audit_log WHERE acao = 'LOGIN' ORDER BY created_at`)).rows.map(x => x.d);
eq(auditoria.includes('Entrou na administração da plataforma como CS.'), true, 'a auditoria registra a entrada da CS como CS');

console.log(`\n${total - falhas}/${total} testes da equipe da plataforma passaram`);
if (falhas > 0) process.exit(1);
