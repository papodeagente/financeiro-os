/**
 * Pagar.me contra um Postgres real (PGlite): o caso da Bruna Moura, 08/10/2026.
 *
 * R$ 3.860,00 em 12x no cartão, antecipado. A versão anterior gravou duas
 * transações (pedido or_ e cobrança ch_), 24 contas de R$ 321,67, e a venda
 * do CRM ficou solta. Aqui:
 *   A) aviso novo: pedido e cobrança caem na mesma venda, num lançamento só;
 *   B) a revisão corrige o que já estava gravado e liga a venda do CRM;
 *   C) o CRM informando o LINK (pl_) acha a transação do pedido;
 *   D) a venda que chega depois procura o pagamento sem dono;
 *   E) baixa feita por uma pessoa não é desfeita pelo aviso seguinte.
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { sincronizarTransacao } = await import('../src/lib/plataformas/servico.ts');
const { adapterPagarme } = await import('../src/lib/plataformas/pagarme.ts');
const { revisarPagarmeDoTenant } = await import('../src/lib/plataformas/revisao-pagarme.ts');
const { vincularPagamentosDaVendaCRM, reconciliarPagamentosSemDono } = await import('../src/lib/crm-venda-plataforma.ts');
const { montarParcelas } = await import('../src/lib/plataformas/comum.ts');

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
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma, id_transacao));
  CREATE TABLE plataformas_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT false, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plataformas_revisoes (tenant_id TEXT NOT NULL, chave TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'RODANDO', resultado JSONB NOT NULL DEFAULT '{}'::jsonb, executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, chave));
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1','t1','{"nome":"Itaú","saldo_atual":10000}');
  INSERT INTO plataformas_config (id, tenant_id, plataforma, ativo, data) VALUES ('cfg1','t1','pagarme',true,'{"conta_bancaria_id":"b1","conciliacao_automatica":true}');
`);
const exec = { query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
async function emTransacao(fn) { await pg.exec('BEGIN'); try { const r = await fn(exec); await pg.exec('COMMIT'); return r; } catch (e) { await pg.exec('ROLLBACK'); throw e; } }
const saldo = async () => Number((await pg.query(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE id='b1'`)).rows[0].s);
const contasDe = async tx => (await pg.query(`SELECT id, status, data FROM contas_receber WHERE tenant_id='t1' AND data->>'plataforma_transacao' = $1 ORDER BY id`, [tx])).rows;
const vivas = rows => rows.filter(r => r.status !== 'CANCELADO');
const tx = async id => (await pg.query(`SELECT status_conciliacao, venda_id, data FROM plataformas_transacoes WHERE tenant_id='t1' AND id_transacao=$1`, [id])).rows[0];
const opcoes = { contaBancariaId: 'b1', conciliacaoAutomatica: true, recebimentoAntecipado: true };
const semChave = { api_key: '', segredo_webhook: '', extras: {} };

function avisos(sufixo, email = 'bruna@exemplo.com', valorCentavos = 386000, documento = '') {
  const cliente = { name: 'Bruna Moura', email, document: documento };
  const cobranca = {
    id: `ch_${sufixo}`, code: `pl_${sufixo}`, amount: valorCentavos, status: 'paid', payment_method: 'credit_card',
    paid_at: '2026-10-08T15:05:24Z', created_at: '2026-10-08T15:05:20Z', customer: cliente,
    last_transaction: { installments: 12, card: { brand: 'visa', last_four_digits: '4242' } },
  };
  const pedido = {
    id: `or_${sufixo}`, code: `pl_${sufixo}`, amount: valorCentavos, currency: 'BRL', status: 'paid', created_at: '2026-10-08T15:05:20Z',
    customer: cliente, items: [{ id: 'oi', description: 'Formação Agente Independente', quantity: 1, amount: valorCentavos }], charges: [cobranca],
  };
  return {
    pedido: { id: `hk_o_${sufixo}`, type: 'order.paid', data: pedido },
    cobranca: { id: `hk_c_${sufixo}`, type: 'charge.paid', data: { ...cobranca, order: { id: pedido.id, code: pedido.code } } },
  };
}
const normalizar = async aviso => (await adapterPagarme.normalizar(aviso, semChave)).transacao;

// ── A) aviso novo ──────────────────────────────────────────────────────────
console.log('--- A) pedido e cobrança: uma venda, um lançamento ---');
{
  const a = avisos('A');
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.pedido), opcoes));
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.cobranca), opcoes));
  const n = (await pg.query(`SELECT count(*)::int n FROM plataformas_transacoes WHERE tenant_id='t1' AND plataforma='pagarme'`)).rows[0].n;
  eq(n, 1, 'uma transação só (antes: or_ e ch_)');
  const crs = vivas(await contasDe('or_A'));
  eq(crs.length, 1, 'uma conta a receber (antes: 24)');
  const d = crs[0].data;
  eq([crs[0].id, d.valor_final, d.status], ['plat-pagarme-or_A-1', 3860, 'PENDENTE'], 'R$ 3.860,00 em aberto até o repasse');
  eq(d.descricao, 'Formação Agente Independente · Pagar.me', 'a cobrança não trocou a descrição pelo link');
  eq([d.plataforma_parcelas_comprador, d.plataforma_valor_parcela_comprador, d.plataforma_cartao, d.plataforma_cartao_final, d.plataforma_antecipada],
    [12, 321.67, 'visa', '4242', true], 'o detalhe: 12x de R$ 321,67, Visa final 4242, antecipada');
  eq(d.plataforma_ids.includes('pl_A') && d.plataforma_ids.includes('ch_A'), true, 'a conta conhece o link e a cobrança');
  eq(await saldo(), 10000, 'pago no cartão não é caixa: nada entrou ainda');

  // O repasse caiu: o aviso traz as parcelas liquidadas.
  const t = await normalizar(a.pedido);
  t.parcelas = t.parcelas.map(p => ({ ...p, status: 'RECEBIDO', valor_taxa: 10, valor_liquido: p.valor_bruto - 10, data_recebimento: '2026-10-10', data_prevista_recebimento: '2026-10-10' }));
  await emTransacao(x => sincronizarTransacao(x, 't1', 'pagarme', t, opcoes));
  const [c] = vivas(await contasDe('or_A'));
  eq([c.status, c.data.valor_recebido, c.data.data_recebimento], ['RECEBIDO', 3740, '2026-10-10'], 'recebida pelo líquido, de uma vez');
  eq(await saldo(), 13740, 'o caixa recebe R$ 3.740,00 uma vez');
  await emTransacao(x => sincronizarTransacao(x, 't1', 'pagarme', t, opcoes));
  eq(await saldo(), 13740, 'aviso repetido não credita de novo');
}

// ── B) a revisão do que já estava gravado ──────────────────────────────────
console.log('--- B) a revisão: duplicata, 12 contas e a venda do CRM ---');
{
  // Como a versão anterior gravava: duas transações, 12 contas cada.
  const a = avisos('B');
  async function gravarComoAntes(id, aviso, descricao) {
    const parcelas = montarParcelas({ total: 3860, quantidade: 12, status: 'CONFIRMADO', primeiroVencimento: '2026-10-08', dataPagamento: '2026-10-08', idBase: id });
    const transacao = { id_transacao: id, id_assinatura: '', comprador: { nome: 'Bruna Moura', email: 'bruna@exemplo.com', documento: '12345678909', telefone: '' }, itens: [], valor_bruto: 3860, valor_taxa: 0, valor_liquido: 3860, desconto: 0, juros: 0, moeda: 'BRL', forma_pagamento: 'credit_card', detalhe_pagamento: 'visa', parcelas, data_venda: '2026-10-08', descricao, bruto: aviso };
    await pg.query(`INSERT INTO plataformas_transacoes (id, tenant_id, plataforma, id_transacao, status_conciliacao, data) VALUES ($1,'t1','pagarme',$2,'DIRETA',$3::jsonb)`,
      [`row-${id}`, id, JSON.stringify({ transacao, caixa_creditado: {} })]);
    for (const p of parcelas) {
      await pg.query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,'t1','PENDENTE',$2::jsonb)`,
        [`plat-pagarme-${id}-${p.numero}`, JSON.stringify({ status: 'PENDENTE', valor_final: p.valor_bruto, descricao: `${descricao} (${p.numero}/12) · pagarme`, data_vencimento: p.data_vencimento, plataforma_origem: 'pagarme', plataforma_transacao: id, parcela_numero: p.numero, conta_bancaria_id: 'b1' })]);
    }
  }
  await gravarComoAntes('or_B', a.pedido, 'Formação Agente Independente');
  await gravarComoAntes('ch_B', a.cobranca, 'pl_B');
  // A venda ganha no CRM, com a conta dela, e o CPF e o e-mail da Bruna no cadastro.
  await pg.query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('cli6','t1','Nutricionista Bruna Moura','123.456.789-09','{"email":"bruna@exemplo.com"}')`);
  await pg.query(`INSERT INTO vendas_crm (id, tenant_id, cliente_id, status, data) VALUES ('v6','t1','cli6','FECHADA','{"numero":"VND-0006","valor_total":3860,"data_venda":"2026-10-08"}')`);
  await pg.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('cr-v6','t1','v6','PENDENTE','{"status":"PENDENTE","valor_final":3860,"valor_original":3860,"data_vencimento":"2026-11-08","origem_venda_id":"v6","venda_id":"v6"}')`);
  const antes = await saldo();

  const r = await revisarPagarmeDoTenant('t1', exec);
  eq([r.duplicatas_absorvidas, r.unificadas, r.vinculadas, r.erros], [1, 1, 1, []], 'absorveu 1 duplicata, juntou 1 venda e ligou 1 ao CRM');
  eq((await tx('ch_B')).status_conciliacao, 'ABSORVIDA', 'a transação da cobrança foi absorvida');
  eq(vivas(await contasDe('ch_B')).length, 0, 'as 12 contas com o nome do link foram canceladas');
  const crs = vivas(await contasDe('or_B'));
  eq(crs.map(c => [c.id, c.data.valor_final]), [['plat-pagarme-or_B-1', 3860]], 'o pedido ficou com UMA conta de R$ 3.860,00');
  const t = await tx('or_B');
  eq([t.status_conciliacao, t.venda_id], ['VINCULADA', 'v6'], 'ligada à venda VND-0006 pelo CPF (era "venda direta" do robô)');
  eq(t.data.transacao.ids_alternativos.includes('pl_B'), true, 'o pedido conhece o link da duplicata');
  const crm = (await pg.query(`SELECT status FROM contas_receber WHERE id='cr-v6'`)).rows[0].status;
  eq(crm, 'CANCELADO', 'a conta do CRM foi substituída pelo recebimento da plataforma: nada em dobro');
  eq(await saldo(), antes, 'a revisão não mexeu no caixa (nada tinha caído)');
  const de_novo = await revisarPagarmeDoTenant('t1', exec);
  eq([de_novo.duplicatas_absorvidas, de_novo.unificadas, de_novo.vinculadas], [0, 0, 0], 'rodar de novo não muda nada');

  // Aviso que chega depois pela cobrança antiga cai no pedido, não ressuscita a duplicata.
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.cobranca), opcoes));
  eq(vivas(await contasDe('ch_B')).length + vivas(await contasDe('or_B')).length, 1, 'aviso tardio da cobrança: continua uma conta só');
}

// ── C) o CRM informou o link ───────────────────────────────────────────────
console.log('--- C) o CRM guarda o link (pl_), a transação é o pedido (or_) ---');
{
  const a = avisos('C', 'outra@exemplo.com', 120000);
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.pedido), { ...opcoes, conciliacaoAutomatica: false }));
  await pg.query(`INSERT INTO vendas_crm (id, tenant_id, status, data) VALUES ('v7','t1','FECHADA','{"valor_total":1200,"data_venda":"2026-10-08","plataforma_transacao":"pl_C"}')`);
  const r = await emTransacao(x => vincularPagamentosDaVendaCRM(x, 't1', 'v7', { plataforma: 'pagarme', transacoes: ['pl_C'] }));
  eq([r.vinculadas, r.aguardando], [['or_C'], []], 'o link achou o pedido (antes ficava "aguardando" para sempre)');
  eq((await tx('or_C')).venda_id, 'v7', 'vinculada');
}

// ── D) a venda chega depois ────────────────────────────────────────────────
console.log('--- D) a venda do CRM chega depois e procura o pagamento ---');
{
  async function semDono(sufixo, email, status, extra = {}, documento = '') {
    const a = avisos(sufixo, email, 50000, documento);
    await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.pedido), { ...opcoes, conciliacaoAutomatica: false }));
    await pg.query(`UPDATE plataformas_transacoes SET status_conciliacao=$2, venda_id='', data = data || $3::jsonb WHERE id_transacao=$1`, [`or_${sufixo}`, status, JSON.stringify(extra)]);
  }
  await semDono('D1', 'd1@exemplo.com', 'DIRETA');
  await semDono('D2', 'd2@exemplo.com', 'DIRETA', {}, '98765432100');
  await semDono('D3', 'd3@exemplo.com', 'DIRETA', { direta_por_pessoa: true });
  for (const [v, email, doc] of [['v81', 'd1@exemplo.com', ''], ['v82', 'd2@exemplo.com', '987.654.321-00'], ['v83', 'd3@exemplo.com', '']]) {
    await pg.query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ($1,'t1','Cliente',$3,$2::jsonb)`, [`c-${v}`, JSON.stringify({ email }), doc]);
    await pg.query(`INSERT INTO vendas_crm (id, tenant_id, cliente_id, status, data) VALUES ($1,'t1',$2,'FECHADA','{"valor_total":500,"data_venda":"2026-10-09"}')`, [v, `c-${v}`]);
  }
  const r1 = await emTransacao(x => reconciliarPagamentosSemDono(x, 't1', 'v81'));
  eq([r1.vinculadas, r1.sugeridas], [[], ['or_D1']], 'só e-mail, valor e data: sugestão (valor e data não identificam ninguém)');
  eq((await tx('or_D1')).status_conciliacao, 'SUGERIDA', 'aparece na fila para confirmar');
  const r2 = await emTransacao(x => reconciliarPagamentosSemDono(x, 't1', 'v82'));
  eq(r2.vinculadas, ['or_D2'], 'mesmo CPF e conciliação automática: vincula, mesmo tendo sido "venda direta" do robô');
  const r3 = await emTransacao(x => reconciliarPagamentosSemDono(x, 't1', 'v83'));
  eq([r3.vinculadas, r3.sugeridas, (await tx('or_D3')).status_conciliacao], [[], [], 'DIRETA'], '"venda direta" marcada por uma pessoa não é reaberta');
}

// ── E) baixa de pessoa ─────────────────────────────────────────────────────
console.log('--- E) baixa feita por uma pessoa não é desfeita ---');
{
  const a = avisos('E', 'e@exemplo.com', 100000);
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.pedido), opcoes));
  // A pessoa deu baixa à mão (o PUT move o caixa).
  await pg.query(`UPDATE contas_receber SET status='RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":1000,"data_recebimento":"2026-10-09"}'::jsonb WHERE id='plat-pagarme-or_E-1'`);
  await pg.query(`UPDATE contas_bancarias SET data = jsonb_set(data,'{saldo_atual}', to_jsonb((data->>'saldo_atual')::numeric + 1000)) WHERE id='b1'`);
  const antes = await saldo();
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.cobranca), opcoes));
  const [c] = vivas(await contasDe('or_E'));
  eq([c.status, c.data.valor_recebido], ['RECEBIDO', 1000], 'o aviso seguinte não voltou a conta para "em aberto"');
  const t = await normalizar(a.pedido);
  t.parcelas = t.parcelas.map(p => ({ ...p, status: 'RECEBIDO', valor_liquido: p.valor_bruto, data_recebimento: '2026-10-10' }));
  await emTransacao(x => sincronizarTransacao(x, 't1', 'pagarme', t, opcoes));
  eq(await saldo(), antes, 'o repasse confirmado não credita de novo o que a pessoa já baixou');
}

// ── F) quem não antecipa ───────────────────────────────────────────────────
console.log('--- F) antecipação desligada: uma conta por parcela, como antes ---');
{
  const a = avisos('F', 'f@exemplo.com', 120000);
  await emTransacao(async x => sincronizarTransacao(x, 't1', 'pagarme', await normalizar(a.pedido), { ...opcoes, recebimentoAntecipado: false }));
  eq(vivas(await contasDe('or_F')).length, 12, '12 contas, mês a mês');
}

console.log(`\n${total - falhas}/${total} testes do Pagar.me no banco passaram`);
if (falhas > 0) process.exit(1);
