/**
 * Cobrança pelo Asaas/Pagar.me da agência (E3, 05/11/2026), contra um
 * Postgres real (PGlite), rodando o código DE PRODUÇÃO com provedores
 * FALSOS que respondem como a documentação oficial. Nenhuma chamada de rede.
 *
 * O que se prova:
 *   (a) emissão idempotente: timeout e repetição não duplicam;
 *   (b) aviso de pago baixa a conta uma vez só, com a taxa e a data;
 *   (c) aviso de estorno desfaz a baixa;
 *   (d) lote pela fila: 2 chamadas/s por agência; disjuntor por agência ×
 *       provedor sem parar as outras agências;
 *   (e) régua: lembrete uma vez por cobrança por dia de régua;
 *   (f) nada sai: sem emissão, sem lembrete, sem aviso;
 *   (g) carnê, link, 2ª via, cancelar, portal, lista com contas liberadas,
 *       avisos ao CRM e referência nossa que nunca vira venda.
 *
 * Uso: node --no-warnings scripts/test-sql-cobranca.mjs
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
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
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

// ---------------------------------------------------------------------------
console.log('--- Prévia ---');
await cr(A, 'a1', `${A}-cli`, {});
await cr(A, 'a-sem-cli', '', { cliente_id: '' });
let pv = await srv.previaDaEmissao(pool, A, { itens: [{ conta_id: 'a1' }, { conta_id: 'a-sem-cli' }, { conta_id: 'nao-existe' }] }, HOJE);
eq([pv.provedor, pv.tipo, pv.prontas, pv.com_erro, pv.total, pv.conta_bancaria_id], ['asaas', 'boleto_pix', 1, 2, 150, `${A}-asaas`], 'prévia: provedor e tipo padrão, uma pronta, duas com erro, conta da integração');
eq(pv.encargos, { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 0, desconto: null }, 'juros e multa da política do financeiro');
eq(chamadas.length, 0, 'a prévia não chama o provedor');
eq((await falha(srv.previaDaEmissao(pool, B, { itens: [{ conta_id: 'x' }], tipo: 'boleto_pix' }, HOJE)))?.status, 409, 'Pagar.me: boleto com Pix recusado na prévia');

console.log('--- (a) Emitir uma: na hora ---');
const g1 = await srv.gravarEmissao(A, { itens: [{ conta_id: 'a1' }] }, { assinatura: pv.assinatura, hoje: HOJE, quem: { usuarioId: 'u1', usuarioNome: 'Bia' } });
let c1 = g1.cobrancas[0];
eq([c1.status, c1.tipo, c1.valor_centavos, c1.vencimento, c1.linha_digitavel.length, c1.pix_copia_cola.startsWith('000201'), g1.na_fila, g1.puladas.length],
  ['aberta', 'boleto_pix', 15000, '2026-11-20', 47, true, 0, 0], 'emitida na hora: linha, Pix e URLs');
eq(c1.referencia, `f1;${A};${c1.id}`, 'referência própria gravada');
const pagto1 = asaasDb.pagamentos.find(p => p.id === c1.id_externo);
eq([pagto1.externalReference, pagto1.value, pagto1.billingType], [c1.referencia, 150, 'BOLETO'], 'no Asaas: referência, valor em reais, boleto (com Pix)');
let d1 = await conta('a1');
eq([d1.cobranca.status, d1.boleto_emitido, d1.boleto_codigo.length], ['aberta', true, 47], 'a conta a receber mostra a cobrança');
const emitidas = await eventosCrm(A, 'COBRANCA_EMITIDA');
eq([emitidas.length, emitidas[0].cobranca_id, emitidas[0].crm_contact_id, emitidas[0].valor, emitidas[0].linha_digitavel.length, emitidas[0].url_portal.startsWith('https://fin.exemplo.com/c/'), emitidas[0].cliente.cpf_cnpj],
  [1, c1.id, `${A}-cli`, 150, 47, true, '12345678909'], 'COBRANCA_EMITIDA ao CRM com linha, portal e contato');
const repetida = await srv.gravarEmissao(A, { itens: [{ conta_id: 'a1' }] }, { hoje: HOJE }).catch(e => e);
eq([repetida?.status, (await todos(`SELECT id FROM cobrancas WHERE titulo_id = 'a1'`)).length, asaasDb.pagamentos.length], [409, 1, 1], 'repetir o pedido não emite em dobro (uma cobrança valendo por conta)');
eq((await falha(srv.gravarEmissao(A, { itens: [{ conta_id: 'a1' }] }, { assinatura: 'outra', hoje: HOJE })))?.status, 409, 'assinatura diferente da prévia: recusa');

console.log('--- (a) Timeout não duplica ---');
await cr(A, 'a2', `${A}-cli`, { valor_final: 80 });
comportamento.asaasPostLento = 1;
const g2 = await srv.gravarEmissao(A, { itens: [{ conta_id: 'a2' }] }, { hoje: HOJE });
let c2 = g2.cobrancas[0];
eq([c2.status, c2.tentativas, g2.na_fila, Boolean(c2.erro)], ['emitindo', 1, 1, true], 'timeout: fica emitindo, com o erro, e vai para a fila');
eq(asaasDb.pagamentos.filter(p => p.externalReference === c2.referencia).length, 1, 'o Asaas criou mesmo assim (a resposta se perdeu)');
relogio += 120_000;
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_emitir'`);
let pf = await fila.processarFila(pool, { orcamentoMs: 60_000 });
c2 = await cob(c2.id);
eq([pf.processadas, c2.status, c2.tentativas, c2.id_externo === asaasDb.pagamentos.find(p => p.externalReference === c2.referencia).id],
  [1, 'aberta', 2, true], 'a fila consultou pela referência e adotou a cobrança que já existia');
eq(asaasDb.pagamentos.filter(p => p.externalReference === c2.referencia).length, 1, 'nenhuma cobrança em dobro no Asaas');

console.log('--- (b) Aviso de pago: baixa uma vez só, com taxa e data ---');
const avisoAsaas = (evento, c, status, extra = {}) => adapterAsaas.normalizar({
  id: `evt_${evento}_${c.id_externo}_${extra.sufixo ?? ''}`, event: evento,
  payment: { ...asaasDb.pagamentos.find(p => p.id === c.id_externo), status, paymentDate: '2026-11-06', clientPaymentDate: '2026-11-06', creditDate: '2026-11-06', ...extra },
}, semChave);
const saldo0 = await saldo(`${A}-asaas`);
let r = await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_CONFIRMED', c1, 'CONFIRMED'));
c1 = await cob(c1.id);
eq([r.cobranca?.cobranca_id, c1.status, c1.baixa_id, c1.dados.aguardando_credito, await saldo(`${A}-asaas`)], [c1.id, 'paga', null, true, saldo0], 'confirmado (Asaas): paga, baixa espera o crédito');
r = await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', c1, 'RECEIVED'));
c1 = await cob(c1.id);
d1 = await conta('a1');
eq([c1.status, Boolean(c1.baixa_id), c1.pago_centavos, c1.taxa_centavos, c1.pago_em], ['paga', true, 15000, 199, '2026-11-06'], 'recebido: baixa com taxa (bruto − líquido) e a data do pagamento');
eq([d1.status, d1.valor_recebido, d1.data_recebimento, d1.taxa, d1.conta_bancaria_id], ['RECEBIDO', 150, '2026-11-06', 1.99, `${A}-asaas`], 'a conta a receber ficou recebida, na conta da integração');
eq(await saldo(`${A}-asaas`), saldo0 + 150, 'o caixa recebeu (regra da liquidação)');
const baixas1 = await todos(`SELECT origem, taxa_centavos, data_baixa::text AS d FROM baixas WHERE tenant_id = $1 AND titulo_id = 'a1' AND tipo = 'baixa'`, [A]);
eq(baixas1, [{ origem: 'plataforma', taxa_centavos: 199, d: '2026-11-06' }], 'uma baixa, origem plataforma');
r = await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', c1, 'RECEIVED', { sufixo: 'reenvio' }));
eq([(await todos(`SELECT 1 FROM baixas WHERE tenant_id = $1 AND titulo_id = 'a1' AND tipo = 'baixa'`, [A])).length, await saldo(`${A}-asaas`)], [1, saldo0 + 150], 'o mesmo pagamento avisado de novo (outro id de evento): não baixa duas vezes');
r = await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_RECEIVED', c1, 'RECEIVED', { sufixo: 'reenvio' }));
eq(r.acao, 'duplicado, ignorado', 'o mesmo evento repetido: ignorado na porta');
eq((await todos(`SELECT 1 FROM plataformas_transacoes WHERE tenant_id = $1`, [A])).length, 0, 'aviso de cobrança nossa NÃO vira venda');
const pagas = await eventosCrm(A, 'COBRANCA_PAGA');
eq([pagas.length, pagas[0]?.valor_pago, pagas[0]?.pago_em], [1, 150, '2026-11-06'], 'COBRANCA_PAGA ao CRM, uma vez');

console.log('--- Pix pago antes de a emissão terminar de gravar ---');
await cr(A, 'px1', `${A}-cli`, { valor_final: 30 });
comportamento.aoCriar = async p => {
  // O aviso chega antes da resposta da criação (o cliente pagou em segundos).
  const ev = await adapterAsaas.normalizar({ id: `evt_rapido_${p.id}`, event: 'PAYMENT_RECEIVED', payment: { ...p, status: 'RECEIVED', paymentDate: HOJE, netValue: 29.01 } }, semChave);
  await processarEvento(A, 'asaas', ev);
};
const px = await srv.gravarEmissao(A, { itens: [{ conta_id: 'px1' }], tipo: 'pix' }, { hoje: HOJE });
eq([px.cobrancas[0].status, (await conta('px1')).status, Boolean(px.cobrancas[0].linha_digitavel)], ['paga', 'RECEBIDO', false],
  'a emissão que termina depois não reabre a cobrança paga');
eq((await eventosCrm(A, 'COBRANCA_EMITIDA')).some(e => e.conta_id === 'px1'), false, 'e não manda "emitida" de uma cobrança já paga');

console.log('--- (c) Estorno desfaz ---');
r = await processarEvento(A, 'asaas', await avisoAsaas('PAYMENT_REFUNDED', c1, 'REFUNDED'));
c1 = await cob(c1.id);
d1 = await conta('a1');
eq([c1.status, c1.baixa_id, d1.status, d1.valor_recebido, await saldo(`${A}-asaas`)], ['estornada', null, 'PENDENTE', 0, saldo0 + 30], 'estornado no Asaas: baixa desfeita, conta em aberto, caixa de volta (só o Pix de 30 fica)');
const est = await um(`SELECT motivo FROM baixas WHERE tenant_id = $1 AND titulo_id = 'a1' AND tipo = 'estorno'`, [A]);
eq(est?.motivo, 'Estornado no Asaas', 'motivo do estorno');

console.log('--- Referência nossa sem cobrança aqui: não vira venda ---');
r = await processarEvento(A, 'asaas', await adapterAsaas.normalizar({ id: 'evt_orfao', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_orfao', value: 10, netValue: 9, status: 'RECEIVED', billingType: 'PIX', externalReference: `f1;${A};capagada`, paymentDate: HOJE } }, semChave));
eq([r.acao, (await todos(`SELECT 1 FROM plataformas_transacoes`)).length], ['cobrança do financeiro não encontrada: nada lançado', 0], 'referência f1 sem cobrança: nada lançado');

console.log('--- (d) Lote pela fila: 2/s por agência e disjuntor por agência × provedor ---');
for (let i = 1; i <= 3; i++) await cr(A, `la${i}`, `${A}-cli`, { valor_final: 100 + i });
for (let i = 1; i <= 3; i++) await cr(B, `lb${i}`, `${B}-cli`, { valor_final: 200 + i });
zerarLimitador();
const lA = await srv.gravarEmissao(A, { itens: [1, 2, 3].map(i => ({ conta_id: `la${i}` })) }, { hoje: HOJE });
const lB = await srv.gravarEmissao(B, { itens: [1, 2, 3].map(i => ({ conta_id: `lb${i}` })) }, { hoje: HOJE });
eq([lA.na_fila, lB.na_fila, lA.cobrancas.every(c => c.status === 'emitindo')], [3, 3, true], 'várias: vão para a fila, emitindo');
comportamento.asaasFalhaAgencia.add(`$aact_hmlg_${A}`);
chamadas.length = 0;
pf = await fila.processarFila(pool, { orcamentoMs: 600_000 });
const doA = chamadas.filter(c => c.conta === `$aact_hmlg_${A}`).map(c => c.t);
const doB = chamadas.filter(c => c.conta === `sk_test_${B}`).map(c => c.t);
const espacado = ts => ts.every((t, i) => i === 0 || t - ts[i - 1] >= 500);
eq([doA.length > 0, doB.length >= 6, espacado(doA), espacado(doB)], [true, true, true, true], 'cada agência no máximo 2 chamadas por segundo');
const deB = await todos(`SELECT status FROM cobrancas WHERE tenant_id = $1 AND titulo_id LIKE 'lb%' ORDER BY titulo_id`, [B]);
eq(deB.map(x => x.status), ['aberta', 'aberta', 'aberta'], 'a agência B emitiu tudo enquanto o provedor da A falhava');
eq([pf.falhas, (await todos(`SELECT status FROM cobrancas WHERE tenant_id = $1 AND titulo_id LIKE 'la%'`, [A])).map(x => x.status)], [3, ['emitindo', 'emitindo', 'emitindo']], 'as da agência A voltam para a fila');
// Mais duas rodadas de falha abrem o disjuntor (5 seguidas).
for (let i = 0; i < 2; i++) {
  await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_emitir' AND status = 'pendente'`);
  await fila.processarFila(pool, { orcamentoMs: 600_000 });
}
const disj = await um(`SELECT falhas_seguidas, aberto_ate > NOW() AS aberto FROM cobranca_disjuntor WHERE tenant_id = $1 AND provedor = 'asaas'`, [A]);
eq([disj.falhas_seguidas >= 5, disj.aberto], [true, true], 'disjuntor aberto para a agência A no Asaas');
eq(await um(`SELECT COUNT(*)::int AS n FROM cobranca_disjuntor WHERE tenant_id = $1 AND aberto_ate IS NOT NULL`, [B]).then(x => x.n), 0, 'a agência B não tem disjuntor aberto');
chamadas.length = 0;
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_emitir' AND status = 'pendente'`);
const antesAdiar = await todos(`SELECT tentativas FROM tarefas WHERE tipo = 'cobranca_emitir' AND tenant_id = $1 AND status <> 'concluida' ORDER BY chave_idem`, [A]);
pf = await fila.processarFila(pool, { orcamentoMs: 600_000 });
const depoisAdiar = await todos(`SELECT tentativas, status, proxima_em > NOW() AS futura FROM tarefas WHERE tipo = 'cobranca_emitir' AND tenant_id = $1 AND status <> 'concluida' ORDER BY chave_idem`, [A]);
eq([pf.adiadas, chamadas.length, depoisAdiar.map(x => x.tentativas), depoisAdiar.every(x => x.status === 'pendente' && x.futura)],
  [3, 0, antesAdiar.map(x => x.tentativas), true], 'disjuntor aberto: adia sem chamar o provedor e sem gastar tentativa');
// O provedor volta: o disjuntor fecha no primeiro sucesso.
comportamento.asaasFalhaAgencia.clear();
await query(`UPDATE cobranca_disjuntor SET aberto_ate = NOW() - INTERVAL '1 second' WHERE tenant_id = $1`, [A]);
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_emitir' AND status = 'pendente'`);
pf = await fila.processarFila(pool, { orcamentoMs: 600_000 });
eq([(await todos(`SELECT status FROM cobrancas WHERE tenant_id = $1 AND titulo_id LIKE 'la%'`, [A])).map(x => x.status), (await um(`SELECT falhas_seguidas FROM cobranca_disjuntor WHERE tenant_id = $1`, [A])).falhas_seguidas],
  [['aberta', 'aberta', 'aberta'], 0], 'o provedor voltou: emitidas, disjuntor zerado');
eq(asaasDb.pagamentos.filter(p => p.conta === `$aact_hmlg_${A}` && /la\d/.test(p.description ?? '')).length, 3, 'nenhuma em dobro depois das falhas');

console.log('--- Pagar.me: boleto, aviso de pago e 2ª via que reemite ---');
const lb1 = await um(`SELECT id FROM cobrancas WHERE tenant_id = $1 AND titulo_id = 'lb1'`, [B]);
let cb = await cob(lb1.id);
eq([cb.provedor, cb.tipo, cb.linha_digitavel.length, cb.codigo_barras.length, cb.pix_copia_cola], ['pagarme', 'boleto', 47, 44, ''], 'Pagar.me: boleto com linha e código de barras');
const nova = await srv.alterarCobranca(B, cb.id, { valor_centavos: 25000 }, { hoje: HOJE });
cb = await cob(cb.id);
eq([cb.status, cb.dados.substituida_por === nova.id, nova.substitui_id, nova.status, nova.valor_centavos, pagarmeDb.cargas.find(c => c.id === cb.id_externo).status],
  ['cancelada', true, cb.id, 'aberta', 25000, 'canceled'], '2ª via com valor novo no Pagar.me: cancela e emite outra, ligada à anterior');
const venc = await srv.alterarCobranca(B, nova.id, { vencimento: '2026-12-01' }, { hoje: HOJE });
eq([venc.id, venc.vencimento, pagarmeDb.cargas.find(c => c.id === venc.id_externo).last_transaction.due_at], [nova.id, '2026-12-01', '2026-12-01T00:00:00Z'], '2ª via só de vencimento: altera no Pagar.me');
const avisoPg = await adapterPagarme.normalizar({
  id: 'hook_pg_1', type: 'charge.paid',
  data: { id: venc.id_externo, code: venc.referencia, amount: 25000, paid_amount: 25000, status: 'paid', payment_method: 'boleto', paid_at: '2026-11-07T15:00:00Z', created_at: '2026-11-05T10:00:00Z', order: { id: 'or_x', code: venc.referencia } },
}, semChave);
const saldoPg = await saldo(`${B}-pg`);
r = await processarEvento(B, 'pagarme', avisoPg);
const vb = await cob(venc.id);
eq([vb.status, Boolean(vb.baixa_id), vb.pago_em, (await conta('lb1')).status, await saldo(`${B}-pg`)], ['paga', true, '2026-11-07', 'RECEBIDO', saldoPg + 250], 'Pagar.me pago: baixa já no aviso de pago (não há aviso de crédito)');

console.log('--- Cancelar ---');
const lb2 = await um(`SELECT id FROM cobrancas WHERE tenant_id = $1 AND titulo_id = 'lb2'`, [B]);
const canc = await srv.cancelarCobranca(B, lb2.id, { motivo: 'cliente pagou em dinheiro' });
eq([canc.cobranca.status, pagarmeDb.cargas.find(c => c.id === canc.cobranca.id_externo).status, (await conta('lb2')).boleto_emitido], ['cancelada', 'canceled', false], 'cancelada no provedor e aqui; a conta deixa de mostrar boleto');
eq([(await srv.cancelarCobranca(B, lb2.id)).cobranca.status, pagarmeDb.cargas.filter(c => c.status === 'canceled').length], ['cancelada', 2], 'cancelar de novo: devolve a cancelada, sem chamar o provedor outra vez');

console.log('--- Carnê (Asaas) ---');
for (const [i, v] of [[1, '2026-12-10'], [2, '2027-01-10'], [3, '2027-02-10']]) await cr(A, `k${i}`, `${A}-cli`, { valor_final: 300, data_vencimento: v });
const pvk = await srv.previaDoCarne(pool, A, { conta_ids: ['k2', 'k1', 'k3'] }, HOJE);
eq([pvk.erros_do_carne, pvk.valor_parcela_centavos, pvk.primeiro_vencimento, pvk.itens.map(i => i.conta_id)], [[], 30000, '2026-12-10', ['k1', 'k2', 'k3']], 'prévia do carnê em ordem de vencimento');
const kn = await srv.gravarCarne(A, { conta_ids: ['k1', 'k2', 'k3'] }, { assinatura: pvk.assinatura, hoje: HOJE });
eq([kn.cobrancas.map(c => [c.titulo_id, c.carne_parcela, c.status, Boolean(c.id_externo)]), new Set(kn.cobrancas.map(c => c.carne_id_externo)).size],
  [[['k1', 1, 'aberta', true], ['k2', 2, 'aberta', true], ['k3', 3, 'aberta', true]], 1], 'uma parcela do provedor para cada conta, no mesmo parcelamento');
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_atualizar'`);
await fila.processarFila(pool, { orcamentoMs: 600_000 });
eq((await cob(kn.cobrancas[1].id)).linha_digitavel.length, 47, 'a fila buscou a linha de cada parcela');
const k2 = await cob(kn.cobrancas[1].id);
r = await processarEvento(A, 'asaas', await adapterAsaas.normalizar({ id: 'evt_k2', event: 'PAYMENT_RECEIVED', payment: { ...asaasDb.pagamentos.find(p => p.id === k2.id_externo), status: 'RECEIVED', paymentDate: '2026-12-09' } }, semChave));
eq([(await cob(k2.id)).status, (await conta('k2')).status, (await conta('k1')).status], ['paga', 'RECEBIDO', 'PENDENTE'], 'parcela 2 paga: baixa só a conta dela');
eq((await falha(srv.previaDoCarne(pool, B, { conta_ids: ['lb3'] }, HOJE)))?.status, 409, 'Pagar.me: carnê não existe');

console.log('--- Link (Asaas) ---');
await cr(A, 'lk1', `${A}-cli`, { valor_final: 99.9 });
const lk = await srv.gravarEmissao(A, { itens: [{ conta_id: 'lk1' }], tipo: 'link' }, { hoje: HOJE });
const clk = lk.cobrancas[0];
eq([clk.tipo, clk.status, clk.url_link.startsWith('https://sandbox.asaas.com/c/'), clk.vencimento], ['link', 'aberta', true, '2026-11-12'], 'link com validade padrão de 7 dias');
r = await processarEvento(A, 'asaas', await adapterAsaas.normalizar({ id: 'evt_lk', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_do_link', paymentLink: clk.id_externo, value: 99.9, netValue: 97.91, status: 'RECEIVED', billingType: 'PIX', paymentDate: '2026-11-06', customer: 'cus_x' } }, semChave));
const clk2 = await cob(clk.id);
eq([clk2.status, clk2.dados.pagamento_id, clk2.dados.forma_paga, (await conta('lk1')).status], ['paga', 'pay_do_link', 'pix', 'RECEBIDO'], 'pagamento pelo link: achado pelo id do link, baixa feita');

console.log('--- (e) Régua: não repete ---');
await cr(A, 'rg1', `${A}-cli`, { valor_final: 50, data_vencimento: '2026-11-10' });
await cr(A, 'rg2', `${A}-cli`, { valor_final: 60, data_vencimento: '2026-11-05' });
await srv.gravarEmissao(A, { itens: [{ conta_id: 'rg1' }, { conta_id: 'rg2' }] }, { hoje: HOJE });
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tipo = 'cobranca_emitir' AND status = 'pendente'`);
await fila.processarFila(pool, { orcamentoMs: 600_000 });
const oitoDaManha = new Date('2026-11-05T11:00:00Z');
let rr = await rodarRegua(pool, A, oitoDaManha);
const lembretes1 = await eventosCrm(A, 'COBRANCA_LEMBRETE');
eq([rr.lembretes, lembretes1.map(l => l.dias).sort(), lembretes1[0]?.canais], [2, [-5, 0], ['email', 'whatsapp']], 'hoje: −5 para a que vence dia 10, 0 para a que vence hoje');
rr = await rodarRegua(pool, A, new Date('2026-11-05T20:00:00Z'));
eq([rr.lembretes, (await eventosCrm(A, 'COBRANCA_LEMBRETE')).length], [0, 2], 'rodar de novo no mesmo dia: não repete');
rr = await rodarRegua(pool, A, new Date('2026-11-06T11:00:00Z'));
const rg2 = await um(`SELECT status FROM cobrancas WHERE tenant_id = $1 AND titulo_id = 'rg2'`, [A]);
eq([rr.vencidas >= 1, rg2.status, rr.lembretes], [true, 'vencida', 1], 'dia seguinte: a de ontem vira vencida e recebe o lembrete de 1 dia');
rr = await rodarRegua(pool, B, oitoDaManha);
eq(rr.motivo, 'régua desligada', 'agência que não ligou a régua: nenhum lembrete');
const viaAgendador = await rodarAgendador({ tarefas: [tarefaReguaCobranca], conexao: async () => ({ exec: pool, liberar() {} }), emTransacao, agora: new Date('2026-11-07T11:00:00Z') });
eq(viaAgendador['cobranca-regua'].feitas >= 1, true, 'a tarefa diária roda pelo agendador, por agência');

console.log('--- (f) Nada sai ---');
await cr(A, 'ns1', `${A}-cli`, {});
const antesNs = chamadas.length;
const ns = await comNadaSai('importação do sistema anterior', () => falha(srv.gravarEmissao(A, { itens: [{ conta_id: 'ns1' }] }, { hoje: HOJE })));
eq([ns?.status, chamadas.length - antesNs, (await todos(`SELECT 1 FROM cobrancas WHERE titulo_id = 'ns1'`)).length], [409, 0, 0], 'nada sai: não emite nem chama o provedor');
const nsR = await comNadaSai('ensaio', () => rodarRegua(pool, A, new Date('2026-11-12T11:00:00Z')));
eq([nsR.lembretes, nsR.motivo], [0, 'nada sai: ensaio'], 'nada sai: régua sem lembrete');
const idRg1 = (await um(`SELECT id FROM cobrancas WHERE titulo_id = 'rg1'`)).id;
const nsE = await comNadaSai('ensaio', () => falha(srv.enviarCobranca(A, idRg1, 'email')));
eq(nsE?.status, 409, 'nada sai: sem envio');

console.log('--- Enviar ---');
const rg1 = await um(`SELECT id FROM cobrancas WHERE titulo_id = 'rg1'`);
eq((await falha(srv.enviarCobranca(A, rg1.id, 'whatsapp')))?.status, 409, 'sem CRM ligado: explica que o envio sai pelo CRM');
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo": true, "webhook_url_crm": "https://crm.exemplo.com/webhook"}')`, [A]);
const env = await srv.enviarCobranca(A, rg1.id, 'whatsapp');
const pedidos = await eventosCrm(A, 'COBRANCA_ENVIAR');
eq([env.enviado, env.na_fila, pedidos.at(-1)?.canal, pedidos.at(-1)?.cobranca_id], [false, true, 'whatsapp', rg1.id], 'COBRANCA_ENVIAR com o canal; CRM sem resposta: fica na fila, sem dizer que saiu');
{
  // O CRM responde 200 sempre e diz em `acao` se mandou.
  const fetchAntes = globalThis.fetch;
  let acao = 'cobrança x: enviada por e-mail';
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://crm.exemplo.com/')) return new Response(JSON.stringify({ recebido: true, processado: true, acao }), { status: 200, headers: { 'content-type': 'application/json' } });
    return fetchAntes(url);
  };
  const ok = await srv.enviarCobranca(A, rg1.id, 'email');
  acao = 'cobrança x: não enviada (o cliente não tem e-mail válido)';
  const nao = await srv.enviarCobranca(A, rg1.id, 'email');
  globalThis.fetch = fetchAntes;
  eq([ok.enviado, nao.enviado, nao.motivo], [true, false, 'o cliente não tem e-mail válido'], 'CRM mandou: enviado; CRM não mandou: o motivo dele volta para a tela');
}
const antesDoClique = (await eventosCrm(A, 'COBRANCA_ENVIAR')).length;
await srv.enviarCobranca(A, rg1.id, 'email', { idempotencia: 'clique-1' });
const repetidoEnvio = await srv.enviarCobranca(A, rg1.id, 'email', { idempotencia: 'clique-1' });
eq([(await eventosCrm(A, 'COBRANCA_ENVIAR')).length - antesDoClique, repetidoEnvio.repetido], [1, true], 'duplo clique (mesma Idempotency-Key): manda uma vez só');

console.log('--- Endereço do portal nos avisos (tabela da parte B) ---');
const links = await todos(`SELECT tenant_id, cliente_id, token_hash, token_cifrado IS NOT NULL AS cifrado FROM cobranca_portal_links WHERE revogado_em IS NULL`);
eq([links.length, links.every(l => l.cifrado && /^[0-9a-f]{64}$/.test(l.token_hash))], [2, true], 'um link ativo por cliente (SHA-256 no banco, cópia cifrada)');
const urlPortal = emitidas[0].url_portal;
const { createHash } = await import('node:crypto');
const tokenPortal = urlPortal.split('/c/')[1];
eq(links.some(l => l.tenant_id === A && l.token_hash === createHash('sha256').update(tokenPortal, 'utf8').digest('hex')), true, 'o url_portal mandado ao CRM abre o link do cliente');
eq((await eventosCrm(A, 'COBRANCA_EMITIDA')).every(e => e.url_portal === urlPortal), true, 'o mesmo endereço em todos os avisos do cliente');
await query(`UPDATE cobranca_portal_links SET revogado_em = NOW() WHERE tenant_id = $1`, [A]);
const { urlDoPortalParaCrm } = await import('../src/lib/cobranca/portal.ts');
const novoPortal = await urlDoPortalParaCrm(pool, A, `${A}-cli`);
eq([novoPortal !== urlPortal, novoPortal.startsWith('https://fin.exemplo.com/c/')], [true, true], 'link revogado: o próximo aviso leva um link novo');
eq(await urlDoPortalParaCrm(pool, A, 'cliente-que-nao-existe'), '', 'cliente que não existe: sem link');

console.log('--- Idempotency-Key na emissão ---');
await cr(A, 'ik1', `${A}-cli`, { valor_final: 70 });
const ik1 = await srv.gravarEmissao(A, { itens: [{ conta_id: 'ik1' }] }, { hoje: HOJE, idempotencia: 'chave-ik1' });
const ik2 = await srv.gravarEmissao(A, { itens: [{ conta_id: 'ik1' }] }, { hoje: HOJE, idempotencia: 'chave-ik1' });
eq([ik2.repetido, ik2.cobrancas.map(c => c.id), (await todos(`SELECT 1 FROM cobrancas WHERE titulo_id = 'ik1'`)).length],
  [true, ik1.cobrancas.map(c => c.id), 1], 'repetir com a mesma chave devolve o que foi feito, sem 409 e sem emitir de novo');

console.log('--- Modelo da descrição e conta vencida ---');
await query(`UPDATE agencia SET data = jsonb_set(data, '{cobranca,descricao_modelo}', '"{agencia} · {descricao} ({parcela})"') || '{"nome_fantasia":"Viagens Sol"}'::jsonb WHERE tenant_id = $1`, [A]);
await cr(A, 'dm1', `${A}-cli`, { descricao: 'Cruzeiro', parcela_numero: 2, total_parcelas: 5, data_vencimento: '2026-10-01' });
const pvDm = await srv.previaDaEmissao(pool, A, { itens: [{ conta_id: 'dm1' }] }, HOJE);
eq([pvDm.itens[0].ok, pvDm.itens[0].vencimento, pvDm.itens[0].avisos.length], [true, '2026-11-08', 1], 'conta vencida: sai para daqui a 3 dias, com aviso na prévia');
const dm = await srv.gravarEmissao(A, { itens: [{ conta_id: 'dm1' }] }, { hoje: HOJE });
eq(dm.cobrancas[0].descricao, 'Viagens Sol · Cruzeiro (2/5)', 'descrição pelo modelo da agência');

console.log('--- Lista ---');
const lista = await srv.listarCobrancas(pool, A, { status: ['em_aberto'] }, null);
eq([lista.total > 0, lista.itens.every(i => ['emitindo', 'aberta', 'vencida'].includes(i.status))], [true, true], 'em_aberto: emitindo, aberta e vencida');
eq([typeof lista.totais.aberto.valor, lista.totais.pago.quantidade > 0, lista.totais.pago.quantidade, Object.keys(lista.totais)],
  ['number', true, lista.por_status.paga.quantidade, ['aberto', 'vencido', 'pago', 'falhou']], 'totais nos cartões da tela, sem o filtro de situação');
const daConta = await srv.listarCobrancas(pool, B, { titulo_id: 'lb1' }, null);
eq(daConta.itens.map(i => i.status), ['paga', 'cancelada'], 'cobranças de uma conta: a mais recente primeiro');
eq((await srv.listarCobrancas(pool, A, {}, ['outra-conta'])).total, 0, 'conta bancária não liberada: some da lista');
eq((await srv.listarCobrancas(pool, A, { busca: 'Pacote rg1' }, null)).total, 1, 'busca pela descrição');
const det = await srv.detalheDaCobranca(pool, A, c1.id);
eq(det.eventos.map(e => e.tipo), ['criada', 'emitida', 'paga', 'recebida', 'recebida', 'estornada'], 'histórico completo da cobrança');

console.log('--- Rotas: o contrato das telas (contrato-telas.ts, parte B) ---');
const sessao = (perfil, t = A) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: t, tenantSlug: t });
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const rotaLista = await import('../src/app/api/cobrancas/route.ts');
const rotaUma = await import('../src/app/api/cobrancas/[id]/route.ts');
const rotaEnviar = await import('../src/app/api/cobrancas/[id]/enviar/route.ts');
const rotaCarne = await import('../src/app/api/cobrancas/carne/route.ts');
const rotaConfig = await import('../src/app/api/config/cobranca/route.ts');
const pedir = (metodo, url, corpo, cab = {}) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...cab }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });

let rl = await json(await rotaLista.GET(pedir('GET', '/api/cobrancas?status=em_aberto&de=2026-11-01&ate=2026-12-31')));
const umaDaLista = rl.corpo.cobrancas[0];
eq([rl.status, Array.isArray(rl.corpo.cobrancas), Object.keys(rl.corpo.totais)], [200, true, ['aberto', 'vencido', 'pago', 'falhou']], 'GET: { cobrancas, totais }');
eq(['id', 'conta_id', 'cliente_id', 'cliente_nome', 'descricao', 'provedor', 'tipo', 'status', 'valor', 'vencimento', 'linha_digitavel', 'codigo_barras',
  'pix_copia_cola', 'url_boleto', 'url_fatura', 'carne_id', 'erro', 'valor_pago', 'pago_em', 'criado_em', 'criado_por'].filter(k => !(k in umaDaLista)), [], 'Cobranca com todos os campos da tela');
eq([typeof umaDaLista.valor, umaDaLista.valor * 100 === umaDaLista.valor_centavos], ['number', true], 'valor em reais');

await cr(A, 'rt1', `${A}-cli`, { valor_final: 42.5 });
await cr(A, 'rt2', `${A}-cli`, { valor_final: 10 });
await query(`UPDATE clientes SET cpf_cnpj = '' WHERE id = 'cli-sem-doc'`);
const pvR = await json(await rotaLista.POST(pedir('POST', '/api/cobrancas', { modo: 'previa', contas: ['rt1', 'rg1'] })));
eq([pvR.status, pvR.corpo.provedor, pvR.corpo.prontos, typeof pvR.corpo.assinatura, pvR.corpo.itens.map(i => [i.conta_id, i.ok, i.valor, i.tipo, Boolean(i.motivo)])],
  [200, 'asaas', 1, 'string', [['rt1', true, 42.5, 'boleto_pix', false], ['rg1', false, 50, 'boleto_pix', true]]], 'prévia: itens com ok, motivo, valor em reais e tipo');
const chave = { 'Idempotency-Key': 'tela-rt1' };
const gR = await json(await rotaLista.POST(pedir('POST', '/api/cobrancas', { modo: 'gravar', contas: ['rt1', 'rg1'], assinatura: pvR.corpo.assinatura }, chave)));
eq([gR.status, gR.corpo.na_fila, gR.corpo.emitidas, gR.corpo.itens.map(i => [i.conta_id, i.ok, i.status])],
  [200, false, 1, [['rt1', true, 'aberta'], ['rg1', false, null]]], 'gravar: itens com ok/status, na_fila (boolean) e emitidas');
const gR2 = await json(await rotaLista.POST(pedir('POST', '/api/cobrancas', { modo: 'gravar', contas: ['rt1', 'rg1'], assinatura: pvR.corpo.assinatura }, chave)));
eq([gR2.status, gR2.corpo.itens[0].cobranca_id], [200, gR.corpo.itens[0].cobranca_id], 'mesma Idempotency-Key: a mesma resposta, sem emitir de novo');
const idRt1 = gR.corpo.itens[0].cobranca_id;
const det1 = await json(await rotaUma.GET(pedir('GET', `/api/cobrancas/${idRt1}`), params(idRt1)));
eq([det1.status, det1.corpo.conta_id, det1.corpo.cliente_nome, det1.corpo.valor, Array.isArray(det1.corpo.eventos)], [200, 'rt1', 'Ana Lima', 42.5, true], 'GET [id]: a Cobranca com histórico');
const sv = await json(await rotaUma.PATCH(pedir('PATCH', `/api/cobrancas/${idRt1}`, { vencimento: '2026-12-15', valor: 45 }, { 'Idempotency-Key': 'sv1' }), params(idRt1)));
eq([sv.status, sv.corpo.vencimento, sv.corpo.valor], [200, '2026-12-15', 45], 'PATCH: 2ª via com novo vencimento e valor (Asaas altera)');
const svErr = await json(await rotaUma.PATCH(pedir('PATCH', `/api/cobrancas/${idRt1}`, { vencimento: '2020-01-01' }), params(idRt1)));
eq([svErr.status, svErr.corpo.codigo], [400, 'VENCIMENTO_INVALIDO'], 'erro com código para a tela');
const en = await json(await rotaEnviar.POST(pedir('POST', `/api/cobrancas/${idRt1}/enviar`, { canal: 'email' }, { 'Idempotency-Key': 'en1' }), params(idRt1)));
eq([en.status, en.corpo.ok], [200, true], 'enviar: { ok: true }');
const del = await json(await rotaUma.DELETE(pedir('DELETE', `/api/cobrancas/${idRt1}`, undefined, { 'Idempotency-Key': 'del1' }), params(idRt1)));
const del2 = await json(await rotaUma.DELETE(pedir('DELETE', `/api/cobrancas/${idRt1}`, undefined, { 'Idempotency-Key': 'del1' }), params(idRt1)));
eq([del.status, del.corpo.ok, del.corpo.cobranca.status, del2.status, del2.corpo.ok], [200, true, 'cancelada', 200, true], 'DELETE: { ok, cobranca }; repetir dá o mesmo');
const semProv = await comNadaSai('ensaio', async () => json(await rotaLista.POST(pedir('POST', '/api/cobrancas', { modo: 'gravar', contas: ['rt2'] }, { 'Idempotency-Key': 'ns-r' }))));
eq([semProv.status, semProv.corpo.codigo], [409, 'NADA_SAI'], 'nada sai: 409 com codigo NADA_SAI');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', B);
const carneB = await json(await rotaCarne.POST(pedir('POST', '/api/cobrancas/carne', { modo: 'previa', contas: ['lb3'] })));
eq([carneB.status, carneB.corpo.codigo], [409, 'SEM_CARNE'], 'carnê no Pagar.me: SEM_CARNE');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
for (const [i, venc] of [[1, '2027-03-10'], [2, '2027-04-10']]) await cr(A, `rk${i}`, `${A}-cli`, { valor_final: 80, data_vencimento: venc });
const pvC = await json(await rotaCarne.POST(pedir('POST', '/api/cobrancas/carne', { modo: 'previa', contas: ['rk1', 'rk2'] })));
eq([pvC.status, pvC.corpo.cliente_nome, pvC.corpo.parcelas.map(p => [p.numero, p.valor, p.ok]), pvC.corpo.total], [200, 'Ana Lima', [[1, 80, true], [2, 80, true]], 160], 'prévia do carnê no formato da tela');
const gC = await json(await rotaCarne.POST(pedir('POST', '/api/cobrancas/carne', { modo: 'gravar', contas: ['rk1', 'rk2'], assinatura: pvC.corpo.assinatura }, { 'Idempotency-Key': 'carne-1' })));
eq([gC.status, gC.corpo.cobrancas.length, typeof gC.corpo.cobrancas[0], gC.corpo.url_carne?.endsWith('/carne')], [200, 2, 'string', true], 'carnê gravado: { carne_id, url_carne, cobrancas: ids }');
const gC2 = await json(await rotaCarne.POST(pedir('POST', '/api/cobrancas/carne', { modo: 'gravar', contas: ['rk1', 'rk2'], assinatura: pvC.corpo.assinatura }, { 'Idempotency-Key': 'carne-1' })));
eq([gC2.status, gC2.corpo.carne_id], [200, gC.corpo.carne_id], 'carnê repetido com a mesma chave: o mesmo carnê');
const cfg = await json(await rotaConfig.GET());
eq([cfg.status, cfg.corpo.provedor_padrao, cfg.corpo.encargos_da_politica, cfg.corpo.juros_am_pct, cfg.corpo.regua.canais, cfg.corpo.provedores.map(p => [p.id, p.conectado])],
  [200, 'asaas', true, 1, { email: true, whatsapp: true }, [['asaas', true], ['pagarme', true]]], 'GET config no formato da tela');
const cfgPut = await json(await rotaConfig.PUT(pedir('PUT', '/api/config/cobranca', { ...cfg.corpo, juros_am_pct: 2, desconto_pct: 3, desconto_dias: 5, regua: { ligada: false, dias: [0, 3], canais: { email: true, whatsapp: false } } })));
eq([cfgPut.status, cfgPut.corpo.encargos_da_politica, cfgPut.corpo.juros_am_pct, cfgPut.corpo.desconto_pct, cfgPut.corpo.regua],
  [200, false, 2, 3, { ligada: false, dias: [0, 3], canais: { email: true, whatsapp: false } }], 'PUT config: números próprios, régua');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
const proibido = await json(await rotaLista.POST(pedir('POST', '/api/cobrancas', { modo: 'previa', contas: ['rt2'] })));
eq(proibido.status, 403, 'sem o direito de emitir boleto: 403');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
