/**
 * Conciliação bancária e importação de extrato contra um Postgres real
 * (PGlite), rodando o código de produção com o executor injetado.
 *
 * O que se prova: a baixa sai com a data e o valor do banco e move o saldo
 * certo; conta já paga só ganha a prova; conta nova nasce baixada e
 * conciliada; desfazer devolve tudo, inclusive o saldo, e recusa quando a
 * conta mudou depois; nada vaza entre agências; e a importação avisa o
 * andamento sem perder a idempotência.
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { conciliarComContas, conciliarCriandoConta, desfazerConciliacao } = await import('../src/lib/conciliacao-servidor.ts');
const { importarExtrato } = await import('../src/lib/extrato-importacao.ts');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function recusa(fn) {
  try { await fn(); return null; } catch (e) { return { status: e.status ?? 0, msg: e.message }; }
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1','t1','{"nome":"Itaú","saldo_atual":0}'), ('b2','t2','{"nome":"Inter","saldo_atual":0}');
  INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('imp','t1','2.3','{"codigo":"2.3","nome":"Impostos","natureza_custo":"FIXO","is_custo_comercial":false}');
  INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('v1','t1','{"numero":"V1"}');
`);
const exec = { query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
/** Igual à rota: tudo dentro de uma transação, que volta inteira se falhar. */
async function emTransacao(fn) {
  await pg.exec('BEGIN');
  try { const r = await fn(exec); await pg.exec('COMMIT'); return r; } catch (e) { await pg.exec('ROLLBACK'); throw e; }
}

const saldo = async id => Number((await pg.query(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE id=$1`, [id])).rows[0].s);
const linha = async (id, t = 't1', conta = 'b1') => {
  const r = await pg.query(`SELECT data FROM extrato_bancario WHERE id=$1`, [id]);
  return r.rows[0]?.data;
};
async function novaLinha(id, valor, data = '2026-10-05', desc = 'Pix', tenant = 't1', conta = 'b1', extra = {}) {
  const d = { id, conta_bancaria_id: conta, data, descricao: desc, valor, tipo: valor >= 0 ? 'CREDITO' : 'DEBITO', status_conciliacao: 'PENDENTE', lancamento_vinculado_id: null, lancamento_vinculado_tipo: null, ...extra };
  await pg.query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, status_conciliacao, data) VALUES ($1,$2,$3,$4,$5::jsonb)`, [id, tenant, conta, d.status_conciliacao, JSON.stringify(d)]);
}
async function cr(id, valor, venc, status = 'PENDENTE', extra = {}, tenant = 't1') {
  await pg.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ($1,$2,'v1',$3,$4::jsonb)`,
    [id, tenant, status, JSON.stringify({ id, status, valor_final: valor, data_vencimento: venc, valor_recebido: null, data_recebimento: null, conta_bancaria_id: null, venda_id: 'v1', ...extra })]);
}
async function cp(id, valor, venc, status = 'PENDENTE', extra = {}) {
  await pg.query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1,'t1',$2,$3::jsonb)`,
    [id, status, JSON.stringify({ id, status, valor_final: valor, data_vencimento: venc, valor_pago: null, data_pagamento: null, conta_bancaria_id: null, ...extra })]);
}
const conta = async (tabela, id) => (await pg.query(`SELECT status, data FROM ${tabela} WHERE id=$1`, [id])).rows[0];

