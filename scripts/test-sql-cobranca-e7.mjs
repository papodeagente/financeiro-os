/**
 * Cobrança — fechamento de paridade (E7, 06/11/2026), contra um Postgres
 * real (PGlite), com os provedores FALSOS do teste da E3. Nada de rede.
 *
 * O que se prova:
 *   (1) pendência da baixa automática: marca, filtro "Com pendência", aviso
 *       no sino (uma vez), e as 3 escolhas (corrigir, crédito, resolvida);
 *   (9) taxa de boleto repassada: soma no boleto do cliente marcado, e no
 *       pagamento a conta da venda fecha pelo valor dela e a taxa vira conta
 *       própria (sem contar nada duas vezes);
 *   (11) envio com cópia, assunto e mensagem no COBRANCA_ENVIAR;
 *   (13) link de pagamento pela rota, no formato da tela.
 *
 * Uso: node --no-warnings scripts/test-sql-cobranca-e7.mjs
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
async function falha(p) { try { await p; return null; } catch (e) { return { status: e?.status ?? null, msg: e?.message ?? String(e) }; } }

process.env.INTEGRACOES_MASTER_KEY = 'c'.repeat(64);
process.env.PUBLIC_APP_URL = 'https://fin.exemplo.com';

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma, id_transacao));
  CREATE TABLE plataformas_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT false, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma));
  CREATE TABLE plataformas_eventos (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_externo TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', erro TEXT, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, plataforma, id_externo));
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
process.env.JWT_SECRET = 'segredo-de-teste-cobranca';

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL); // idempotente
await pg.exec(RAZAO_SCHEMA_SQL);
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { CREDITO_CLIENTE_SCHEMA_SQL } = await import('../src/lib/credito-cliente-servidor.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(CREDITO_CLIENTE_SCHEMA_SQL);

const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { salvarConfig, processarEvento } = await import('../src/lib/plataformas/servico.ts');
const { adapterAsaas } = await import('../src/lib/plataformas/asaas.ts');
const { adapterPagarme } = await import('../src/lib/plataformas/pagarme.ts');
const { definirAmbienteDeCobranca } = await import('../src/lib/cobranca/http.ts');
const { zerarLimitador } = await import('../src/lib/cobranca/limitador.ts');
const srv = await import('../src/lib/cobranca/servidor.ts');
const { rodarRegua, tarefaReguaCobranca } = await import('../src/lib/cobranca/regua.ts');

const fila = await import('../src/lib/agendador/fila.ts');
const { rodarAgendador } = await import('../src/lib/agendador/nucleo.ts');
const { comNadaSai } = await import('../src/lib/nada-sai.ts');

// ---------------------------------------------------------------------------
// Relógio falso e provedores simulados (respostas como a documentação).

let relogio = Date.parse('2026-11-05T13:00:00Z');
const chamadas = []; // { conta, metodo, caminho, t }
const comportamento = { asaasPostLento: 0, asaasFalhaAgencia: new Set(), pagarmeFalhaAgencia: new Set(), aoCriar: null };
const asaasDb = { clientes: [], pagamentos: [], seq: 0 };
const pagarmeDb = { clientes: [], cargas: [], seq: 0 };

function resposta(status, corpo, cabecalhos) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: cabecalhos });
}
function pagamentoAsaas(p) { return { object: 'payment', deleted: false, ...p }; }

async function asaas(conta, metodo, caminho, corpo) {
  if (comportamento.asaasFalhaAgencia.has(conta)) return resposta(503, { errors: [{ code: 'x', description: 'instável' }] });
  const [rota, qs] = caminho.split('?');
  const q = new URLSearchParams(qs ?? '');
  if (rota === '/customers' && metodo === 'GET') {
    const doc = q.get('cpfCnpj'); const ext = q.get('externalReference');
    return resposta(200, { data: asaasDb.clientes.filter(c => c.conta === conta && ((doc && c.cpfCnpj === doc) || (ext && c.externalReference === ext))) });
  }
  if (rota === '/customers' && metodo === 'POST') {
    const c = { id: `cus_${++asaasDb.seq}`, conta, ...corpo };
    asaasDb.clientes.push(c);
    return resposta(200, c);
  }
  if (rota === '/payments' && metodo === 'POST') {
    const p = pagamentoAsaas({
      id: `pay_${++asaasDb.seq}`, conta, customer: corpo.customer, value: corpo.value, netValue: Math.round((corpo.value - 1.99) * 100) / 100,
      billingType: corpo.billingType, status: 'PENDING', dueDate: corpo.dueDate, externalReference: corpo.externalReference,
      description: corpo.description, invoiceUrl: `https://sandbox.asaas.com/i/${asaasDb.seq}`, bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${asaasDb.seq}`,
    });
    asaasDb.pagamentos.push(p);
    if (comportamento.aoCriar) { const f = comportamento.aoCriar; comportamento.aoCriar = null; await f(p); }
    if (comportamento.asaasPostLento > 0) { comportamento.asaasPostLento--; return 'demorar'; }
    return resposta(200, p);
  }
  if (rota === '/payments' && metodo === 'GET') {
    const ext = q.get('externalReference'); const inst = q.get('installment');
    return resposta(200, { data: asaasDb.pagamentos.filter(p => p.conta === conta && ((ext && p.externalReference === ext) || (inst && p.installment === inst))), hasMore: false });
  }
  if (rota === '/installments' && metodo === 'POST') {
    const id = `inst_${++asaasDb.seq}`;
    for (let n = 1; n <= corpo.installmentCount; n++) {
      const d = new Date(`${corpo.dueDate}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n - 1);
      asaasDb.pagamentos.push(pagamentoAsaas({
        id: `pay_${++asaasDb.seq}`, conta, customer: corpo.customer, value: corpo.value, netValue: corpo.value - 1.99, billingType: 'BOLETO',
        status: 'PENDING', dueDate: d.toISOString().slice(0, 10), externalReference: corpo.paymentExternalReference, installment: id,
        installmentNumber: n, bankSlipUrl: `https://sandbox.asaas.com/b/pdf/p${n}`, invoiceUrl: `https://sandbox.asaas.com/i/p${n}`,
      }));
    }
    return resposta(200, { object: 'installment', id });
  }
  if (rota === '/paymentLinks' && metodo === 'POST') {
    const id = `lnk_${++asaasDb.seq}`;
    return resposta(200, { id, url: `https://sandbox.asaas.com/c/${id}`, name: corpo.name, externalReference: corpo.externalReference });
  }
  const m = rota.match(/^\/payments\/([^/]+)(\/[a-zA-Z]+)?$/);
  if (m) {
    const p = asaasDb.pagamentos.find(x => x.id === m[1] && x.conta === conta);
    if (!p) return resposta(404, { errors: [{ code: 'not_found', description: 'Cobrança não encontrada.' }] });
    if (m[2] === '/identificationField') return resposta(200, { identificationField: `0019000009${p.id.replace(/\D/g, '').padStart(5, '0')}88000219329781701878900000${String(Math.round(p.value * 100)).padStart(5, '0')}`.slice(0, 47).padEnd(47, '0'), nossoNumero: '1', barCode: '0'.repeat(44) });
    if (m[2] === '/pixQrCode') return resposta(200, { payload: `00020101021226820014br.gov.bcb.pix${p.id}`, encodedImage: 'x', expirationDate: '2027-01-01 23:59:59' });
    if (m[2] === '/refund') { p.status = 'REFUND_REQUESTED'; return resposta(200, p); }
    if (!m[2] && metodo === 'PUT') { p.value = corpo.value; p.dueDate = corpo.dueDate; return resposta(200, p); }
    if (!m[2] && metodo === 'DELETE') { p.deleted = true; return resposta(200, { deleted: true, id: p.id }); }
    if (!m[2] && metodo === 'GET') return resposta(200, p);
  }
  return resposta(404, { errors: [{ code: 'not_found', description: `Rota ${metodo} ${rota}` }] });
}

async function pagarme(conta, metodo, caminho, corpo) {
  if (comportamento.pagarmeFalhaAgencia.has(conta)) return resposta(500, { message: 'Internal Server Error' });
  const [rota, qs] = caminho.split('?');
  const q = new URLSearchParams(qs ?? '');
  if (rota === '/customers' && metodo === 'GET') return resposta(200, { data: pagarmeDb.clientes.filter(c => c.conta === conta && c.document === q.get('document')) });
  if (rota === '/customers' && metodo === 'POST') { const c = { id: `cus_${++pagarmeDb.seq}`, conta, ...corpo }; pagarmeDb.clientes.push(c); return resposta(200, c); }
  if (rota === '/orders' && metodo === 'POST') {
    const pag = corpo.payments[0];
    const ch = {
      id: `ch_${++pagarmeDb.seq}`, conta, code: corpo.code, amount: corpo.items[0].amount, status: 'pending', payment_method: pag.payment_method,
      last_transaction: pag.payment_method === 'pix'
        ? { transaction_type: 'pix', success: true, qr_code: `00020101021226840014br.gov.bcb.pix${pagarmeDb.seq}`, qr_code_url: `https://api.pagar.me/core/v1/transactions/tran_${pagarmeDb.seq}/qrcode`, expires_at: pag.pix.expires_at }
        : { transaction_type: 'boleto', success: true, line: '34191754622461578123441234510000383840000003090', pdf: `https://api.pagar.me/core/v1/transactions/tran_${pagarmeDb.seq}/pdf`, url: 'https://sandbox.pagar.me/Boleto/x', due_at: pag.boleto.due_at },
    };
    pagarmeDb.cargas.push(ch);
    return resposta(200, { id: `or_${pagarmeDb.seq}`, code: corpo.code, status: 'pending', charges: [ch] });
  }
  if (rota === '/charges' && metodo === 'GET') return resposta(200, { data: pagarmeDb.cargas.filter(c => c.conta === conta && c.code === q.get('code')) });
  const m = rota.match(/^\/charges\/([^/]+)(\/due-date)?$/);
  if (m) {
    const c = pagarmeDb.cargas.find(x => x.id === m[1] && x.conta === conta);
    if (!c) return resposta(404, { message: 'Charge not found.' });
    if (m[2] && metodo === 'PATCH') { c.last_transaction.due_at = corpo.due_at; return resposta(200, c); }
    if (metodo === 'DELETE') { c.status = 'canceled'; return resposta(200, c); }
    if (metodo === 'GET') return resposta(200, c);
  }
  return resposta(404, { message: `Rota ${metodo} ${rota}` });
}

const fetchFalso = async (url, init) => {
  const u = new URL(url);
  const cab = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const corpo = init?.body ? JSON.parse(init.body) : undefined;
  const metodo = init?.method ?? 'GET';
  let r;
  if (u.host === 'api-sandbox.asaas.com') {
    const conta = cab['access_token'];
    chamadas.push({ conta, metodo, caminho: u.pathname.replace('/v3', '') + u.search, t: relogio });
    r = await asaas(conta, metodo, u.pathname.replace('/v3', '') + u.search, corpo);
  } else if (u.host === 'api.pagar.me') {
    const conta = Buffer.from(String(cab['authorization']).replace('Basic ', ''), 'base64').toString().replace(/:$/, '');
    chamadas.push({ conta, metodo, caminho: u.pathname.replace('/core/v5', '') + u.search, t: relogio });
    r = await pagarme(conta, metodo, u.pathname.replace('/core/v5', '') + u.search, corpo);
  } else {
    throw new Error(`rede de verdade proibida no teste: ${url}`);
  }
  if (r === 'demorar') {
    return new Promise((_, rejeitar) => init?.signal?.addEventListener('abort', () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  }
  return r;
};
definirAmbienteDeCobranca({ fetch: fetchFalso, agora: () => relogio, dormir: async ms => { relogio += ms; }, timeoutMs: 30 });
globalThis.fetch = async url => { throw new Error(`rede de verdade proibida no teste: ${url}`); };

// ---------------------------------------------------------------------------
// Agências

const A = 'agA', B = 'agB';
const HOJE = '2026-11-05';
const um = async (sql, v) => (await query(sql, v)).rows[0];
const todos = async (sql, v) => (await query(sql, v)).rows;
const saldo = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id])).s);
const conta = async id => (await um(`SELECT data FROM contas_receber WHERE id = $1`, [id])).data;
const cob = async id => srv.carregarCobranca(pool, (await um(`SELECT tenant_id FROM cobrancas WHERE id = $1`, [id])).tenant_id, id);
const cr = (t, id, cliente, d) => query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1, $2, $3, 'PENDENTE', $4)`,
  [id, t, cliente, JSON.stringify({ id, cliente_id: cliente, cliente_nome: 'Ana Lima', descricao: `Pacote ${id}`, status: 'PENDENTE', valor_final: 150, data_vencimento: '2026-11-20', ...d })]);
const cli = (t, id, doc, d = {}) => query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data, external_id) VALUES ($1, $2, 'Ana Lima', $3, $4, $5)`,
  [id, t, doc, JSON.stringify({ email: 'ana@exemplo.com', whatsapp: '11988887777', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP', ...d }), `crm_contact_${id}`]);
const config = (t, c) => query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, $3)`, [`ag-${t}`, t, JSON.stringify({ cobranca: c, politica_cobranca: { juros_am_pct: 1, multa_pct: 2 } })]);
const semChave = { api_key: '', segredo_webhook: '', extras: {} };
const eventosCrm = async (t, tipo) => (await todos(`SELECT data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = $2 ORDER BY created_at, id`, [t, tipo])).map(r => r.data.payload);

for (const t of [A, B]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, '{"nome":"Conta Asaas","saldo_inicial":0,"saldo_atual":0}'), ($3, $2, '{"nome":"Conta Pagar.me","saldo_inicial":0,"saldo_atual":0}')`, [`${t}-asaas`, t, `${t}-pg`]);
  await emTransacao(exec => abrirRazaoNoExecutor(exec, t));
  await cli(t, `${t}-cli`, '12345678909');
  await salvarConfig(t, 'asaas', { ativo: true, conta_bancaria_id: `${t}-asaas`, emitir_nota: false, credencial: { api_key: `$aact_hmlg_${t}`, segredo_webhook: 'tok' } });
  await salvarConfig(t, 'pagarme', { ativo: true, conta_bancaria_id: `${t}-pg`, emitir_nota: false, credencial: { api_key: `sk_test_${t}` } });
}
await config(A, { provedor_padrao: 'asaas', regua: { ligada: true, dias: [-5, 0, 1, 3, 7], canais: ['email', 'whatsapp'] } });
await config(B, { provedor_padrao: 'pagarme', tipo_padrao: 'boleto' });

const round2 = n => Math.round(n * 100) / 100;
const avisoAsaas = (evento, c, status, extra = {}) => adapterAsaas.normalizar({
  id: `evt_${evento}_${c.id_externo}_${extra.sufixo ?? ''}`, event: evento,
  payment: { ...asaasDb.pagamentos.find(p => p.id === c.id_externo), status, paymentDate: '2026-11-06', clientPaymentDate: '2026-11-06', creditDate: '2026-11-06', ...extra },
}, semChave);
const emitir = async (id, extra = {}) => (await srv.gravarEmissao(A, { itens: [{ conta_id: id }], ...extra }, { hoje: HOJE })).cobrancas[0];
const sessao = (perfil, t = A) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: t, tenantSlug: t });
const pedir = (metodo, url, corpo, cab = {}) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...cab }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const notificacoes = async (t, tipo) => Number((await um(`SELECT COUNT(*)::int AS n FROM notificacoes WHERE tenant_id = $1 AND tipo = $2`, [t, tipo])).n);
await cli(A, `${A}-cli2`, '98765432100');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');

console.log('--- (9) Taxa de boleto repassada ao cliente marcado ---');
await query(`UPDATE agencia SET data = jsonb_set(data, '{cobranca,taxa_boleto_centavos}', '350') WHERE tenant_id = $1`, [A]);
const rotaTaxa = await import('../src/app/api/cobrancas/cliente-taxa/route.ts');
let tx = await json(await rotaTaxa.GET(pedir('GET', `/api/cobrancas/cliente-taxa?cliente_id=${A}-cli`)));
eq([tx.status, tx.corpo.cobrar_taxa_boleto, tx.corpo.taxa_boleto], [200, false, 3.5], 'cliente sem a marca; taxa da agência em reais');
tx = await json(await rotaTaxa.PUT(pedir('PUT', '/api/cobrancas/cliente-taxa', { cliente_id: `${A}-cli`, cobrar_taxa_boleto: true })));
eq([tx.status, tx.corpo.cobrar_taxa_boleto], [200, true], 'marca "Repassar a taxa do boleto" gravada no cadastro');
await cr(A, 't1', `${A}-cli`, { valor_final: 100 });
await cr(A, 't2', `${A}-cli2`, { valor_final: 100, cliente_nome: 'Bruno' });
await cr(A, 't3', `${A}-cli`, { valor_final: 100 });
const pvT = await srv.previaDaEmissao(pool, A, { itens: [{ conta_id: 't1' }, { conta_id: 't2' }] }, HOJE);
eq(pvT.itens.map(i => [i.conta_id, i.valor_centavos, i.taxa_boleto_centavos ?? 0, i.avisos.some(a => a.includes('taxa de boleto'))]),
  [['t1', 10350, 350, true], ['t2', 10000, 0, false]], 'prévia: só o cliente marcado leva a taxa, com aviso');
const pvPix = await srv.previaDaEmissao(pool, A, { itens: [{ conta_id: 't3' }], tipo: 'pix' }, HOJE);
eq(pvPix.itens[0].valor_centavos, 10000, 'Pix puro não leva taxa de boleto');
let ct1 = await emitir('t1');
eq([ct1.valor_centavos, ct1.dados.taxa_boleto_centavos, asaasDb.pagamentos.find(p => p.id === ct1.id_externo).value], [10350, 350, 103.5], 'boleto emitido com a taxa somada');
eq((await conta('t1')).valor_final, 100, 'a conta da venda não muda');
const saldoT = await saldo(`${A}-asaas`);
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', ct1, 'RECEIVED'));
ct1 = await cob(ct1.id);
const dT1 = await conta('t1');
const dTaxa = await conta(`taxa-boleto-${ct1.id}`);
eq([dT1.status, dT1.valor_recebido, dT1.taxa, dT1.juros], ['RECEBIDO', 100, 1.99, 0], 'pagamento: a conta da venda fecha pelo valor dela (sem virar juros), com a taxa do provedor');
eq([dTaxa.status, dTaxa.valor_recebido, dTaxa.origem, dTaxa.taxa_boleto_de, dTaxa.cliente_id, Boolean(dTaxa.categoria_id)],
  ['RECEBIDO', 3.5, 'OUTROS', ct1.id, `${A}-cli`, true], 'a taxa de boleto vira conta própria, recebida, na categoria de taxa de cobrança');
const catTaxa = await um(`SELECT data->>'nome' AS nome FROM plano_contas WHERE id = $1`, [dTaxa.categoria_id]);
eq(catTaxa?.nome, 'Taxas de cobrança', 'categoria = a de taxa de cobrança (encargos)');
eq(await saldo(`${A}-asaas`), round2(saldoT + 103.5), 'o caixa recebeu o boleto inteiro uma vez');
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', ct1, 'RECEIVED', { sufixo: 'de-novo' }));
eq([(await todos(`SELECT 1 FROM baixas WHERE tenant_id = $1 AND titulo_id = ANY($2::text[]) AND tipo = 'baixa'`, [A, ['t1', `taxa-boleto-${ct1.id}`]])).length, await saldo(`${A}-asaas`)],
  [2, round2(saldoT + 103.5)], 'aviso repetido: nada em dobro (nem a conta da taxa)');

console.log('--- (1) Pendência: conta baixada à mão antes do aviso ---');
await cr(A, 'p1', `${A}-cli2`, { valor_final: 80, cliente_nome: 'Bruno' });
let cp1 = await emitir('p1');
await query(`UPDATE contas_receber SET data = data || '{"status":"RECEBIDO","valor_recebido":80,"data_recebimento":"2026-11-05"}'::jsonb WHERE id = 'p1'`);
const saldoP = await saldo(`${A}-asaas`);
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp1, 'RECEIVED'));
cp1 = await cob(cp1.id);
eq([cp1.status, cp1.baixa_id, Boolean(cp1.dados.pendencia), cp1.dados.pendencia_tipo, cp1.dados.pendencia_pagamento?.valor_centavos, cp1.pago_centavos],
  ['paga', null, true, 'pagamento', 8000, 8000], 'aviso pago sem baixa: pendência anotada com o pagamento guardado');
eq(await saldo(`${A}-asaas`), saldoP, 'nada entrou no caixa sozinho');
eq(await notificacoes(A, 'COBRANCA_PENDENCIA'), 1, 'aviso no sino');
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp1, 'RECEIVED', { sufixo: 'reenvio' }));
eq(await notificacoes(A, 'COBRANCA_PENDENCIA'), 1, 'o provedor repetindo o aviso não repete o sino');
const lp = await srv.listarCobrancas(pool, A, { pendencia: true }, null);
eq([lp.total, lp.itens[0]?.id, lp.pendencias.quantidade, lp.pendencias.valor], [1, cp1.id, 1, 80], 'filtro "Com pendência" e contagem');
eq((await srv.listarCobrancas(pool, A, { status: ['em_aberto'] }, null)).pendencias.quantidade, 1, 'a contagem vale sem o filtro de situação (para o aviso da tela)');
const rotaLista = await import('../src/app/api/cobrancas/route.ts');
const rl = await json(await rotaLista.GET(pedir('GET', '/api/cobrancas?pendencia=1')));
eq([rl.status, rl.corpo.cobrancas.length, typeof rl.corpo.cobrancas[0]?.pendencia, rl.corpo.pendencias?.quantidade], [200, 1, 'string', 1], 'GET ?pendencia=1 com a frase na linha');
const rotaPend = await import('../src/app/api/cobrancas/[id]/pendencia/route.ts');
let pl = await json(await rotaPend.GET(pedir('GET', `/api/cobrancas/${cp1.id}/pendencia`), params(cp1.id)));
eq([pl.status, pl.corpo.escolhas?.corrigir.pode, pl.corpo.escolhas?.credito.pode, pl.corpo.escolhas?.credito.credito, pl.corpo.escolhas?.ignorar.pode],
  [200, false, true, 80, true], 'conta já recebida: corrigir não; crédito do pagamento inteiro; resolvida');
let rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp1.id}/pendencia`, { escolha: 'corrigir' }, { 'Idempotency-Key': 'p1-a' }), params(cp1.id)));
eq(rs.status, 409, 'corrigir numa conta já recebida: recusa com a frase');
rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp1.id}/pendencia`, { escolha: 'credito' }, { 'Idempotency-Key': 'p1-b' }), params(cp1.id)));
cp1 = await cob(cp1.id);
eq([rs.status, Boolean(cp1.dados.pendencia), cp1.dados.pendencia_resolvida?.escolha], [200, false, 'credito'], 'crédito: pendência resolvida');
const cred1 = await um(`SELECT origem, origem_ref, valor_centavos::int AS v, saldo_centavos::int AS s, cliente_id FROM creditos_cliente WHERE id = $1`, [rs.corpo.credito_id]);
eq(cred1, { origem: 'SOBRA_DE_PAGAMENTO', origem_ref: `cobranca:${cp1.id}`, v: 8000, s: 8000, cliente_id: `${A}-cli2` }, 'crédito de R$ 80 na carteira do cliente');
const dCred = await conta(`credito-cobranca-${cp1.id}`);
eq([dCred?.status, dCred?.origem, await saldo(`${A}-asaas`)], ['RECEBIDO', 'CREDITO_CLIENTE', round2(saldoP + 80)], 'o dinheiro entrou no caixa por uma conta própria (não é receita)');
const rs2 = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp1.id}/pendencia`, { escolha: 'credito' }, { 'Idempotency-Key': 'p1-b' }), params(cp1.id)));
eq([rs2.status, rs2.corpo.repetido, rs2.corpo.credito_id], [200, true, rs.corpo.credito_id], 'a mesma chave repetida: devolve o que foi feito');
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp1, 'RECEIVED', { sufixo: 'depois' }));
eq([await saldo(`${A}-asaas`), (await srv.listarCobrancas(pool, A, { pendencia: true }, null)).total], [round2(saldoP + 80), 0], 'aviso repetido depois de resolvida: não baixa de novo nem volta a marcar');

console.log('--- (1) Corrigir a baixa e crédito da sobra ---');
await cr(A, 'p2', `${A}-cli2`, { valor_final: 60, cliente_nome: 'Bruno' });
await cr(A, 'p3', `${A}-cli2`, { valor_final: 50, cliente_nome: 'Bruno' });
let cp2 = await emitir('p2');
const cp3 = await emitir('p3');
await query(`UPDATE contas_receber SET data = data || '{"status":"CANCELADO"}'::jsonb WHERE id = ANY($1::text[])`, [['p2', 'p3']]);
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp2, 'RECEIVED'));
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp3, 'RECEIVED'));
eq((await srv.listarCobrancas(pool, A, { pendencia: true }, null)).total, 2, 'conta cancelada no aviso: duas pendências');
await query(`UPDATE contas_receber SET data = data || '{"status":"PENDENTE"}'::jsonb WHERE id = 'p2'`);
await query(`UPDATE contas_receber SET data = data || '{"status":"PENDENTE","valor_final":40}'::jsonb WHERE id = 'p3'`);
pl = await json(await rotaPend.GET(pedir('GET', `/api/cobrancas/${cp2.id}/pendencia`), params(cp2.id)));
eq([pl.corpo.escolhas?.corrigir.pode, pl.corpo.escolhas?.credito.pode], [true, false], 'conta reaberta sem sobra: corrigir sim, crédito não');
rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp2.id}/pendencia`, { escolha: 'corrigir' }, { 'Idempotency-Key': 'p2-a' }), params(cp2.id)));
cp2 = await cob(cp2.id);
const dP2 = await conta('p2');
eq([rs.status, Boolean(cp2.baixa_id), cp2.baixa_id === rs.corpo.baixa_id, dP2.status, dP2.valor_recebido, dP2.taxa, dP2.data_recebimento],
  [200, true, true, 'RECEBIDO', 60, 1.99, '2026-11-06'], 'corrigir: baixa com o valor, a taxa e a data do aviso; ligada à cobrança');
pl = await json(await rotaPend.GET(pedir('GET', `/api/cobrancas/${cp3.id}/pendencia`), params(cp3.id)));
eq([pl.corpo.escolhas?.credito.pode, pl.corpo.escolhas?.credito.credito], [true, 10], 'conta que encolheu: sobra de R$ 10 para crédito');
rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp3.id}/pendencia`, { escolha: 'credito' }, { 'Idempotency-Key': 'p3-a' }), params(cp3.id)));
const dP3 = await conta('p3');
const cred3 = await um(`SELECT valor_centavos::int AS v, origem_ref FROM creditos_cliente WHERE id = $1`, [rs.corpo.credito_id]);
eq([rs.status, dP3.status, dP3.juros ?? 0, cred3?.v, cred3?.origem_ref], [200, 'RECEBIDO', 0, 1000, `baixa:${rs.corpo.baixa_id}`], 'crédito: conta liquidada e só a sobra vira crédito');

console.log('--- (1) Resolvida sem lançar nada ---');
await cr(A, 'p4', `${A}-cli2`, { valor_final: 30, cliente_nome: 'Bruno' });
let cp4 = await emitir('p4');
await query(`UPDATE contas_receber SET data = data || '{"status":"RECEBIDO","valor_recebido":30}'::jsonb WHERE id = 'p4'`);
await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', cp4, 'RECEIVED'));
rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp4.id}/pendencia`, { escolha: 'ignorar', motivo: 'curto' }), params(cp4.id)));
eq(rs.status, 400, 'resolvida sem motivo de 10 letras: recusa');
const saldoP4 = await saldo(`${A}-asaas`);
rs = await json(await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp4.id}/pendencia`, { escolha: 'ignorar', motivo: 'A baixa à mão foi este Pix mesmo.' }, { 'Idempotency-Key': 'p4-a' }), params(cp4.id)));
cp4 = await cob(cp4.id);
const ev4 = await um(`SELECT detalhe FROM cobranca_eventos WHERE cobranca_id = $1 AND tipo = 'pendencia_resolvida'`, [cp4.id]);
eq([rs.status, Boolean(cp4.dados.pendencia), ev4?.detalhe?.motivo, await saldo(`${A}-asaas`)], [200, false, 'A baixa à mão foi este Pix mesmo.', saldoP4], 'resolvida: tira a marca, guarda o motivo, nada lançado');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
eq((await rotaPend.POST(pedir('POST', `/api/cobrancas/${cp4.id}/pendencia`, { escolha: 'ignorar', motivo: 'qualquer motivo longo' }), params(cp4.id))).status, 403, 'sem o direito de cobrança: 403');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');

console.log('--- (11) Envio com cópia, assunto e mensagem ---');
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo": true, "webhook_url_crm": "https://crm.exemplo.com/webhook"}')`, [A]);
await cr(A, 'e1', `${A}-cli2`, { valor_final: 70, cliente_nome: 'Bruno' });
const ce1 = await emitir('e1');
await srv.enviarCobranca(A, ce1.id, 'email', { personalizado: { copia_para: 'Fin@Cliente.com; aprova@cliente.com, fin@cliente.com', assunto: '  Sua parcela   de novembro ', mensagem: 'Olá, Bruno!\nSegue o boleto.' } });
const env = (await eventosCrm(A, 'COBRANCA_ENVIAR')).at(-1);
eq([env.canal, env.copia_para, env.assunto, env.mensagem], ['email', ['fin@cliente.com', 'aprova@cliente.com'], 'Sua parcela de novembro', 'Olá, Bruno!\nSegue o boleto.'], 'COBRANCA_ENVIAR leva cópia (sem repetir), assunto e mensagem');
await srv.enviarCobranca(A, ce1.id, 'email');
const envPadrao = (await eventosCrm(A, 'COBRANCA_ENVIAR')).at(-1);
eq(['copia_para' in envPadrao, 'assunto' in envPadrao, 'mensagem' in envPadrao], [false, false, false], 'sem nada próprio: o payload de sempre');
eq((await falha(srv.enviarCobranca(A, ce1.id, 'whatsapp', { personalizado: { mensagem: 'oi' } })))?.status, 400, 'WhatsApp com texto próprio: recusa (só modelo aprovado)');
eq(Boolean((await falha(srv.enviarCobranca(A, ce1.id, 'email', { personalizado: { copia_para: 'nao-e-email' } })))?.msg.includes('não parece um e-mail')), true, 'e-mail inválido na cópia: recusa');
const rotaEnviar = await import('../src/app/api/cobrancas/[id]/enviar/route.ts');
const en = await json(await rotaEnviar.POST(pedir('POST', `/api/cobrancas/${ce1.id}/enviar`, { canal: 'email', copia_para: ['outro@cliente.com'], assunto: 'Lembrete' }, { 'Idempotency-Key': 'en-e7' }), params(ce1.id)));
eq([en.status, (await eventosCrm(A, 'COBRANCA_ENVIAR')).at(-1).copia_para], [200, ['outro@cliente.com']], 'rota /enviar repassa os campos');

console.log('--- (13) Link de pagamento pela rota ---');
const rotaLink = await import('../src/app/api/cobrancas/link/route.ts');
await cr(A, 'l1', `${A}-cli`, { valor_final: 45 });
const pvL = await json(await rotaLink.POST(pedir('POST', '/api/cobrancas/link', { modo: 'previa', conta_id: 'l1' })));
eq([pvL.status, pvL.corpo.prontos, pvL.corpo.itens?.[0]?.valor, pvL.corpo.itens?.[0]?.tipo], [200, 1, 45, 'link'], 'prévia do link: sem taxa de boleto (o cliente escolhe como pagar)');
const gL = await json(await rotaLink.POST(pedir('POST', '/api/cobrancas/link', { modo: 'gravar', conta_id: 'l1', assinatura: pvL.corpo.assinatura }, { 'Idempotency-Key': 'lk-e7' })));
eq([gL.status, gL.corpo.tipo, String(gL.corpo.url_link).startsWith('https://sandbox.asaas.com/c/')], [200, 'link', true], 'link criado com a página do provedor');

globalThis.__SESSAO_DE_TESTE__ = null;
console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

