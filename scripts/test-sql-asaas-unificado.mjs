/**
 * Conexão Asaas unificada entre CRM e Financeiro (E7, 06/11/2026), contra um
 * Postgres real (PGlite), rodando as ROTAS e o código DE PRODUÇÃO com um Asaas
 * FALSO (como a documentação oficial) e um CRM de mentira num servidor HTTP
 * local que confere e assina como o CRM de verdade. Nenhuma chamada ao Asaas.
 *
 * O que se prova:
 *   (a) o plano: Asaas nos dois e na mesma conta = pode unificar, com o que
 *       muda; conta diferente, CRM fora do ar = bloqueado; agência sem CRM ou
 *       sem Asaas no CRM = nada a fazer (a tela não aparece);
 *   (b) antes de unificar, o CRM não usa a conexão daqui;
 *   (c) aplicar só com a assinatura do plano visto; CRM que recusa = nada
 *       muda (aviso daqui volta como era);
 *   (d) aplicado: o aviso daqui passa a avisar os eventos do CRM, o CRM foi
 *       mandado trocar, e o estado fica gravado com quem fez;
 *   (e) pedidos do CRM: lista fechada, assinatura com carimbo, resposta
 *       assinada, idempotência pela referência (cliente e cobrança não
 *       duplicam), cobrança que não é do CRM não aparece;
 *   (f) "nada sai" durante a mudança de sistema: criar para; ler segue;
 *   (g) disjuntor por agência × provedor: Asaas caindo para de ser chamado;
 *   (h) aviso de cobrança do CRM chega aqui, segue o caminho de sempre e vai
 *       ao CRM uma vez só; aviso do Financeiro (f1;) e agência sem
 *       unificação não vão;
 *   (i) desfazer: CRM fora do ar = continua unificado; CRM ok = volta tudo.
 *
 * Uso: node --no-warnings scripts/test-sql-asaas-unificado.mjs
 */
import { register } from 'node:module';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

process.env.INTEGRACOES_MASTER_KEY = 'd'.repeat(64);

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma, id_transacao));
  CREATE TABLE plataformas_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT false, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma));
  CREATE TABLE plataformas_eventos (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_externo TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', erro TEXT, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, plataforma, id_externo));
  CREATE TABLE plataformas_revisoes (tenant_id TEXT NOT NULL, chave TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'RODANDO', resultado JSONB NOT NULL DEFAULT '{}'::jsonb, executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, chave));
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE migracao_lotes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL);
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-asaas-unificado';

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL); // idempotente
await pg.exec(RAZAO_SCHEMA_SQL);

const { salvarConfig, processarEvento } = await import('../src/lib/plataformas/servico.ts');
const { adapterAsaas } = await import('../src/lib/plataformas/asaas.ts');
const { definirAmbienteDeCobranca } = await import('../src/lib/cobranca/http.ts');
const { zerarLimitador } = await import('../src/lib/cobranca/limitador.ts');
const { EVENTOS_QUE_O_CRM_USA } = await import('../src/lib/asaas-unificado/regras.ts');
const rotaPlano = await import('../src/app/api/plataformas/asaas-crm/route.ts');
const rotaCrm = await import('../src/app/api/v1/crm/webhook/[tenantId]/route.ts');

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('hex');
const um = async (sql, v) => (await query(sql, v)).rows[0];
const todos = async (sql, v) => (await query(sql, v)).rows;

// ---------------------------------------------------------------------------
// O Asaas falso (uma conta por chave; a carteira diz qual conta é)