console.log('--- entrada que quita uma conta a receber ---');
await novaLinha('e1', 1000, '2026-10-05');
await cr('r1', 1000, '2026-10-10');
{
  const r = await emTransacao(x => conciliarComContas(x, 't1', 'e1', [{ tipo: 'CONTA_RECEBER', id: 'r1' }]));
  const c = await conta('contas_receber', 'r1');
  eq([c.status, c.data.status, c.data.valor_recebido, c.data.data_recebimento, c.data.conta_bancaria_id], ['RECEBIDO', 'RECEBIDO', 1000, '2026-10-05', 'b1'], 'conta recebida com a data, o valor e o banco do extrato');
  eq(await saldo('b1'), 1000, 'o saldo do Itaú subiu 1.000');
  const l = await linha('e1');
  eq([l.status_conciliacao, l.lancamento_vinculado_id, l.vinculos.length, l.vinculos[0].acao], ['CONCILIADO', 'r1', 1, 'BAIXAR'], 'a linha fica conciliada e registra o que fez');
  eq(r.vinculos[0].antes.status, 'PENDENTE', 'e guarda o que a conta era');
  eq((await pg.query(`SELECT status_conciliacao s FROM extrato_bancario WHERE id='e1'`)).rows[0].s, 'CONCILIADO', 'a coluna de status também');
}
{
  const r = await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'e1', [{ tipo: 'CONTA_RECEBER', id: 'r1' }])));
  eq(r?.status, 409, 'conciliar de novo a mesma linha é recusado');
  eq(await saldo('b1'), 1000, 'e o saldo não credita duas vezes');
  await novaLinha('e1b', 1000, '2026-10-06');
  const r2 = await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'e1b', [{ tipo: 'CONTA_RECEBER', id: 'r1' }])));
  eq(r2?.status, 409, 'a mesma conta não serve para outra linha do extrato');
}

console.log('--- um Pix que paga uma parcela e meia ---');
await novaLinha('e2', 1500, '2026-10-05');
await cr('r2', 1000, '2026-11-10');
await cr('r3', 1000, '2026-12-10');
{
  await emTransacao(x => conciliarComContas(x, 't1', 'e2', [{ tipo: 'CONTA_RECEBER', id: 'r3' }, { tipo: 'CONTA_RECEBER', id: 'r2' }]));
  const a = await conta('contas_receber', 'r2'), b = await conta('contas_receber', 'r3');
  eq([a.status, a.data.valor_recebido], ['RECEBIDO', 1000], 'a parcela que vence antes quita');
  eq([b.status, b.data.valor_recebido], ['PARCIAL', 500], 'a seguinte fica parcial com 500');
  eq(await saldo('b1'), 2500, 'o saldo sobe exatamente 1.500');
}

console.log('--- recusas não gravam nada ---');
await novaLinha('e3', 1200, '2026-10-05');
await cr('r4', 1000, '2026-10-10');
{
  const r = await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'e3', [{ tipo: 'CONTA_RECEBER', id: 'r4' }])));
  eq([r?.status, /Sobram/.test(r?.msg ?? '')], [422, true], 'banco maior que a conta: recusa dizendo quanto sobra');
  eq([(await conta('contas_receber', 'r4')).status, await saldo('b1'), (await linha('e3')).status_conciliacao], ['PENDENTE', 2500, 'PENDENTE'], 'e nada mudou');
  await cp('p0', 1200, '2026-10-10');
  const r2 = await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'e3', [{ tipo: 'CONTA_PAGAR', id: 'p0' }])));
  eq(r2?.status, 422, 'entrada com conta a pagar é recusada');
}

console.log('--- saída que prova uma conta já paga ---');
await pg.query(`UPDATE contas_bancarias SET data = jsonb_set(data,'{saldo_atual}','2003'::jsonb) WHERE id='b1'`); // 2.500 - 497 já pagos pela tela
await novaLinha('s1', -497, '2026-10-05', 'Pix enviado: "Cp :1234567-CEF MATRIZ"');
await cp('p1', 497, '2026-10-05', 'PAGO', { valor_pago: 497, data_pagamento: '2026-10-05', conta_bancaria_id: 'b1' });
{
  await emTransacao(x => conciliarComContas(x, 't1', 's1', [{ tipo: 'CONTA_PAGAR', id: 'p1' }]));
  const c = await conta('contas_pagar', 'p1');
  eq([c.status, c.data.valor_pago, c.data.extrato_conciliado_id], ['PAGO', 497, 's1'], 'a conta paga só ganha o vínculo');
  eq(await saldo('b1'), 2003, 'o saldo não sai de novo');
}

