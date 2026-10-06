/**
 * Recebimentos da Hotmart contra um Postgres real (PGlite): a revisão do que
 * a versão anterior gravou e o fluxo de avisos de ponta a ponta.
 *
 * Os casos são os do print de 06/10/2026:
 *   - Latitude Sul: boleto/Pix gerado, ninguém pagou, aparecia "Em aberto";
 *   - Alexandre Santos: venda em 6x, "2/6 Recebido" com vencimento futuro.
 * E os que a auditoria achou junto: conta antiga duplicada, aviso fora de
 * ordem, e o que a revisão NÃO pode tocar (baixa à mão, extrato, nota).
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { sanearTransacaoHotmart, sincronizarTransacao } = await import('../src/lib/plataformas/servico.ts');
const { adapterHotmart } = await import('../src/lib/plataformas/hotmart.ts');
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
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1','t1','{"nome":"Itaú","saldo_atual":10000}'), ('b2','t2','{"nome":"Inter","saldo_atual":500}');
`);
const exec = { query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
async function emTransacao(fn) { await pg.exec('BEGIN'); try { const r = await fn(exec); await pg.exec('COMMIT'); return r; } catch (e) { await pg.exec('ROLLBACK'); throw e; } }
const saldo = async (id = 'b1') => Number((await pg.query(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE id=$1`, [id])).rows[0].s);
const cr = async id => (await pg.query(`SELECT status, data FROM contas_receber WHERE id=$1`, [id])).rows[0];
const txLida = async (id, tenant = 't1') => (await pg.query(`SELECT data FROM plataformas_transacoes WHERE id_transacao=$1 AND tenant_id=$2`, [id, tenant])).rows[0]?.data;

/** Grava uma transação no formato da VERSÃO ANTERIOR (N parcelas, status antigo). */
async function antiga(tenant, idTx, parcelas, creditado, contas, extra = {}) {
  const transacao = { id_transacao: idTx, id_assinatura: '', comprador: { nome: extra.nome ?? 'Comprador', email: '', documento: '', telefone: '' }, itens: [], valor_bruto: parcelas.reduce((s, p) => s + p.valor_bruto, 0), valor_taxa: 0, valor_liquido: 0, desconto: 0, juros: 0, moeda: 'BRL', forma_pagamento: 'CREDIT_CARD', detalhe_pagamento: '', parcelas, data_venda: parcelas[0].data_vencimento, descricao: extra.produto ?? 'Produto', bruto: {} };
  await pg.query(`INSERT INTO plataformas_transacoes (id, tenant_id, plataforma, id_transacao, status_conciliacao, data) VALUES ($1,$2,'hotmart',$3,'DIRETA',$4::jsonb)`,
    [`${tenant}-${idTx}`, tenant, idTx, JSON.stringify({ transacao, caixa_creditado: creditado })]);
  for (const c of contas) {
    await pg.query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,$3,$4::jsonb)`,
      [c.id, tenant, c.status, JSON.stringify({ id: c.id, status: c.status, valor_final: c.valor, valor_recebido: c.recebido ?? 0, conta_bancaria_id: 'b1', plataforma_origem: 'hotmart', plataforma_transacao: idTx, parcela_numero: c.numero ?? 1, observacoes: '', ...(c.extra ?? {}) })]);
  }
}

console.log('--- Latitude Sul: Pix gerado, ninguém pagou ---');
await antiga('t1', 'HPL',
  montarParcelas({ total: 247, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06', idBase: 'HPL' }), {},
  [{ id: 'plat-hotmart-HPL-1', status: 'PENDENTE', valor: 247 }], { nome: 'Latitude Sul Viagens e Turismo', produto: 'EnturOS CRM' });
{
  const antes = await saldo();
  const r = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPL', 'b1'));
  eq([r.estado, r.motivos], ['corrigida', ['NAO_PAGA']], 'a revisão reconhece cobrança não paga');
  const c = await cr('plat-hotmart-HPL-1');
  eq([c.status, c.data.status], ['CANCELADO', 'CANCELADO'], 'a conta "Em aberto" sai de Contas a receber');
  eq(/não é dinheiro a receber/.test(c.data.observacoes), true, 'com o motivo escrito na conta');
  eq((await txLida('HPL')).transacao.parcelas[0].status, 'AGUARDANDO', 'a transação fica AGUARDANDO o pagamento');
  eq(await saldo(), antes, 'o caixa não se mexe');
  const r2 = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPL', 'b1'));
  eq(r2.estado, 'em-dia', 'rodar de novo não muda nada');
}

console.log('--- Alexandre Santos: 6x no cartão, tudo "recebido" em 6 contas ---');
{
  const ps = montarParcelas({ total: 937.5, taxaTotal: 93.72, quantidade: 6, status: 'RECEBIDO', primeiroVencimento: '2026-09-28', dataPagamento: '2026-09-28', dataRecebimento: '2026-10-05', idBase: 'HP6' });
  const cred = Object.fromEntries(ps.map(p => [String(p.numero), p.valor_liquido]));
  await antiga('t1', 'HP6', ps, cred, ps.map(p => ({ id: `plat-hotmart-HP6-${p.numero}`, numero: p.numero, status: 'RECEBIDO', valor: p.valor_bruto, recebido: p.valor_liquido })), { nome: 'ALEXANDRE SANTOS', produto: 'Club Travel.IA' });
  const antes = await saldo();
  const r = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HP6', 'b1'));
  eq([r.estado, r.motivos, r.canceladas], ['corrigida', ['PARCELAS_UNIFICADAS'], 5], 'seis contas viram uma');
  const c1 = await cr('plat-hotmart-HP6-1');
  eq([c1.status, Number(c1.data.valor_final), Number(c1.data.valor_recebido)], ['RECEBIDO', 937.5, 843.78], 'a conta 1 leva a venda inteira e o líquido inteiro');
  const c2 = await cr('plat-hotmart-HP6-2');
  eq([c2.status, Number(c2.data.valor_recebido)], ['CANCELADO', 0], 'a "2/6" sai, sem valor recebido');
  eq(await saldo(), antes, 'o caixa não se mexe: o dinheiro já tinha entrado, só muda de conta');
  const t = (await txLida('HP6'));
  eq([t.transacao.parcelas.length, t.transacao.parcelas_do_comprador, t.caixa_creditado], [1, 6, { '1': 843.78 }], 'a transação guarda um recebimento e lembra do 6x');
  eq((await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HP6', 'b1'))).estado, 'em-dia', 'e rodar de novo não muda nada');
}

console.log('--- venda aprovada em 3x ainda na garantia ---');
{
  const ps = montarParcelas({ total: 600, quantidade: 3, status: 'CONFIRMADO', primeiroVencimento: '2026-10-01', dataPagamento: '2026-10-01', idBase: 'HP3' });
  await antiga('t1', 'HP3', ps, {}, ps.map(p => ({ id: `plat-hotmart-HP3-${p.numero}`, numero: p.numero, status: 'PENDENTE', valor: p.valor_bruto })));
  const antes = await saldo();
  await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HP3', 'b1'));
  const c1 = await cr('plat-hotmart-HP3-1');
  eq([c1.status, Number(c1.data.valor_final), c1.data.data_vencimento], ['PENDENTE', 600, '2026-10-01'], 'um a receber de 600, não três meses de 200');
  eq([(await cr('plat-hotmart-HP3-2')).status, (await cr('plat-hotmart-HP3-3')).status], ['CANCELADO', 'CANCELADO'], 'as parcelas 2 e 3 saem');
  eq(await saldo(), antes, 'e o caixa não se mexe (nada liberado ainda)');
}

console.log('--- conta da versão antiga duplicada ---');
{
  const ps = montarParcelas({ total: 100, quantidade: 1, status: 'RECEBIDO', primeiroVencimento: '2026-09-01', idBase: 'HPX' });
  await antiga('t1', 'HPX', ps, { '1': 100 }, [
    { id: 'plat-hotmart-HPX', status: 'RECEBIDO', valor: 100, recebido: 100 },
    { id: 'plat-hotmart-HPX-1', status: 'RECEBIDO', valor: 100, recebido: 100 },
  ]);
  const antes = await saldo();
  const r = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPX', 'b1'));
  eq(r.motivos, ['DUPLICATA_DA_CONTA_ANTIGA'], 'a duplicata é reconhecida');
  eq([(await cr('plat-hotmart-HPX')).status, (await cr('plat-hotmart-HPX-1')).status], ['CANCELADO', 'RECEBIDO'], 'a antiga sai, a numerada fica');
  eq(await saldo(), antes, 'e a receita deixa de contar duas vezes sem mexer no caixa');
}

console.log('--- o que a revisão não toca ---');
{
  await antiga('t1', 'HPM', montarParcelas({ total: 247, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06' }), {},
    [{ id: 'plat-hotmart-HPM-1', status: 'RECEBIDO', valor: 247, recebido: 247 }]);
  const r = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPM', 'b1'));
  eq([r.estado, (r.pulada ?? '').includes('baixada à mão')], ['pulada', true], 'conta baixada à mão: pulada e listada');
  eq((await cr('plat-hotmart-HPM-1')).status, 'RECEBIDO', 'e fica como a pessoa deixou');

  const ps = montarParcelas({ total: 200, quantidade: 2, status: 'RECEBIDO', primeiroVencimento: '2026-09-01' });
  await antiga('t1', 'HPC', ps, { '1': 100, '2': 100 }, ps.map(p => ({ id: `plat-hotmart-HPC-${p.numero}`, numero: p.numero, status: 'RECEBIDO', valor: 100, recebido: 100 })));
  await pg.query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, status_conciliacao, data) VALUES ('e1','t1','b1','CONCILIADO',$1::jsonb)`,
    [JSON.stringify({ status_conciliacao: 'CONCILIADO', lancamento_vinculado_id: 'plat-hotmart-HPC-2', vinculos: [{ id: 'plat-hotmart-HPC-2', tipo: 'CONTA_RECEBER' }] })]);
  const r2 = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPC', 'b1'));
  eq([r2.estado, (r2.pulada ?? '').includes('conciliada')], ['pulada', true], 'parcela conciliada no extrato: pulada');
  eq((await cr('plat-hotmart-HPC-2')).status, 'RECEBIDO', 'e a conciliação continua valendo');

  const ps3 = montarParcelas({ total: 200, quantidade: 2, status: 'RECEBIDO', primeiroVencimento: '2026-09-01' });
  await antiga('t1', 'HPN', ps3, { '1': 100, '2': 100 }, ps3.map(p => ({ id: `plat-hotmart-HPN-${p.numero}`, numero: p.numero, status: 'RECEBIDO', valor: 100, recebido: 100 })));
  await pg.query(`INSERT INTO notas_fiscais (id, tenant_id, conta_receber_id, status) VALUES ('n1','t1','plat-hotmart-HPN-2','AUTORIZADA')`);
  const r3 = await emTransacao(x => sanearTransacaoHotmart(x, 't1', 'HPN', 'b1'));
  eq([r3.estado, (r3.pulada ?? '').includes('nota fiscal')], ['pulada', true], 'parcela com nota fiscal: pulada');
}

