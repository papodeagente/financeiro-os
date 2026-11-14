/**
 * Cobrança — fechamento final (E7, 06/11/2026), contra um Postgres real
 * (PGlite), com provedores FALSOS (respostas como a doc oficial). Sem rede.
 *
 * O que se prova:
 *   · negativação no Serasa pelo Asaas: só vencida, só Asaas, prévia com a
 *     simulação, assinatura, direito, nada sai, idempotência, uma viva por
 *     cobrança, timeout sem pedido em dobro, atualizar e cancelar com motivo;
 *     cadastro incompleto diz o que falta; avisos PAYMENT_DUNNING_* sem efeito;
 *   · link do Pagar.me com cartão: o pedido pago com o id do link baixa a
 *     conta (forma cartão); sem referência e um link do mesmo valor vira
 *     pendência; dois do mesmo valor: nada lançado e o sino avisa; pedido sem
 *     pista de link segue o caminho de sempre.
 *
 * Uso: node --no-warnings scripts/test-sql-cobranca-item18.mjs
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
const dunning = { simulacoes: 0, pedidos: [], lista: [], permitida: true, demorar: 0 };

function resposta(status, corpo, cabecalhos) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: cabecalhos });
}
function pagamentoAsaas(p) { return { object: 'payment', deleted: false, ...p }; }

async function asaas(conta, metodo, caminho, corpo) {
  if (comportamento.asaasFalhaAgencia.has(conta)) return resposta(503, { errors: [{ code: 'x', description: 'instável' }] });
  const [rota, qs] = caminho.split('?');
  const q = new URLSearchParams(qs ?? '');
  // Negativação (como a doc oficial, 06/11/2026).
  if (rota === '/paymentDunnings/simulate' && metodo === 'POST') {
    dunning.simulacoes++;
    return resposta(200, { payment: q.get('payment'), value: 150, typeSimulations: [{ type: 'CREDIT_BUREAU', isAllowed: dunning.permitida, notAllowedReason: dunning.permitida ? null : 'Cobrança ainda não pode ser negativada.', feeValue: 9.9, netValue: 140.1, startDate: '2026-11-12' }] });
  }
  if (rota === '/paymentDunnings' && metodo === 'POST') {
    dunning.pedidos.push(corpo);
    if (dunning.demorar > 0) { dunning.demorar--; const d = { id: `dun_${++asaasDb.seq}`, payment: corpo.payment, status: 'PENDING', feeValue: 9.9, canBeCancelled: true }; dunning.lista.push(d); return 'demorar'; }
    const d = { id: `dun_${++asaasDb.seq}`, dunningNumber: asaasDb.seq, payment: corpo.payment, status: 'PENDING', type: 'CREDIT_BUREAU', feeValue: 9.9, canBeCancelled: true };
    dunning.lista.push(d);
    return resposta(200, d);
  }
  if (rota === '/paymentDunnings' && metodo === 'GET') return resposta(200, { data: dunning.lista.filter(d => d.payment === q.get('payment')) });
  const md = rota.match(/^\/paymentDunnings\/([^/]+)(\/cancel)?$/);
  if (md) {
    const d = dunning.lista.find(x => x.id === md[1]);
    if (!d) return resposta(404, { errors: [{ description: 'não achada' }] });
    if (md[2] && metodo === 'POST') { d.status = 'AWAITING_CANCELLATION'; d.canBeCancelled = false; return resposta(200, d); }
    return resposta(200, d);
  }
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
  if (rota === '/paymentlinks' && metodo === 'POST') { pagarmeDb.links = [...(pagarmeDb.links ?? []), corpo]; return resposta(200, { id: `pl_${++pagarmeDb.seq}x`, url: `https://payment-link.pagar.me/pl_${pagarmeDb.seq}x`, status: 'active' }); }
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
  const corpo = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init?.body ? JSON.parse(init.body) : undefined;
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


const rotaNeg = await import('../src/app/api/cobrancas/[id]/negativacao/route.ts');
const { desviarAvisoDeCobranca } = await import('../src/lib/cobranca/aviso.ts');
const negGet = async id => json(await rotaNeg.GET(pedir('GET', `/api/cobrancas/${id}/negativacao`), params(id)));
const negPost = async (id, corpo, chave) => json(await rotaNeg.POST(pedir('POST', `/api/cobrancas/${id}/negativacao`, corpo, chave ? { 'Idempotency-Key': chave } : {}), params(id)));
const vencida = id => query(`UPDATE cobrancas SET status = 'vencida' WHERE id = $1`, [id]);
const eventosDa = async (id, tipo) => (await todos(`SELECT detalhe FROM cobranca_eventos WHERE cobranca_id = $1 AND tipo = $2`, [id, tipo])).map(r => r.detalhe);

console.log('--- Negativação no Serasa (Asaas): prévia e confirmação ---');
await cr(A, 'n1', `${A}-cli`, { valor_final: 150, data_vencimento: '2026-11-01' });
const cn1 = await emitir('n1');
let r = await negGet(cn1.id);
eq([r.status, r.corpo.pode, r.corpo.motivos], [200, false, ['Só cobrança vencida pode ser negativada.']], 'cobrança em aberto: não negativa');
eq(dunning.simulacoes, 0, 'sem chance: nem simula no provedor');
await vencida(cn1.id);
r = await negGet(cn1.id);
eq([r.corpo.pode, r.corpo.faltas, r.corpo.simulacao, Boolean(r.corpo.assinatura), dunning.pedidos.length],
  [true, [], { permitida: true, motivo: '', taxa_centavos: 990, liquido_centavos: 14010, inicio_previsto: '2026-11-12' }, true, 0], 'vencida: prévia com a taxa e o início; nada pedido');
const assinatura = r.corpo.assinatura;
r = await negPost(cn1.id, { acao: 'negativar', assinatura: 'outra' }, 'neg-0');
eq([r.status, r.corpo.codigo, dunning.pedidos.length], [409, 'ASSINATURA_VENCIDA', 0], 'assinatura que não é a da prévia: recusa');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
eq((await negPost(cn1.id, { acao: 'negativar', assinatura }, 'neg-v')).status, 403, 'sem o direito de emitir boleto: 403');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const nsNeg = await comNadaSai('ensaio', () => negPost(cn1.id, { acao: 'negativar', assinatura }, 'neg-ns'));
eq([nsNeg.status, nsNeg.corpo.codigo, dunning.pedidos.length], [409, 'NADA_SAI', 0], 'nada sai: segura o pedido');
r = await negPost(cn1.id, { acao: 'negativar', assinatura }, 'neg-1');
eq([r.status, r.corpo.negativacao?.status, dunning.pedidos.length, dunning.pedidos[0]?.type, dunning.pedidos[0]?.customerPostalCode, dunning.pedidos[0]?.customerProvince],
  [200, 'PENDING', 1, 'CREDIT_BUREAU', '01310100', 'Bela Vista'], 'pedido com a prévia: vai em multipart com o devedor');
let c1 = await cob(cn1.id);
eq([c1.dados.negativacao?.status, c1.dados.negativacao?.taxa_centavos, (await eventosDa(cn1.id, 'negativacao_pedida')).length], ['PENDING', 990, 1], 'gravada na cobrança, com evento');
r = await negPost(cn1.id, { acao: 'negativar', assinatura }, 'neg-1');
eq([r.status, r.corpo.repetido, dunning.pedidos.length], [200, true, 1], 'a mesma chave: devolve o feito, sem pedir de novo');
r = await negPost(cn1.id, { acao: 'negativar', assinatura }, 'neg-2');
eq([r.status, dunning.pedidos.length], [409, 1], 'outra chave: já há negativação viva, recusa');
dunning.lista.find(d => d.id === c1.dados.negativacao.id).status = 'PROCESSED';
r = await negPost(cn1.id, { acao: 'atualizar' });
eq([r.status, r.corpo.negativacao?.status, (await eventosDa(cn1.id, 'negativacao_situacao'))[0]], [200, 'PROCESSED', { de: 'PENDING', para: 'PROCESSED' }], 'atualizar: lê a situação no provedor e registra a mudança');
eq((await negPost(cn1.id, { acao: 'cancelar', motivo: '' })).status, 400, 'cancelar sem motivo: recusa');
r = await negPost(cn1.id, { acao: 'cancelar', motivo: 'cliente pagou por fora' });
eq([r.status, r.corpo.negativacao?.status, (await eventosDa(cn1.id, 'negativacao_cancelada'))[0]?.motivo], [200, 'AWAITING_CANCELLATION', 'cliente pagou por fora'], 'cancelar: o provedor confirma depois; motivo no histórico');

console.log('--- Negativação: cadastro, provedor e timeout ---');
await cli(A, `${A}-cli3`, '11122233396', { cep: '', logradouro: '', numero: '', bairro: '', whatsapp: '' });
await cr(A, 'n3', `${A}-cli3`, { valor_final: 90, data_vencimento: '2026-11-01', cliente_nome: 'Ana Lima' });
const cn3 = await emitir('n3');
await vencida(cn3.id);
r = await negGet(cn3.id);
eq([r.corpo.pode, r.corpo.faltas], [false, ['telefone com DDD', 'CEP', 'endereço (rua)', 'número do endereço', 'bairro']], 'cadastro incompleto: a prévia diz o que falta');
eq((await negPost(cn3.id, { acao: 'negativar', assinatura: r.corpo.assinatura })).status, 409, 'e não pede');
await cr(B, 'nb1', `${B}-cli`, { valor_final: 90, data_vencimento: '2026-11-01' });
const cnb = (await srv.gravarEmissao(B, { itens: [{ conta_id: 'nb1' }] }, { hoje: HOJE })).cobrancas[0];
await vencida(cnb.id);
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', B);
r = await negGet(cnb.id);
eq([r.corpo.pode, r.corpo.motivos], [false, ['Negativação pela integração só existe no Asaas.']], 'Pagar.me: não oferece');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
await cr(A, 'n4', `${A}-cli`, { valor_final: 70, data_vencimento: '2026-11-01' });
const cn4 = await emitir('n4');
await vencida(cn4.id);
r = await negGet(cn4.id);
dunning.demorar = 1;
const antes4 = dunning.pedidos.length;
r = await negPost(cn4.id, { acao: 'negativar', assinatura: r.corpo.assinatura }, 'neg-4');
eq([r.status, Boolean(r.corpo.negativacao?.id), dunning.pedidos.length - antes4, dunning.lista.filter(d => d.payment === cn4.id_externo).length],
  [200, true, 1, 1], 'sem resposta do provedor: acha a negativação criada pela cobrança, sem pedir outra');
eq((await negGet(cn4.id)).corpo.pode, false, 'depois: já tem negativação viva');

console.log('--- Avisos de negativação do Asaas: sem efeito financeiro ---');
const saldoAntes = await saldo(`${A}-asaas`);
for (const ev of ['PAYMENT_DUNNING_REQUESTED', 'PAYMENT_DUNNING_RECEIVED']) {
  const e = await avisoAsaas(ev, await cob(cn1.id), 'OVERDUE', { sufixo: ev });
  r = await processarEvento(A, 'asaas', e);
  eq([e.tipo, r.acao], ['IGNORADO', 'evento sem efeito financeiro'], `${ev}: ignorado`);
}
eq([await saldo(`${A}-asaas`), (await cob(cn1.id)).status], [saldoAntes, 'vencida'], 'nada mexeu no caixa nem na cobrança');

console.log('--- Link do Pagar.me com cartão: o aviso nunca vira venda ---');
const linkCob = async (t, id, conta, pl, centavos) => {
  await cr(t, conta, `${t}-cli`, { valor_final: centavos / 100 });
  await query(`INSERT INTO cobrancas (id, tenant_id, titulo_id, cliente_id, provedor, id_externo, referencia, tipo, status, valor_centavos, vencimento, conta_bancaria_id)
    VALUES ($1, $2, $3, $4, 'pagarme', $5, $6, 'link', 'aberta', $7, '2026-11-12', $8)`, [id, t, conta, `${t}-cli`, pl, `f1;${t};${id}`, centavos, `${t}-pg`]);
};
const pedidoPago = (id, centavos, extra = {}) => adapterPagarme.normalizar({
  id: `hook_${id}`, type: 'order.paid',
  data: { id: `or_${id}`, code: `PED${id}`, amount: centavos, status: 'paid', created_at: '2026-11-07T10:00:00Z',
    charges: [{ id: `ch_${id}`, amount: centavos, paid_amount: centavos, status: 'paid', payment_method: 'credit_card', paid_at: '2026-11-07T15:00:00Z' }], ...extra },
}, semChave);
await linkCob(B, 'cl1', 'l1', 'pl_77x', 9990);
r = await processarEvento(B, 'pagarme', await pedidoPago('l1', 9990, { items: [{ description: 'Pacote', amount: 9990, code: 'pl_77x' }] }));
const bl1 = await um(`SELECT forma FROM baixas WHERE tenant_id = $1 AND titulo_id = 'l1' AND tipo = 'baixa'`, [B]);
eq([r.cobranca?.cobranca_id, (await conta('l1')).status, bl1?.forma], ['cl1', 'RECEBIDO', 'Cartão de crédito'], 'o id do link no pedido: baixa a conta, pagamento por cartão');
await linkCob(B, 'cl2', 'l2', 'pl_88x', 5000);
r = await processarEvento(B, 'pagarme', await pedidoPago('l2', 5000, { checkouts: [{ id: 'chk_9' }] }));
const c2 = await cob('cl2');
eq([r.cobranca?.cobranca_id, (await conta('l2')).status, c2.dados.pendencia_tipo, c2.dados.pendencia_pagamento?.valor_centavos, c2.baixa_id],
  ['cl2', 'PENDENTE', 'pagamento', 5000, null], 'sem referência, um link nosso do mesmo valor: pendência para uma pessoa confirmar (nada baixado)');
await linkCob(B, 'cl3', 'l3', 'pl_91x', 3000);
await linkCob(B, 'cl4', 'l4', 'pl_92x', 3000);
const notifAntes = await notificacoes(B, 'COBRANCA_PENDENCIA');
r = await processarEvento(B, 'pagarme', await pedidoPago('l3', 3000, { checkouts: [{ id: 'chk_10' }] }));
eq([r.cobranca?.cobranca_id ?? null, /nada lançado/.test(r.acao), (await conta('l3')).status, (await conta('l4')).status, await notificacoes(B, 'COBRANCA_PENDENCIA') - notifAntes],
  [null, true, 'PENDENTE', 'PENDENTE', 1], 'dois links do mesmo valor: nada lançado, e o sino avisa');
const semPista = await emTransacao(exec => desviarAvisoDeCobranca(exec, B, 'pagarme', { tipo: 'PAGAMENTO_CONFIRMADO', id_externo: 'x', parcela_afetada: 0, transacao: { bruto: { type: 'order.paid', data: { id: 'or_z', code: 'LOJA-1', charges: [{ id: 'ch_z', amount: 3000, paid_amount: 3000 }] } } } }, { contaBancariaId: null }));
eq(semPista, null, 'pedido sem pista de link: não é nosso, segue o caminho de sempre (venda)');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
