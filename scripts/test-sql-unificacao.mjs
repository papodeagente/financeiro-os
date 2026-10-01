/**
 * Unificação do recebimento da plataforma com a venda do CRM, contra um
 * Postgres real (PGlite).
 *
 * O defeito que isto guarda: até 01/10/2026 vincular um recebimento da
 * plataforma a uma venda deixava as contas da venda de pé ao lado das da
 * plataforma, e a mesma viagem aparecia duas vezes no contas a receber.
 *
 * O que se prova aqui: a conta coberta é cancelada, a parcialmente coberta
 * reduz ao que falta, a já recebida não se toca, o aviso repetido do webhook
 * não consome duas vezes, parcela nova consome mais, outra agência não é
 * tocada, e "venda direta" devolve tudo ao que era.
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { unificarRecebimento, desfazerUnificacao } = await import('../src/lib/plataformas/unificar-db.ts');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const db = new PGlite();
await db.exec(`
  CREATE TABLE contas_receber (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '',
    cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`);
const exec = { query: async (text, values) => { const r = await db.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };

async function conta(id, tenant, venda, status, valor, venc, extra = {}) {
  const d = { status, valor_final: valor, valor_original: valor, data_vencimento: venc, origem_venda_id: venda, ...extra };
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [id, tenant, venda, status, JSON.stringify(d)]);
}
async function plataforma(id, tenant, valor, status = 'RECEBIDO') {
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ($1,$2,'',$3,$4::jsonb)`,
    [id, tenant, status, JSON.stringify({ status, valor_final: valor, valor_original: valor, data_vencimento: '2026-10-01', plataforma_origem: 'hotmart', plataforma_transacao: 'tx-1', origem: 'VENDA_DIRETA' })]);
}
async function ler(id) {
  const r = await db.query(`SELECT status, data FROM contas_receber WHERE id = $1`, [id]);
  const d = r.rows[0].data;
  return { status: r.rows[0].status, dstatus: d.status, valor: Number(d.valor_final), original: Number(d.valor_original), carimbo: d.substituida_por_plataforma ?? null };
}

// A venda v1 no CRM: 3 parcelas de 1.000, a primeira já recebida.
await conta('cr-0', 't1', 'v1', 'RECEBIDO', 1000, '2026-09-10');
await conta('cr-1', 't1', 'v1', 'PENDENTE', 1000, '2026-10-10');
await conta('cr-2', 't1', 'v1', 'PENDENTE', 1000, '2026-11-10');
// Outra agência com uma venda de mesmo id e contas iguais: não pode ser tocada.
await conta('cr-b1', 't2', 'v1', 'PENDENTE', 1000, '2026-10-10');
// A plataforma recebeu 1.500 pela mesma viagem.
await plataforma('p-1', 't1', 1500);

const alvo = { vendaId: 'v1', plataforma: 'hotmart', idTransacao: 'tx-1' };

console.log('--- primeira unificação: 1.500 contra 2 pendentes de 1.000 ---');
{
  const r = await unificarRecebimento(exec, 't1', alvo);
  eq(r.total_plataforma, 1500, 'o total da plataforma é a soma das contas dela');
  eq(r.ja_consumido, 0, 'nada consumido antes');
  eq(r.acoes.map(a => `${a.id}:${a.acao}`), ['cr-1:CANCELAR', 'cr-2:REDUZIR'], 'a mais antiga é substituída, a seguinte reduzida');
  eq([r.consumido, r.restante, r.excedente], [1500, 500, 0], 'consumiu 1.500, ficam 500 a receber, sem excedente');
  const c1 = await ler('cr-1');
  eq([c1.status, c1.dstatus], ['CANCELADO', 'CANCELADO'], 'cr-1 cancelada na coluna E no JSON');
  // jsonb reordena as chaves; compara campo a campo.
  eq([c1.carimbo.plataforma, c1.carimbo.id_transacao, c1.carimbo.acao, c1.carimbo.valor_original, c1.carimbo.status_original],
     ['hotmart', 'tx-1', 'CANCELAR', 1000, 'PENDENTE'], 'cr-1 carimbada com o que era');
  const c2 = await ler('cr-2');
  eq([c2.status, c2.valor, c2.original], ['PENDENTE', 500, 500], 'cr-2 continua pendente, agora de 500');
  eq(c2.carimbo.valor_original, 1000, 'cr-2 guarda o valor original de 1.000');
  const c0 = await ler('cr-0');
  eq([c0.status, c0.valor, c0.carimbo], ['RECEBIDO', 1000, null], 'a parcela já recebida não foi tocada');
  const b1 = await ler('cr-b1');
  eq([b1.status, b1.valor, b1.carimbo], ['PENDENTE', 1000, null], 'a outra agência não foi tocada');
  const p1 = await ler('p-1');
  eq([p1.status, p1.valor], ['RECEBIDO', 1500], 'a conta da plataforma fica como está');
}

console.log('--- o webhook avisa de novo o mesmo status ---');
{
  const r = await unificarRecebimento(exec, 't1', alvo);
  eq(r.ja_consumido, 1500, 'reconhece o que já consumiu');
  eq(r.acoes, [], 'e não consome nada de novo');
  const c2 = await ler('cr-2');
  eq(c2.valor, 500, 'cr-2 segue em 500, não em 0');
}

console.log('--- chega a segunda parcela da plataforma: 500 ---');
{
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('p-2','t1','','PENDENTE',$1::jsonb)`,
    [JSON.stringify({ status: 'PENDENTE', valor_final: 500, valor_original: 500, data_vencimento: '2026-11-01', plataforma_origem: 'hotmart', plataforma_transacao: 'tx-1' })]);
  const r = await unificarRecebimento(exec, 't1', alvo);
  eq([r.total_plataforma, r.ja_consumido], [2000, 1500], 'total 2.000, 1.500 já consumidos');
  eq(r.acoes.map(a => `${a.id}:${a.acao}`), ['cr-2:CANCELAR'], 'os 500 novos quitam o que faltava de cr-2');
  eq([r.restante, r.excedente], [0, 0], 'nada mais a receber da venda, nada sobrando');
  const c2 = await ler('cr-2');
  eq(c2.status, 'CANCELADO', 'cr-2 agora substituída');
  eq(c2.carimbo.valor_original, 1000, 'o carimbo ainda guarda os 1.000 originais, não os 500 reduzidos');
}

console.log('--- plataforma recebeu mais do que a venda previa ---');
{
  await conta('cr-x1', 't1', 'v2', 'ATRASADO', 800, '2026-09-01');
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('p-x','t1','','RECEBIDO',$1::jsonb)`,
    [JSON.stringify({ status: 'RECEBIDO', valor_final: 1000, valor_original: 1000, data_vencimento: '2026-10-01', plataforma_origem: 'asaas', plataforma_transacao: 'tx-9' })]);
  const r = await unificarRecebimento(exec, 't1', { vendaId: 'v2', plataforma: 'asaas', idTransacao: 'tx-9' });
  eq(r.acoes.map(a => `${a.id}:${a.acao}`), ['cr-x1:CANCELAR'], 'a conta atrasada também é substituída');
  eq(r.excedente, 200, 'e os 200 a mais ficam declarados como excedente');
  eq((await ler('cr-x1')).carimbo.status_original, 'ATRASADO', 'o carimbo lembra que ela estava atrasada');
}

console.log('--- venda direta: desfaz ---');
{
  const r = await desfazerUnificacao(exec, 't1', 'hotmart', 'tx-1');
  eq(r.restauradas, 2, 'as duas contas da venda voltaram');
  const c1 = await ler('cr-1');
  eq([c1.status, c1.dstatus, c1.valor, c1.original, c1.carimbo], ['PENDENTE', 'PENDENTE', 1000, 1000, null], 'cr-1 voltou a pendente de 1.000, sem carimbo');
  const c2 = await ler('cr-2');
  eq([c2.status, c2.valor, c2.carimbo], ['PENDENTE', 1000, null], 'cr-2 voltou aos 1.000 originais, não aos 500');
  eq((await ler('cr-x1')).status, 'CANCELADO', 'a unificação de OUTRA transação não foi desfeita');
  eq((await ler('cr-b1')).status, 'PENDENTE', 'a outra agência segue intacta');
  const r2 = await desfazerUnificacao(exec, 't1', 'hotmart', 'tx-1');
  eq(r2.restauradas, 0, 'desfazer de novo não faz nada');
}

console.log('--- conta reduzida que depois recebeu baixa não volta ---');
{
  await conta('cr-y1', 't1', 'v3', 'PENDENTE', 1000, '2026-10-10');
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('p-y','t1','','RECEBIDO',$1::jsonb)`,
    [JSON.stringify({ status: 'RECEBIDO', valor_final: 400, valor_original: 400, data_vencimento: '2026-10-01', plataforma_origem: 'asaas', plataforma_transacao: 'tx-y' })]);
  await unificarRecebimento(exec, 't1', { vendaId: 'v3', plataforma: 'asaas', idTransacao: 'tx-y' });
  eq((await ler('cr-y1')).valor, 600, 'reduzida a 600');
  // O operador recebeu os 600 em caixa.
  await db.query(`UPDATE contas_receber SET status='RECEBIDO', data = data || '{"status":"RECEBIDO"}' WHERE id='cr-y1'`);
  const r = await desfazerUnificacao(exec, 't1', 'asaas', 'tx-y');
  eq(r.restauradas, 0, 'não restaura conta que já recebeu baixa');
  eq((await ler('cr-y1')).valor, 600, 'o valor recebido fica como foi recebido');
}

console.log('--- isolamento: desfazer na agência errada ---');
{
  await db.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('p-b','t2','','RECEBIDO',$1::jsonb)`,
    [JSON.stringify({ status: 'RECEBIDO', valor_final: 1000, valor_original: 1000, data_vencimento: '2026-10-01', plataforma_origem: 'hotmart', plataforma_transacao: 'tx-1' })]);
  const r = await unificarRecebimento(exec, 't2', alvo);
  eq(r.acoes.map(a => a.id), ['cr-b1'], 'a agência B unifica a conta DELA');
  eq((await ler('cr-1')).status, 'PENDENTE', 'e a conta da A não muda');
  const d = await desfazerUnificacao(exec, 't1', 'hotmart', 'tx-1');
  eq(d.restauradas, 0, 'desfazer na A não devolve a conta da B');
  eq((await ler('cr-b1')).status, 'CANCELADO', 'a conta da B segue unificada');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