console.log('--- outra agência com o mesmo id de transação ---');
{
  await antiga('t2', 'HPL', montarParcelas({ total: 99, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06' }), {},
    [{ id: 'plat-hotmart-HPL-1-t2', status: 'PENDENTE', valor: 99 }]);
  eq((await cr('plat-hotmart-HPL-1-t2')).status, 'PENDENTE', 'a revisão da agência A não tocou a B');
}

console.log('--- fluxo novo, aviso a aviso ---');
const aviso = async (evento, extra = {}) => adapterHotmart.normalizar({ creation_date: extra.criado, event: evento, data: { product: { id: '7343064', name: 'EnturOS CRM' }, buyer: { name: 'Nova Agência', email: 'nova@x.com' }, purchase: { transaction: 'HPN2', order_date: 1791259200000, approved_date: 1791262800000, warranty_expire_date: 1791867600000, price: { value: 497 }, commission_fee: 40, payment: { type: 'CREDIT_CARD', installments_number: 3 } } } }, { segredo_webhook: 'x', extras: {} });
const sinc = ev => emTransacao(x => sincronizarTransacao(x, 't1', 'hotmart', ev.transacao, { contaBancariaId: 'b1', conciliacaoAutomatica: false }));
{
  const s0 = await saldo();
  await sinc(await aviso('PURCHASE_BILLET_PRINTED'));
  eq(await cr('plat-hotmart-HPN2-1'), undefined, 'boleto gerado: nenhuma conta a receber nasce');
  await sinc(await aviso('PURCHASE_APPROVED'));
  const c = await cr('plat-hotmart-HPN2-1');
  eq([c.status, Number(c.data.valor_final), c.data.data_prevista_recebimento], ['PENDENTE', 497, '2026-10-13'], 'aprovado em 3x: UM a receber de 497, previsto para o fim da garantia');
  eq(await cr('plat-hotmart-HPN2-2'), undefined, 'sem parcelas 2 e 3');
  eq(await saldo(), s0, 'aprovado não é caixa');
  await sinc(await aviso('PURCHASE_COMPLETE', { criado: 1791900000000 }));
  eq([(await cr('plat-hotmart-HPN2-1')).status, await saldo()], ['RECEBIDO', s0 + 457], 'concluído: recebido, e o caixa recebe o líquido');
  await sinc(await aviso('PURCHASE_APPROVED'));
  eq([(await cr('plat-hotmart-HPN2-1')).status, await saldo()], ['RECEBIDO', s0 + 457], '"aprovado" fora de ordem não desfaz o recebido nem estorna o caixa');
  await sinc(await aviso('PURCHASE_REFUNDED'));
  eq([(await cr('plat-hotmart-HPN2-1')).status, await saldo()], ['CANCELADO', s0], 'reembolso cancela e devolve exatamente o que entrou');
}
{
  // Transação antiga em 6x que recebe um aviso novo: é unificada antes.
  const ps = montarParcelas({ total: 600, quantidade: 6, status: 'CONFIRMADO', primeiroVencimento: '2026-10-01', dataPagamento: '2026-10-01', idBase: 'HPV' });
  await antiga('t1', 'HPV', ps, {}, ps.map(p => ({ id: `plat-hotmart-HPV-${p.numero}`, numero: p.numero, status: 'PENDENTE', valor: p.valor_bruto })));
  const s0 = await saldo();
  const ev = await adapterHotmart.normalizar({ creation_date: 1791900000000, event: 'PURCHASE_COMPLETE', data: { purchase: { transaction: 'HPV', approved_date: 1791262800000, price: { value: 600 } } } }, { segredo_webhook: 'x', extras: {} });
  await sinc(ev);
  eq([(await cr('plat-hotmart-HPV-1')).status, Number((await cr('plat-hotmart-HPV-1')).data.valor_final), (await cr('plat-hotmart-HPV-4')).status], ['RECEBIDO', 600, 'CANCELADO'], 'aviso novo numa venda antiga em 6x: unifica e recebe a venda inteira');
  eq(await saldo(), s0 + 600, 'com o caixa recebendo exatamente o valor da venda, uma vez');
}

console.log(`\n${total - falhas}/${total} testes SQL da Hotmart passaram`);
if (falhas > 0) process.exit(1);