console.log('--- saída sem conta: cria a conta já paga ---');
await novaLinha('s2', -396.58, '2026-10-05', 'Pix enviado: "Cp :60701190-RECEITA FEDERAL"');
{
  const r = await emTransacao(x => conciliarCriandoConta(x, 't1', 's2', { nome: 'Receita Federal', descricao: 'DARF de setembro', categoria_id: 'imp' }));
  const c = await conta('contas_pagar', r.conta.id);
  eq([c.status, c.data.valor_final, c.data.valor_pago, c.data.data_pagamento, c.data.conta_bancaria_id, c.data.fornecedor_nome], ['PAGO', 396.58, 396.58, '2026-10-05', 'b1', 'Receita Federal'], 'conta a pagar nasce paga, com o valor e o dia do banco');
  eq([c.data.categoria_id, c.data.natureza_custo, c.data.forma_pagamento], ['imp', 'FIXO', 'PIX'], 'categoria, natureza do plano de contas e forma lida da descrição');
  eq(await saldo('b1'), 1606.42, 'e o saldo sai 396,58');
  eq((await linha('s2')).vinculos[0].acao, 'CRIADA', 'a linha registra que a conta foi criada aqui');
  const semNome = await recusa(() => emTransacao(x => conciliarCriandoConta(x, 't1', 'e3', { nome: '  ', descricao: '' })));
  eq(semNome?.status, 400, 'sem nome de quem pagou ou recebeu não cria');
}
{
  await novaLinha('e4', 350, '2026-10-05', 'PIX RECEBIDO - MARIA');
  const r = await emTransacao(x => conciliarCriandoConta(x, 't1', 'e4', { nome: 'Maria', descricao: 'Sinal', venda_id: 'v1', cliente_id: 'c1' }));
  const c = await conta('contas_receber', r.conta.id);
  eq([c.status, c.data.origem, c.data.venda_id, c.data.origem_venda_id, c.data.valor_recebido], ['RECEBIDO', 'VENDA', 'v1', 'v1', 350], 'recebimento lançado na venda nasce recebido');
  eq(await saldo('b1'), 1956.42, 'e o saldo sobe 350');
  const errada = await recusa(() => emTransacao(x => conciliarCriandoConta(x, 't1', 'e3', { nome: 'X', descricao: '', venda_id: 'nao-existe' })));
  eq(errada?.status, 404, 'venda inexistente é recusada');
}

console.log('--- desfazer ---');
{
  const antes = await saldo('b1');
  const r = await emTransacao(x => desfazerConciliacao(x, 't1', 'e2'));
  eq(r.restauradas, 2, 'as duas parcelas voltam');
  const a = await conta('contas_receber', 'r2'), b = await conta('contas_receber', 'r3');
  eq([a.status, a.data.valor_recebido, a.data.data_recebimento, b.status, b.data.valor_recebido], ['PENDENTE', null, null, 'PENDENTE', null], 'ao que eram antes');
  eq('extrato_conciliado_id' in a.data, false, 'sem o vínculo');
  eq(await saldo('b1'), Math.round((antes - 1500) * 100) / 100, 'o saldo devolve os 1.500');
  const l = await linha('e2');
  eq([l.status_conciliacao, l.lancamento_vinculado_id, 'vinculos' in l], ['PENDENTE', null, false], 'a linha volta à fila, limpa');
}
{
  const antes = await saldo('b1');
  const id = (await linha('s2')).vinculos[0].id;
  await emTransacao(x => desfazerConciliacao(x, 't1', 's2'));
  eq(await conta('contas_pagar', id), undefined, 'conta criada na conciliação é apagada');
  eq(await saldo('b1'), Math.round((antes + 396.58) * 100) / 100, 'e o caixa recebe o estorno');
}
{
  await emTransacao(x => desfazerConciliacao(x, 't1', 's1'));
  const c = await conta('contas_pagar', 'p1');
  eq([c.status, c.data.valor_pago, 'extrato_conciliado_id' in c.data], ['PAGO', 497, false], 'conta que já era paga continua paga, só sem vínculo');
}
{
  // Alguém deu mais uma baixa na conta depois da conciliação.
  await novaLinha('e5', 400, '2026-10-05');
  await cr('r5', 1000, '2026-10-10');
  await emTransacao(x => conciliarComContas(x, 't1', 'e5', [{ tipo: 'CONTA_RECEBER', id: 'r5' }]));
  await pg.query(`UPDATE contas_receber SET data = data || '{"valor_recebido":700}' WHERE id='r5'`);
  const antes = await saldo('b1');
  const r = await recusa(() => emTransacao(x => desfazerConciliacao(x, 't1', 'e5')));
  eq(r?.status, 409, 'conta que mudou depois: desfazer recusa');
  eq([(await linha('e5')).status_conciliacao, (await conta('contas_receber', 'r5')).data.valor_recebido, await saldo('b1')], ['CONCILIADO', 700, antes], 'e nada mudou');
}
{
  // Conciliação feita pela tela antiga: só lancamento_vinculado_id.
  await cr('r6', 250, '2026-10-01', 'RECEBIDO', { valor_recebido: 250, data_recebimento: '2026-10-02', conta_bancaria_id: 'b1' });
  await novaLinha('e6', 250, '2026-10-02', 'Pix', 't1', 'b1', { status_conciliacao: 'CONCILIADO', lancamento_vinculado_id: 'r6', lancamento_vinculado_tipo: 'CONTA_RECEBER' });
  await pg.query(`UPDATE extrato_bancario SET status_conciliacao='CONCILIADO' WHERE id='e6'`);
  const antes = await saldo('b1');
  await emTransacao(x => desfazerConciliacao(x, 't1', 'e6'));
  const c = await conta('contas_receber', 'r6');
  eq([c.status, c.data.valor_recebido], ['PENDENTE', null], 'conciliação antiga: a conta volta a aberta quando ainda é o que a tela antiga gravou');
  eq(await saldo('b1'), Math.round((antes - 250) * 100) / 100, 'com o estorno no caixa');
}