const chamadas = [];
const asaasDb = { pagamentos: [], clientes: [], seq: 0 };
const contas = {
  '$aact_hmlg_agA': { carteira: 'wal_A', avisos: [
    { id: 'wh_fin_A', url: 'https://fin.exemplo.com/api/v1/plataformas/asaas/agA', enabled: true, interrupted: false, events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] },
    { id: 'wh_crm_A', url: 'https://crm.exemplo.com/api/webhooks/asaas-agencia/abc', enabled: true, interrupted: false, events: [...EVENTOS_QUE_O_CRM_USA] },
  ] },
  '$aact_hmlg_agB': { carteira: 'wal_B', avisos: [] },
};
const asaasFora = new Set();
const resposta = (status, corpo) => new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

async function asaas(conta, metodo, caminho, corpo) {
  if (asaasFora.has(conta)) return resposta(503, { errors: [{ code: 'x', description: 'instável' }] });
  const c = contas[conta];
  if (!c) return resposta(401, { errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }] });
  const [rota, qs] = caminho.split('?');
  const q = new URLSearchParams(qs ?? '');
  if (rota === '/wallets') return resposta(200, { object: 'list', data: [{ object: 'wallet', id: c.carteira }] });
  if (rota === '/webhooks' && metodo === 'GET') return resposta(200, { object: 'list', data: c.avisos });
  const wh = rota.match(/^\/webhooks\/([^/]+)$/);
  if (wh && metodo === 'PUT') {
    const a = c.avisos.find(x => x.id === wh[1]);
    if (!a) return resposta(404, { errors: [{ code: 'not_found', description: 'Webhook não encontrado' }] });
    Object.assign(a, corpo.events ? { events: corpo.events } : {}, corpo.enabled !== undefined ? { enabled: corpo.enabled } : {});
    return resposta(200, a);
  }
  if (rota === '/customers' && metodo === 'GET') return resposta(200, { data: asaasDb.clientes.filter(x => x.conta === conta && x.cpfCnpj === q.get('cpfCnpj')) });
  if (rota === '/customers' && metodo === 'POST') { const x = { id: `cus_${++asaasDb.seq}`, conta, deleted: false, ...corpo }; asaasDb.clientes.push(x); return resposta(200, x); }
  if (rota === '/payments' && metodo === 'POST') {
    const p = { object: 'payment', id: `pay_${++asaasDb.seq}`, conta, deleted: false, status: 'PENDING', value: corpo.value ?? corpo.totalValue, netValue: (corpo.value ?? corpo.totalValue) - 1.99,
      billingType: corpo.billingType, dueDate: corpo.dueDate, externalReference: corpo.externalReference, customer: corpo.customer, invoiceUrl: `https://sandbox.asaas.com/i/${asaasDb.seq}` };
    asaasDb.pagamentos.push(p);
    return resposta(200, p);
  }
  if (rota === '/payments' && metodo === 'GET') {
    const ext = q.get('externalReference'); const inst = q.get('installment');
    const data = asaasDb.pagamentos.filter(p => p.conta === conta && ((ext && p.externalReference === ext) || (inst && p.installment === inst)));
    return resposta(200, { object: 'list', data, totalCount: data.length, hasMore: false });
  }
  const m = rota.match(/^\/payments\/([^/]+)(\/[a-zA-Z]+)?$/);
  if (m) {
    const p = asaasDb.pagamentos.find(x => x.id === m[1] && x.conta === conta);
    if (!p) return resposta(404, { errors: [{ code: 'not_found', description: 'Cobrança não encontrada.' }] });
    if (m[2] === '/identificationField') return resposta(200, { identificationField: '0'.repeat(47), barCode: '0'.repeat(44) });
    if (m[2] === '/pixQrCode') return resposta(200, { payload: `pix-${p.id}`, encodedImage: 'x', expirationDate: '2027-01-01 23:59:59' });
    if (!m[2] && metodo === 'DELETE') { p.deleted = true; return resposta(200, { deleted: true, id: p.id }); }
    if (!m[2] && metodo === 'GET') return resposta(200, p);
  }
  return resposta(404, { errors: [{ code: 'not_found', description: `Rota ${metodo} ${rota}` }] });
}
let relogio = Date.parse('2026-11-06T13:00:00Z');
definirAmbienteDeCobranca({
  fetch: async (url, init) => {
    const u = new URL(url);
    if (u.host !== 'api-sandbox.asaas.com') throw new Error(`rede de verdade proibida no teste: ${url}`);
    const conta = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])).access_token;
    const metodo = init?.method ?? 'GET';
    const caminho = u.pathname.replace('/v3', '') + u.search;
    chamadas.push({ conta, metodo, caminho });
    return asaas(conta, metodo, caminho, init?.body ? JSON.parse(init.body) : undefined);
  },
  agora: () => relogio, dormir: async ms => { relogio += ms; }, timeoutMs: 1000,
});

