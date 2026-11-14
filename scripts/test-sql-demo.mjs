/**
 * Agência de demonstração (14/11/2026) contra um Postgres real (PGlite) com o
 * esquema inteiro do initDB, chamando o código de produção e as rotas.
 *
 * Prova: criar a agência (idempotente, senha só na resposta, 2 etapas como
 * todo ADMIN); semear com as funções do sistema (contagens, razão batendo
 * com o saldo, nada sai: nenhuma chamada de rede); semear de novo não
 * duplica; apagar limpa só a demo; semear e apagar recusam agência sem
 * `demo`; os pontos de saída recusam a demo (CRM, nota, provedor de
 * cobrança fora do sandbox); as métricas da plataforma não contam a demo.
 *
 * Uso: node --no-warnings scripts/test-sql-demo.mjs
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { carregarAplicacao } from './carregar-initdb-isolado.mjs';

let total = 0;
function eq(a, b, label) { total++; assert.deepEqual(a, b, label); console.log(`PASS  ${label}`); }
function ok(c, label) { total++; assert.ok(c, label); console.log(`PASS  ${label}`); }
async function erro(p) { try { await p; return null; } catch (e) { return e; } }

// Cofre ligado: a chave do Asaas da demo é gravada cifrada, como em produção.
process.env.INTEGRACOES_MASTER_KEY = 'd'.repeat(64);
const pg = new PGlite();
{ const l = console.log; console.log = () => {}; await carregarAplicacao(pg).initDB(); console.log = l; }

const query = async (text, values) => {
  const r = values && values.length ? await pg.query(text, values) : (await pg.exec(text)).at(-1);
  return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

// Nenhuma chamada de rede pode acontecer.
const chamadas = [];
globalThis.fetch = async (url) => { chamadas.push(String(url)); throw new Error(`rede bloqueada no teste: ${url}`); };

const um = async (sql, v) => (await query(sql, v)).rows[0];
const { criarAgenciaDemo, situacaoDaDemo, CNPJ_DA_DEMO, EMAIL_DA_DEMO } = await import('../src/lib/demo/agencia-demo.ts');
const { semearDemo, apagarDadosDaDemo, contarDados } = await import('../src/lib/demo/semear-demo.ts');
const { recusaDoProvedorNaDemo, esquecerDemo } = await import('../src/lib/demo/saidas.ts');
const { cnpjValido } = await import('../src/lib/cliente-documento.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { prepararAgenciaNova } = await import('../src/lib/assistente-inicial-servidor.ts');
const pool = globalThis.__POOL_DE_TESTE__;

// ---- uma agência de verdade, que nada pode tocar ----
await query(`INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data) VALUES ('tX', 'x', 'Agência Real', '', 'basic', 'ativo', '{"id":"tX","nome":"Agência Real"}')`);
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, banco, data) VALUES ('x-cb', 'tX', 'Banco X', '', '{"nome":"Banco X","saldo_inicial":10,"saldo_atual":10}')`);
await query(`INSERT INTO clientes (id, tenant_id, nome, tipo, data) VALUES ('x-cli', 'tX', 'Cliente X', 'PF', '{}')`);
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', 'tX', '{"ativo":true,"webhook_url_crm":"https://crm.x"}')`);
const retratoX = async () => JSON.stringify(await contarDados(pool, 'tX'));
const antesX = await retratoX();

// ---- 1. Criar a agência ----
const hash = async s => `hash:${s.length}`;
const preparar = id => emTransacao(exec => prepararAgenciaNova(exec, id)).then(() => undefined);
const r1 = await criarAgenciaDemo(pool, { hashPassword: hash, prepararAgencia: preparar });
const T = r1.situacao.tenant.id;
ok(r1.criada && typeof r1.senha === 'string' && r1.senha.length === 20, 'cria a agência e devolve a senha uma vez');
ok(/[A-Z]/.test(r1.senha) && /[a-z]/.test(r1.senha) && /\d/.test(r1.senha) && /[^A-Za-z0-9]/.test(r1.senha), 'senha forte (maiúscula, minúscula, número, símbolo)');
const tenant = await um(`SELECT plano, cnpj, data FROM tenants WHERE id = $1`, [T]);
eq([tenant.plano, tenant.data.demo, tenant.data.fin_versao, tenant.data.nome], ['founder-pro', true, 'completa', 'Horizonte Viagens e Turismo (teste)'], 'tenant: founder-pro, demo, versão completa');
ok(cnpjValido(tenant.cnpj) && tenant.cnpj === CNPJ_DA_DEMO, 'CNPJ fictício com dígito válido');
const admin = await um(`SELECT data FROM usuarios WHERE tenant_id = $1`, [T]);
eq([admin.data.email, admin.data.perfil, Boolean(admin.data.totp_cofre || admin.data.totp_segredo)], [EMAIL_DA_DEMO, 'ADMIN', false], 'administrador ADMIN, sem autenticador: cadastra as 2 etapas no 1º acesso');
const texto = JSON.stringify((await query(`SELECT data FROM usuarios`)).rows) + JSON.stringify((await query(`SELECT data FROM audit_log`)).rows);
ok(!texto.includes(r1.senha), 'a senha não está gravada em lugar nenhum (usuário nem auditoria)');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM plano_contas WHERE tenant_id = $1`, [T])).n) > 10, 'plano de contas padrão pelo assistente inicial');
const r2 = await criarAgenciaDemo(pool, { hashPassword: hash });
eq([r2.criada, r2.senha, r2.situacao.tenant.id], [false, undefined, T], 'criar de novo: mostra a que existe, sem senha nova');

// ---- 2. Recusa agência sem demo ----
eq((await erro(semearDemo('tX')))?.status, 403, 'semear recusa agência sem demo');
eq((await erro(apagarDadosDaDemo('tX')))?.status, 403, 'apagar recusa agência sem demo');
eq(await retratoX(), antesX, 'agência real intacta');

// ---- 3. Semear ----
const t0 = Date.now();
const s1 = await semearDemo(T);
for (const p of s1.passos) console.log(`      ${p.ok ? 'ok ' : 'ERRO'} ${p.passo}: ${p.detalhe}`);
ok(s1.passos.length > 15 && s1.passos.every(p => p.ok), `todos os passos deram certo (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const n = s1.contagens;
eq([n.empresas, n.contas_bancarias, n.cartoes, n.clientes, n.fornecedores, n.vendas, n.usuarios, n.transferencias],
  [2, 5, 1, 7, 6, 15, 3, 2], 'contagens: 2 empresas, 5 contas, cartão, 7 clientes, 6 fornecedores, 15 vendas, 3 usuários, 2 transferências');
ok(n.contas_receber > 30 && n.contas_pagar > 30 && n.baixas > 20, `títulos e liquidações (${n.contas_receber} a receber, ${n.contas_pagar} a pagar, ${n.baixas} baixas)`);
ok(n.faturas >= 1 && n.faturas_fornecedor >= 1 && n.notas === 2 && n.cheques === 1, 'fatura do cliente, do fornecedor, duas notas de fora e um cheque');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM faturas WHERE tenant_id = $1 AND situacao = 'FECHADA'`, [T])).n) >= 1, 'fatura do corporativo fechada');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM venda_cancelamentos WHERE tenant_id = $1`, [T])).n), 2, 'dois cancelamentos parciais');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM reembolsos WHERE tenant_id = $1`, [T])).n) >= 1, 'reembolso do cancelamento');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM creditos_cliente WHERE tenant_id = $1`, [T])).n) >= 1, 'crédito do cliente');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM periodos_fechados WHERE tenant_id = $1`, [T])).n) === 1, 'caixa fechado');
eq((await um(`SELECT status FROM migracao_lotes WHERE tenant_id = $1`, [T])).status, 'ensaiado', 'mudança de sistema parada no ensaio');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM pedidos_aprovacao WHERE tenant_id = $1`, [T])).n) === 1, 'um pedido de aprovação');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM conferencias_operadora WHERE tenant_id = $1`, [T])).n) === 1, 'conferência de operadora');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM comissao_fechamentos WHERE tenant_id = $1`, [T])).n) >= 1, 'comissões fechadas');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM relatorios_agendados WHERE tenant_id = $1`, [T])).n) === 1, 'relatório agendado');
const difs = (await query(
  `SELECT c.id, ROUND((c.data->>'saldo_atual')::numeric * 100)::bigint - COALESCE(r.saldo_centavos, 0) AS d
     FROM contas_bancarias c LEFT JOIN razao_saldo_bancario r ON r.tenant_id = c.tenant_id AND r.conta_bancaria_id = c.id
    WHERE c.tenant_id = $1`, [T])).rows.filter(r => Number(r.d) !== 0);
eq(difs, [], 'razão bate com o saldo em todas as contas');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM razao_falhas WHERE tenant_id = $1`, [T])).n), 0, 'nenhuma falha no razão');
ok(/Asaas sandbox/.test(s1.cobrancas.aviso ?? ''), 'sem a chave do sandbox: cobranças puladas com o aviso');
eq(chamadas, [], 'nada saiu: nenhuma chamada de rede');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM cobrancas WHERE tenant_id = $1`, [T])).n), 0, 'nenhuma cobrança emitida');
ok((await situacaoDaDemo(pool)).dados.semeado_em, 'agência marcada como semeada');

// ---- 4. Semear de novo não duplica ----
const s2 = await semearDemo(T);
eq([s2.ja_estava, s2.contagens], [true, s1.contagens], 'semear de novo: nada muda');

// ---- 5. Saídas da demo ----
const { lerCrmConfig } = await import('../src/lib/crm-config-cofre.ts');
const { crmLigado } = await import('../src/lib/cobranca/crm.ts');
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo":true,"webhook_url_crm":"https://crm.y","api_key_crm":"k"}') ON CONFLICT DO NOTHING`, [T]).catch(() => null);
esquecerDemo();
eq(await lerCrmConfig(pool, T), null, 'CRM: a demo nunca tem integração (todo envio ao CRM lê por aqui)');
eq(await crmLigado(pool, T), false, 'CRM: e-mail/WhatsApp da cobrança não têm por onde sair');
ok((await lerCrmConfig(pool, 'tX'))?.webhook_url_crm === 'https://crm.x', 'agência real continua lendo a integração');
ok(await recusaDoProvedorNaDemo(pool, T, 'asaas', '$aact_prod_xyz'), 'cobrança: Asaas de produção recusado na demo');
ok(await recusaDoProvedorNaDemo(pool, T, 'pagarme', 'sk_live'), 'cobrança: Pagar.me recusado na demo');
eq(await recusaDoProvedorNaDemo(pool, T, 'asaas', '$aact_hmlg_xyz'), null, 'cobrança: Asaas sandbox liberado na demo');
eq(await recusaDoProvedorNaDemo(pool, 'tX', 'asaas', '$aact_prod_xyz'), null, 'agência real: provedor segue como sempre');
const { emitirNota } = await import('../src/lib/nfse-servico.ts');
const cr = await um(`SELECT id FROM contas_receber WHERE tenant_id = $1 LIMIT 1`, [T]);
ok(/demonstração/.test((await erro(emitirNota(T, cr.id, {}, { id: 'u', nome: 'u' })))?.message ?? ''), 'nota: emitir recusado na demo');

// ---- 6. Métricas da plataforma sem a demo ----
const { GET: metricas } = await import('../src/app/api/admin/metrics/route.ts');
globalThis.__SESSAO_DE_TESTE__ = { isSuperAdmin: true, userId: 'sa', tenantId: '__platform__' };
const m = await (await metricas()).json();
const reais = Number((await um(`SELECT COUNT(*)::int AS n FROM tenants WHERE COALESCE(data->>'demo','') <> 'true'`)).n);
eq([m.totalTenants, m.recentTenants.some(t => t.demo === true)], [reais, false], 'métricas: a demo não conta nem aparece');

// ---- 7. Apagar limpa só a demo ----
await query(`DELETE FROM crm_config WHERE tenant_id = $1`, [T]);
const ap = await apagarDadosDaDemo(T);
ok(ap.linhas > 100, `apagou ${ap.linhas} linhas da demo`);
const depois = await contarDados(pool, T);
eq(Object.entries(depois).filter(([k, v]) => v !== 0 && k !== 'usuarios'), [], 'demo sem dados');
eq(depois.usuarios, 1, 'fica só o administrador');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM razao_lancamentos WHERE tenant_id = $1`, [T])).n), 0, 'razão da demo apagado');
eq(await retratoX(), antesX, 'agência real intacta depois de apagar');
eq((await situacaoDaDemo(pool)).dados.semeado_em, null, 'marca de semeada removida');

// ---- 8. Criar de novo depois de apagar ----
const s3 = await semearDemo(T);
ok(s3.passos.every(p => p.ok) && s3.contagens.vendas === 15, 'recriar os dados depois de apagar funciona');

// ---- 9. Com a chave do Asaas sandbox: três cobranças de teste ----
const { salvarConfig } = await import('../src/lib/plataformas/servico.ts');
const { definirAmbienteDeCobranca } = await import('../src/lib/cobranca/http.ts');
const { gravarEmissao } = await import('../src/lib/cobranca/servidor.ts');
const asaas = { seq: 0, hosts: [] };
const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
definirAmbienteDeCobranca({
  fetch: async (url, init) => {
    const u = new URL(url);
    asaas.hosts.push(u.host);
    if (u.host !== 'api-sandbox.asaas.com') throw new Error(`fora do sandbox: ${url}`);
    const rota = u.pathname.replace('/v3', '');
    const metodo = init?.method ?? 'GET';
    const corpo = init?.body ? JSON.parse(init.body) : {};
    if (rota === '/customers' && metodo === 'GET') return resposta(200, { data: [] });
    if (rota === '/customers') return resposta(200, { id: `cus_${++asaas.seq}`, ...corpo });
    if (rota === '/payments' && metodo === 'GET') return resposta(200, { data: [], hasMore: false });
    if (rota === '/payments') return resposta(200, { id: `pay_${++asaas.seq}`, status: 'PENDING', value: corpo.value, dueDate: corpo.dueDate,
      billingType: corpo.billingType, externalReference: corpo.externalReference, invoiceUrl: `https://sandbox.asaas.com/i/${asaas.seq}`,
      bankSlipUrl: `https://sandbox.asaas.com/b/${asaas.seq}` });
    if (/\/identificationField$/.test(rota)) return resposta(200, { identificationField: '34191790010104351004791020150008291070026000', barCode: '34192910700260000' });
    if (/\/pixQrCode$/.test(rota)) return resposta(200, { payload: '00020101021226820014br.gov.bcb.pix', encodedImage: 'x' });
    if (metodo === 'GET') return resposta(200, { id: rota.split('/')[2], status: 'PENDING' });
    return resposta(404, { errors: [{ code: 'x', description: rota }] });
  },
  dormir: async () => {}, timeoutMs: 1000,
});
await apagarDadosDaDemo(T);
await salvarConfig(T, 'asaas', { ativo: true, conta_bancaria_id: '', emitir_nota: false, credencial: { api_key: '$aact_hmlg_demo', segredo_webhook: 'tok' } });
const s4 = await semearDemo(T);
ok(s4.passos.every(p => p.ok), 'semear com o sandbox: todos os passos');
eq([s4.cobrancas.emitidas, s4.cobrancas.aviso], [3, null], 'três cobranças de teste emitidas pelo caminho normal');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM cobrancas WHERE tenant_id = $1 AND provedor = 'asaas'`, [T])).n), 3, 'cobranças gravadas');
ok(asaas.hosts.length > 0 && asaas.hosts.every(h => h === 'api-sandbox.asaas.com'), 'só o sandbox foi chamado');
// Chave de produção na demo: nada sai.
await salvarConfig(T, 'asaas', { ativo: true, conta_bancaria_id: '', emitir_nota: false, credencial: { api_key: '$aact_prod_demo', segredo_webhook: 'tok' } });
const livre = await um(`SELECT id FROM contas_receber c WHERE tenant_id = $1 AND COALESCE(data->>'status','PENDENTE') = 'PENDENTE'
  AND COALESCE(data->>'cliente_id','') <> '' AND NOT EXISTS (SELECT 1 FROM cobrancas b WHERE b.tenant_id = c.tenant_id AND b.titulo_id = c.id)
  AND data->>'data_vencimento' > to_char(NOW(), 'YYYY-MM-DD') LIMIT 1`, [T]);
const antesHosts = asaas.hosts.length;
const e = await erro(gravarEmissao(T, { itens: [{ conta_id: livre.id }], provedor: 'asaas', tipo: 'boleto' }, {}));
const situacao = await um(`SELECT status, erro FROM cobrancas WHERE tenant_id = $1 AND titulo_id = $2`, [T, livre.id]);
ok((e && /demonstra/.test(e.message)) || (situacao && /demonstra/.test(String(situacao.erro))), 'Asaas de produção na demo: recusado');
eq(asaas.hosts.length, antesHosts, 'nenhuma chamada ao provedor de produção');

// ---- 10. As rotas: só o super admin, a senha nunca volta depois ----
const rotaDemo = await import('../src/app/api/admin/demo/route.ts');
const rotaDados = await import('../src/app/api/admin/demo/dados/route.ts');
globalThis.__SESSAO_DE_TESTE__ = { plataforma: 'CS', tenantId: '__platform__', userId: 'cs' };
eq([(await rotaDemo.GET()).status, (await rotaDemo.POST()).status, (await rotaDados.DELETE()).status], [403, 403, 403], 'rotas: CS recusado');
globalThis.__SESSAO_DE_TESTE__ = { userId: 'u', tenantId: T, perfil: 'ADMIN' };
eq((await rotaDados.POST(new Request('http://x', { method: 'POST', body: '{}' }))).status, 401, 'rotas: admin da própria demo não mexe pelo Super Admin');
globalThis.__SESSAO_DE_TESTE__ = { isSuperAdmin: true, userId: 'sa', tenantId: '__platform__' };
const g = await (await rotaDemo.GET()).json();
ok(g.existe && g.contagens.vendas === 15 && !JSON.stringify(g).includes('senha'), 'GET: situação e contagens, sem senha');
const p2 = await (await rotaDemo.POST()).json();
eq([p2.criada, 'senha' in p2], [false, false], 'POST de novo: não recria nem devolve senha');
const del = await rotaDados.DELETE();
eq([del.status, (await contarDados(pool, T)).vendas], [200, 0], 'DELETE apaga os dados da demo');

await pg.close();
console.log(`\n${total} verificações, todas passaram.`);