console.log('--- agências separadas ---');
{
  await novaLinha('x1', 100, '2026-10-05', 'Pix', 't2', 'b2');
  await cr('rx', 100, '2026-10-05', 'PENDENTE', {}, 't2');
  eq((await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'x1', [{ tipo: 'CONTA_RECEBER', id: 'rx' }]))))?.status, 404, 'a agência A não enxerga a linha da B');
  await novaLinha('e7', 100, '2026-10-05');
  eq((await recusa(() => emTransacao(x => conciliarComContas(x, 't1', 'e7', [{ tipo: 'CONTA_RECEBER', id: 'rx' }]))))?.status, 404, 'nem usa a conta da B');
  eq([(await conta('contas_receber', 'rx')).status, await saldo('b2')], ['PENDENTE', 0], 'e nada da B mudou');
}

console.log('--- importação com andamento ---');
{
  const linhas = Array.from({ length: 250 }, (_, i) => ({ data: '2026-10-01', descricao: `Linha ${i}`, valor: i % 2 ? -10 : 10, fitid: `F${i}` }));
  const avisos = [];
  const r = await emTransacao(x => importarExtrato(x, 't1', 'b9', 'extrato.ofx', linhas, a => avisos.push(a)));
  eq([r.inseridas, r.duplicadas, r.total], [250, 0, 250], 'grava as 250 linhas');
  eq(avisos.length <= 100 && avisos.length >= 50, true, 'avisa o andamento em no máximo uns cem passos');
  eq(avisos.every((a, i) => i === 0 || a.feitas > avisos[i - 1].feitas), true, 'o andamento só cresce');
  eq(avisos.at(-1), { feitas: 250, total: 250, inseridas: 250, duplicadas: 0 }, 'e o último aviso é o total');
  const r2 = await emTransacao(x => importarExtrato(x, 't1', 'b9', 'extrato.ofx', linhas));
  eq([r2.inseridas, r2.duplicadas], [0, 250], 'reimportar o mesmo arquivo não duplica');
  const r3 = await emTransacao(x => importarExtrato(x, 't2', 'b9', 'extrato.ofx', linhas.slice(0, 3)));
  eq(r3.inseridas, 3, 'outra agência com a mesma conta importa as dela');
}

console.log(`\n${total - falhas}/${total} testes SQL da conciliação passaram`);
if (falhas > 0) process.exit(1);