// ---------------------------------------------------------------------------
// O CRM de mentira (confere a assinatura do Financeiro e assina a resposta)

const SEGREDO = 'segredo-da-agencia-a';
const crm = { conectado: true, carteira: 'wal_A', pelo_financeiro: false, aviso_automatico: true, fora: false, recusaUnificar: false };
const pedidosAoCrm = [];
const servidor = createServer((req, res) => {
  let corpo = '';
  req.on('data', c => { corpo += c; });
  req.on('end', () => {
    const json = JSON.parse(corpo);
    pedidosAoCrm.push({ tipo: json.tipo, payload: json.payload, assinaturaOk: req.headers['x-entur-signature'] === assinar(corpo, SEGREDO) });
    if (req.headers['x-entur-signature'] !== assinar(corpo, SEGREDO)) { res.writeHead(401); return res.end('{}'); }
    if (crm.fora) { res.writeHead(502); return res.end('{}'); }
    const conexao = () => ({ conectado: crm.conectado, ambiente: 'sandbox', chave_final: 'ab12', carteira: crm.carteira, aviso_automatico: crm.aviso_automatico, pelo_financeiro: crm.pelo_financeiro });
    let asaasResp = null;
    if (json.tipo === 'ASAAS_CONEXAO') asaasResp = conexao();
    if (json.tipo === 'ASAAS_UNIFICAR') {
      if (crm.recusaUnificar || json.payload.carteira !== crm.carteira) asaasResp = { ...conexao(), pelo_financeiro: false, motivo: 'carteira diferente' };
      else { crm.pelo_financeiro = true; asaasResp = { ...conexao(), aviso: 'desligado' }; }
    }
    if (json.tipo === 'ASAAS_DESUNIFICAR') { crm.pelo_financeiro = false; asaasResp = { ...conexao(), aviso: 'religado' }; }
    const resp = JSON.stringify(asaasResp ? { recebido: true, processado: true, acao: 'asaas', asaas: asaasResp } : { recebido: true, processado: true, acao: 'ok' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-crm-signature': assinar(resp, SEGREDO) });
    res.end(resp);
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;

// ---------------------------------------------------------------------------
// Agências: A usa CRM e Financeiro com a mesma conta; B usa só o Financeiro.

const A = 'agA', B = 'agB';
for (const t of [A, B]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, '{"nome":"Asaas","saldo_inicial":0,"saldo_atual":0}')`, [`${t}-asaas`, t]);
  await salvarConfig(t, 'asaas', { ativo: true, conta_bancaria_id: `${t}-asaas`, emitir_nota: false, credencial: { api_key: `$aact_hmlg_${t}`, segredo_webhook: 'tok' } });
}
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, $2::jsonb)`,
  [A, JSON.stringify({ ativo: true, webhook_url_crm: `http://127.0.0.1:${porta}/api/integracao-financeiro/webhook/77`, api_key_crm: SEGREDO, api_key_entur: SEGREDO })]);

const sessao = (t = A) => ({ userId: 'u-admin', nome: 'Ana Admin', email: 'a@x.com', perfil: 'ADMIN', permissoes: {}, tenantId: t, tenantSlug: t });
const pedir = (metodo, corpo) => new Request('http://localhost/api/plataformas/asaas-crm', { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const plano = async (t = A) => { globalThis.__SESSAO_DE_TESTE__ = sessao(t); return json(await rotaPlano.GET()); };
const acao = async (corpo, t = A) => { globalThis.__SESSAO_DE_TESTE__ = sessao(t); return json(await rotaPlano.POST(pedir('POST', corpo))); };

/** O CRM pedindo uma operação, assinada como o CRM assina (carimbo + corpo). */
async function crmPede(metodo, caminho, corpo, o = {}) {
  const carimbo = o.carimbo ?? String(Math.floor(Date.now() / 1000));
  const texto = JSON.stringify({ id: `op_${Math.random()}`, tipo: 'ASAAS_OPERACAO', payload: { metodo, caminho, ...(corpo === undefined ? {} : { corpo }) } });
  const cab = { 'Content-Type': 'application/json', 'x-crm-signature': assinar(o.semCarimbo ? texto : `${carimbo}.${texto}`, o.segredo ?? SEGREDO) };
  if (!o.semCarimbo) cab['x-crm-timestamp'] = carimbo;
  const r = await rotaCrm.POST(new Request('http://localhost/api/v1/crm/webhook/agA', { method: 'POST', headers: cab, body: texto }), { params: Promise.resolve({ tenantId: A }) });
  const corpoR = await r.text();
  return { status: r.status, corpo: JSON.parse(corpoR || '{}'), assinada: r.headers.get('x-entur-signature') === assinar(corpoR, SEGREDO) };
}
const avisoA = () => contas['$aact_hmlg_agA'].avisos.find(a => a.id === 'wh_fin_A');

// ═══════════════════════════════════════════════════════════════════════════
console.log('--- (a) o plano ---');
let p = await plano();
eq([p.status, p.corpo.situacao, p.corpo.financeiro.carteira, p.corpo.crm.carteira], [200, 'pode_unificar', 'wal_A', 'wal_A'], 'Asaas nos dois, mesma conta: pode unificar');
eq(p.corpo.eventos_a_incluir, ['PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_CHARGEBACK_REQUESTED'], 'o aviso daqui ganha os eventos que o CRM usa');
eq([p.corpo.passos.length >= 4, JSON.stringify(p.corpo).includes('$aact')], [true, false], 'o plano diz o que muda e nunca traz chave');
eq((await plano(B)).corpo.situacao, 'nada_a_fazer', 'agência sem CRM integrado: nada a fazer (o bloco não aparece)');
crm.carteira = 'wal_X';
p = await plano();
eq([p.corpo.situacao, p.corpo.bloqueios.some(b => b.includes('contas Asaas diferentes'))], ['bloqueado', true], 'CRM em outra conta Asaas: bloqueado');
const assinaturaBloqueada = p.corpo.assinatura;
crm.carteira = 'wal_A';
crm.fora = true;
p = await plano();
eq(p.corpo.situacao, 'bloqueado', 'CRM fora do ar: bloqueado, com o motivo');
crm.fora = false;
crm.conectado = false;
eq((await plano()).corpo.situacao, 'nada_a_fazer', 'CRM sem Asaas próprio: nada a unificar');
crm.conectado = true;

console.log('--- (b) antes de unificar o CRM não usa a conexão daqui ---');
let r = await crmPede('GET', '/payments/pay_x');
eq([r.status, r.corpo.codigo, r.assinada], [409, 'NAO_UNIFICADO', true], 'pedido do CRM sem unificação: recusado, resposta assinada');

console.log('--- (c) aplicar só com o plano visto; CRM que recusa não muda nada ---');
r = await acao({ acao: 'aplicar', assinatura: assinaturaBloqueada });
eq([r.status, r.corpo.codigo], [409, 'PLANO_MUDOU'], 'assinatura de um plano antigo: confere de novo');
p = await plano();
crm.recusaUnificar = true;
r = await acao({ acao: 'aplicar', assinatura: p.corpo.assinatura });
eq([r.status, r.corpo.codigo], [502, 'CRM_RECUSOU'], 'o CRM recusou: erro claro');
eq([avisoA().events, (await um(`SELECT ativo FROM asaas_unificacao WHERE tenant_id = $1`, [A])).ativo], [['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'], false], 'nada mudou: aviso daqui como era, unificação desligada');
crm.recusaUnificar = false;

console.log('--- (d) aplicado ---');
p = await plano();
r = await acao({ acao: 'aplicar', assinatura: p.corpo.assinatura });
eq([r.status, r.corpo.situacao, r.corpo.aviso_do_crm, crm.pelo_financeiro], [200, 'unificado', 'desligado', true], 'unificado; o CRM trocou e desligou o aviso dele');
eq(avisoA().events, ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_CHARGEBACK_REQUESTED'], 'o aviso daqui passou a avisar o que o CRM usa');
const est = await um(`SELECT ativo, aplicado_por_nome, eventos_incluidos, jsonb_array_length(historico) AS n FROM asaas_unificacao WHERE tenant_id = $1`, [A]);
eq([est.ativo, est.aplicado_por_nome, est.eventos_incluidos.length, est.n], [true, 'Ana Admin', 4, 2], 'estado gravado com quem fez e o histórico (recusa + unificação)');
eq(pedidosAoCrm.every(x => x.assinaturaOk), true, 'todo pedido ao CRM foi assinado');
r = await acao({ acao: 'aplicar', assinatura: r.corpo.assinatura });
eq(r.status, 409, 'aplicar de novo: já está unificado');

console.log('--- (e) pedidos do CRM ---');
const cliente = { name: 'Ana Lima', cpfCnpj: '12345678909', externalReference: 'p2;t=77;prop=9', notificationDisabled: true };
const c1 = await crmPede('POST', '/customers', cliente);
const c2 = await crmPede('POST', '/customers', cliente);
eq([c1.status, c1.assinada, c1.corpo.ok, c1.corpo.resposta.id === c2.corpo.resposta.id, asaasDb.clientes.length], [200, true, true, true, 1], 'cliente criado uma vez; o pedido repetido acha o mesmo');
const cobranca = { customer: c1.corpo.resposta.id, billingType: 'PIX', dueDate: '2026-11-09', value: 300, description: 'Sinal', externalReference: 'p2;t=77;pp=55' };
const k1 = await crmPede('POST', '/payments', cobranca);
const k2 = await crmPede('POST', '/payments', cobranca);
const posts = chamadas.filter(x => x.metodo === 'POST' && x.caminho === '/payments').length;
eq([k1.status, k1.corpo.resposta.id === k2.corpo.resposta.id, posts], [200, true, 1], 'cobrança: o pedido repetido (timeout, clique duplo) não cria a segunda');
const id = k1.corpo.resposta.id;
eq((await crmPede('GET', `/payments/${id}`)).corpo.resposta.externalReference, 'p2;t=77;pp=55', 'ler a cobrança');
eq((await crmPede('GET', `/payments/${id}/pixQrCode`)).corpo.resposta.payload, `pix-${id}`, 'o Pix copia e cola');
eq((await crmPede('GET', `/payments/${id}/identificationField`)).corpo.ok, true, 'a linha do boleto');
asaasDb.pagamentos.push({ id: 'pay_fin', conta: '$aact_hmlg_agA', externalReference: `f1;${A};cob_1`, status: 'PENDING', value: 10 });
r = await crmPede('GET', '/payments/pay_fin');
eq([r.status, r.corpo.codigo], [404, 'NAO_E_DO_CRM'], 'cobrança do Financeiro não aparece para o CRM');
r = await crmPede('DELETE', '/payments/pay_fin');
eq([r.status, asaasDb.pagamentos.find(x => x.id === 'pay_fin').deleted ?? false], [404, false], 'nem pode ser cancelada pelo CRM');
r = await crmPede('POST', '/payments', { ...cobranca, externalReference: `f1;${A};cob_2` });
eq([r.status, r.corpo.codigo], [400, 'RECUSADA'], 'o CRM não cria cobrança com a referência do Financeiro');
r = await crmPede('POST', '/payments', { ...cobranca, externalReference: 'p2;t=78;pp=1' });
eq([r.status, r.corpo.codigo], [400, 'RECUSADA'], 'nem com a referência de outra empresa do CRM');
r = await crmPede('GET', '/finance/balance');
eq([r.status, r.corpo.codigo], [400, 'RECUSADA'], 'saldo da conta: fora da lista');
eq((await crmPede('GET', `/payments/${id}`, undefined, { semCarimbo: true })).status, 401, 'pedido sem carimbo de tempo: recusado');
eq((await crmPede('GET', `/payments/${id}`, undefined, { carimbo: String(Math.floor(Date.now() / 1000) - 3600) })).status, 401, 'carimbo de uma hora atrás (repetição): recusado');
eq((await crmPede('GET', `/payments/${id}`, undefined, { segredo: 'outro' })).status, 401, 'assinatura com outro segredo: recusado');
r = await crmPede('DELETE', `/payments/${id}`);
eq([r.status, asaasDb.pagamentos.find(x => x.id === id).deleted], [200, true], 'cancelar a cobrança do CRM');
const k3 = await crmPede('POST', '/payments', cobranca);
eq([k3.status, k3.corpo.resposta.id !== id], [200, true], 'depois de cancelada, o mesmo pedido cria outra (o CRM trocou a forma de pagamento)');

console.log('--- (f) nada sai durante a mudança de sistema ---');
await query(`INSERT INTO migracao_lotes (id, tenant_id, status) VALUES ('l1', $1, 'aplicando')`, [A]);
r = await crmPede('POST', '/payments', { ...cobranca, externalReference: 'p2;t=77;pp=56' });
eq([r.status, r.corpo.codigo], [409, 'NADA_SAI'], 'criar cobrança: parado, com o motivo');
eq((await crmPede('GET', `/payments/${k3.corpo.resposta.id}`)).status, 200, 'ler segue funcionando');
await query(`DELETE FROM migracao_lotes`);

console.log('--- (g) disjuntor por agência × provedor ---');
zerarLimitador();
asaasFora.add('$aact_hmlg_agA');
for (let i = 0; i < 5; i++) await crmPede('GET', `/payments/${k3.corpo.resposta.id}`);
const antes = chamadas.length;
r = await crmPede('GET', `/payments/${k3.corpo.resposta.id}`);
eq([r.status, r.corpo.codigo, chamadas.length === antes], [503, 'DISJUNTOR', true], '5 falhas seguidas: o Financeiro para de chamar o Asaas desta agência');
asaasFora.clear();
await query(`DELETE FROM cobranca_disjuntor`);

console.log('--- (h) avisos do Asaas ---');
const semChave = { api_key: '', segredo_webhook: '', extras: {} };
const aviso = (idEv, pag, evento = 'PAYMENT_RECEIVED') => adapterAsaas.normalizar({ id: idEv, event: evento, payment: {
  customer: 'cus_1', value: 300, netValue: 298.01, billingType: 'PIX', status: 'RECEIVED', dueDate: '2026-11-09', dateCreated: '2026-11-06',
  paymentDate: '2026-11-06', clientPaymentDate: '2026-11-06', creditDate: '2026-11-06', description: 'Sinal', ...pag } }, semChave);
const avisosAoCrm = async t => (await todos(`SELECT data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = 'ASAAS_AVISO' ORDER BY created_at`, [t])).map(x => x.data.payload);
let ev = await processarEvento(A, 'asaas', await aviso('evt_1', { id: k3.corpo.resposta.id, externalReference: 'p2;t=77;pp=55' }));
let enviados = await avisosAoCrm(A);
eq([enviados.length, enviados[0]?.pagamento_id, enviados[0]?.referencia, enviados[0]?.evento], [1, k3.corpo.resposta.id, 'p2;t=77;pp=55', 'PAYMENT_RECEIVED'], 'aviso de cobrança do CRM: vai ao CRM');
eq(pedidosAoCrm.some(x => x.tipo === 'ASAAS_AVISO'), true, 'e foi entregue na hora (o CRM respondeu 200)');
await processarEvento(A, 'asaas', await aviso('evt_1', { id: k3.corpo.resposta.id, externalReference: 'p2;t=77;pp=55' }));
eq((await avisosAoCrm(A)).length, 1, 'o mesmo aviso reenviado pelo Asaas: não vai de novo');
// O caminho de sempre do aviso, congelado: o mesmo aviso numa agência sem
// unificação (B) dá a mesma resposta e o mesmo lançamento.
const evB = await processarEvento(B, 'asaas', await aviso('evt_b1', { id: 'pay_b1', externalReference: 'p2;t=77;pp=55' }));
eq([ev.acao, evB.acao], ['PAGAMENTO_RECEBIDO: 1 parcela(s), caixa +298.01, registrada como venda direta', 'PAGAMENTO_RECEBIDO: 1 parcela(s), caixa +298.01, registrada como venda direta'], 'o aviso aqui segue o caminho de sempre (mesma resposta com e sem unificação)');
eq((await avisosAoCrm(B)).length, 0, 'agência sem unificação: nada vai ao CRM');
await processarEvento(A, 'asaas', await aviso('evt_f1', { id: 'pay_fin', externalReference: `f1;${A};cob_1` }));
await processarEvento(A, 'asaas', await aviso('evt_venda', { id: 'pay_v', externalReference: 'pedido-loja-1' }));
eq((await avisosAoCrm(A)).length, 1, 'aviso de cobrança do Financeiro (f1;) e venda comum: não vão ao CRM');

console.log('--- (i) desfazer ---');
crm.fora = true;
r = await acao({ acao: 'desfazer' });
eq([r.status, r.corpo.codigo, (await um(`SELECT ativo FROM asaas_unificacao WHERE tenant_id = $1`, [A])).ativo], [502, 'CRM_RECUSOU', true], 'CRM fora do ar: continua unificado (o CRM não fica sem caminho)');
crm.fora = false;
r = await acao({ acao: 'desfazer' });
eq([r.status, r.corpo.situacao, crm.pelo_financeiro], [200, 'pode_unificar', false], 'desfeito: o CRM voltou para a conexão dele');
eq(avisoA().events, ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'], 'o aviso daqui voltou a avisar só o que avisava antes');
r = await crmPede('GET', `/payments/${k3.corpo.resposta.id}`);
eq([r.status, r.corpo.codigo], [409, 'NAO_UNIFICADO'], 'o CRM não usa mais a conexão daqui');
await processarEvento(A, 'asaas', await aviso('evt_2', { id: k3.corpo.resposta.id, externalReference: 'p2;t=77;pp=55' }, 'PAYMENT_REFUNDED'));
eq((await avisosAoCrm(A)).length, 1, 'avisos do CRM não são mais repassados (o aviso dele foi religado)');
eq((await acao({ acao: 'desfazer' })).status, 409, 'desfazer de novo: não está unificado');
globalThis.__SESSAO_DE_TESTE__ = { ...sessao(), perfil: 'VENDEDOR', permissoes: { editar_financeiro: false } };
eq((await rotaPlano.GET()).status, 403, 'sem permissão de configurar o financeiro: 403');

servidor.close();
console.log(`\n${total - falhas}/${total} testes da conexão Asaas unificada (SQL) passaram`);
if (falhas > 0) process.exit(1);
process.exit(0);
