/**
 * O caminho das VENDAS por plataforma (aviso do Asaas e do Pagar.me que não
 * é cobrança do financeiro), congelado antes da E3 (05/11/2026), contra um
 * Postgres real (PGlite), rodando processarEvento DE PRODUÇÃO.
 *
 * A cobrança da E3 desvia só os avisos com referência `f1;` (ou de id de
 * cobrança nossa). Aqui se prova que todo o resto continua igual: com e sem
 * o esquema da cobrança instalado, o mesmo aviso gera as mesmas contas, o
 * mesmo caixa e a mesma resposta.
 *
 * Uso: node --no-warnings scripts/test-sql-plataformas-evento.mjs
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
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
const { processarEvento } = await import('../src/lib/plataformas/servico.ts');
const { adapterAsaas } = await import('../src/lib/plataformas/asaas.ts');
const { adapterPagarme } = await import('../src/lib/plataformas/pagarme.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');

const T = 't-venda';
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1', $1, '{"nome":"Asaas","saldo_atual":0}'), ('b2', $1, '{"nome":"Pagar.me","saldo_atual":0}')`, [T]);
await query(`INSERT INTO plataformas_config (id, tenant_id, plataforma, ativo, data) VALUES ('c1', $1, 'asaas', true, '{"conta_bancaria_id":"b1"}'), ('c2', $1, 'pagarme', true, '{"conta_bancaria_id":"b2","recebimento_antecipado":false}')`, [T]);
const semChave = { api_key: '', segredo_webhook: '', extras: {} };
const saldo = async id => Number((await query(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id])).rows[0].s);

function asaas(evento, sufixo, status, extra = {}) {
  return {
    id: `evt_${sufixo}_${evento}`, event: evento,
    payment: {
      id: `pay_${sufixo}`, customer: 'cus_1', value: 250, netValue: 247.01, billingType: 'PIX', status,
      dueDate: '2026-11-10', dateCreated: '2026-11-01', paymentDate: status === 'PENDING' ? null : '2026-11-04',
      clientPaymentDate: status === 'PENDING' ? null : '2026-11-04', creditDate: status === 'RECEIVED' ? '2026-11-04' : null,
      externalReference: `pedido-${sufixo}`, description: 'Passeio de barco', ...extra,
    },
  };
}
function pagarme(sufixo) {
  return {
    id: `hook_${sufixo}`, type: 'order.paid',
    data: {
      id: `or_${sufixo}`, code: `loja-${sufixo}`, amount: 18000, currency: 'BRL', status: 'paid', created_at: '2026-11-03T10:00:00Z',
      items: [{ id: 'oi_1', description: 'Ingresso', amount: 18000, quantity: 1 }],
      customer: { name: 'Rita Souza', email: `rita${sufixo}@exemplo.com`, document: '' },
      charges: [{ id: `ch_${sufixo}`, code: `loja-${sufixo}`, amount: 18000, status: 'paid', payment_method: 'pix', paid_at: '2026-11-03T10:05:00Z', last_transaction: { transaction_type: 'pix' } }],
    },
  };
}

async function retrato(plataforma, idTransacao, conta) {
  const contas = (await query(`SELECT status, data->>'valor_recebido' AS rec, data->>'valor_final' AS fin, data->>'origem' AS origem
                                 FROM contas_receber WHERE tenant_id = $1 AND data->>'plataforma_transacao' = $2 ORDER BY id`, [T, idTransacao])).rows
    .map(r => [r.status, Number(r.rec), Number(r.fin), r.origem]);
  const tx = (await query(`SELECT status_conciliacao FROM plataformas_transacoes WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3`, [T, plataforma, idTransacao])).rows
    .map(r => r.status_conciliacao);
  return { contas, tx, saldo: await saldo(conta) };
}

async function rodada(sufixo) {
  const r = {};
  const ev1 = await adapterAsaas.normalizar(asaas('PAYMENT_CREATED', sufixo, 'PENDING'), semChave);
  r.criado = (await processarEvento(T, 'asaas', ev1)).acao;
  const ev2 = await adapterAsaas.normalizar(asaas('PAYMENT_RECEIVED', sufixo, 'RECEIVED'), semChave);
  r.recebido = (await processarEvento(T, 'asaas', ev2)).acao;
  r.repetido = (await processarEvento(T, 'asaas', ev2)).acao;
  r.asaas = await retrato('asaas', `pay_${sufixo}`, 'b1');
  const ev3 = await adapterPagarme.normalizar(pagarme(sufixo), semChave);
  r.pagarme_acao = (await processarEvento(T, 'pagarme', ev3)).acao;
  r.pagarme = await retrato('pagarme', `or_${sufixo}`, 'b2');
  return r;
}

console.log('--- Sem o esquema da cobrança (banco antes da E3) ---');
const antes = await rodada('a');
eq(antes.criado.startsWith('PAGAMENTO_CRIADO: 1 parcela(s), caixa +0'), true, 'Asaas criado: uma conta, sem caixa');
eq(antes.recebido.startsWith('PAGAMENTO_RECEBIDO: 1 parcela(s), caixa +247.01'), true, 'Asaas recebido: caixa recebe o líquido');
eq(antes.repetido, 'duplicado, ignorado', 'o mesmo aviso de novo é ignorado');
eq(antes.asaas, { contas: [['RECEBIDO', 247.01, 250, 'VENDA_DIRETA']], tx: ['DIRETA'], saldo: 247.01 }, 'Asaas: conta recebida pelo líquido, venda direta');
eq(antes.pagarme_acao.startsWith('PAGAMENTO_CONFIRMADO: 1 parcela(s)'), true, 'Pagar.me pago: uma parcela');
eq(antes.pagarme.contas.length, 1, 'Pagar.me: uma conta a receber');
eq(antes.pagarme.tx, ['DIRETA'], 'Pagar.me: venda direta');

console.log('--- Com o esquema da cobrança instalado: tudo igual ---');
await pg.exec(COBRANCA_SCHEMA_SQL);
const saldoB1 = await saldo('b1');
const saldoB2 = await saldo('b2');
const depois = await rodada('b');
eq(depois.criado, antes.criado.replace(/pay_a/g, 'pay_b'), 'Asaas criado: mesma resposta');
eq(depois.recebido, antes.recebido.replace(/pay_a/g, 'pay_b'), 'Asaas recebido: mesma resposta');
eq(depois.repetido, antes.repetido, 'repetição: mesma resposta');
eq({ ...depois.asaas, saldo: Math.round((depois.asaas.saldo - saldoB1) * 100) / 100 }, antes.asaas, 'Asaas: mesmas contas, mesmo caixa');
eq(depois.pagarme_acao.replace(/or_b/g, 'or_a'), antes.pagarme_acao, 'Pagar.me: mesma resposta');
eq({ ...depois.pagarme, saldo: Math.round((depois.pagarme.saldo - saldoB2) * 100) / 100 }, antes.pagarme, 'Pagar.me: mesmas contas, mesmo caixa');
eq((await query(`SELECT COUNT(*)::int AS n FROM cobrancas`)).rows[0].n, 0, 'nenhuma cobrança criada por aviso de venda');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
