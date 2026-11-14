/**
 * Fluxo de Caixa: Previsto × Realizado × Desvio, por conta e saldo mínimo
 * (src/lib/fluxo-comparativo.ts, 05/11/2026).
 *
 * O que não pode quebrar:
 *   1) PORTEIRO: com "Todas as contas" o caderno dá exatamente os números de
 *      antes (montarCaderno sobre lancamentosDoCaixa).
 *   2) Previsto pelo vencimento, realizado pela baixa (entrada sem a taxa),
 *      desvio = realizado − previsto, e as linhas somam os totais em dia,
 *      semana e mês.
 *   3) Uma conta: baixa pela conta (sem conta = Caixa Geral); em aberto sem
 *      conta fica de fora e é contado.
 *   4) Atrasado em aberto é esperado hoje.
 *   5) Saldo mínimo e primeiro negativo só olham de hoje em diante.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-fluxo-comparativo.ts
 */
import { lancamentosDoCaixa, montarCaderno, periodoQueContem, type Agrupamento } from '../src/lib/caderno-caixa.ts';
import {
  alertaDeSaldo, comparativoDoPeriodo, contaDoTitulo, lancamentosDaConta, titulosDaConta,
} from '../src/lib/fluxo-comparativo.ts';
import { round2, somaPor } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-10-07';
const OUT = periodoQueContem('mes', HOJE);

const cr = (id: string, extra: Record<string, unknown>) => ({
  id, cliente_nome: `Cliente ${id}`, descricao: `Venda ${id}`, valor_final: 0, valor_recebido: 0, taxa: 0,
  status: 'PENDENTE', data_vencimento: '', data_recebimento: null, conta_bancaria_id: null, ...extra,
}) as never;
const cp = (id: string, extra: Record<string, unknown>) => ({
  id, fornecedor_nome: `Fornecedor ${id}`, descricao: `Compra ${id}`, valor_final: 0, valor_pago: 0,
  status: 'PENDENTE', data_vencimento: '', data_pagamento: null, conta_bancaria_id: null, ...extra,
}) as never;

// Duas contas: Inter (b1) e a Caixa Geral (cx).
const contas = [
  { id: 'b1', nome: 'Inter', saldo_inicial: 1000 },
  { id: 'cx', nome: 'Caixa Geral', saldo_inicial: 200 },
] as never[];

const receber = [
  // Venceu 02/10, recebido 03/10 na b1 com taxa de 30: previsto 1000, realizado 970.
  cr('r1', { valor_final: 1000, valor_recebido: 1000, taxa: 30, status: 'RECEBIDO', data_vencimento: '2026-10-02', data_recebimento: '2026-10-03', conta_bancaria_id: 'b1' }),
  // Parcial na b1: 300 de 500 em 05/10; vence 05/10. O resto (200) está atrasado → hoje.
  cr('r2', { valor_final: 500, valor_recebido: 300, status: 'PARCIAL', data_vencimento: '2026-10-05', data_recebimento: '2026-10-05', conta_bancaria_id: 'b1' }),
  // Recebido sem conta (cai na Caixa Geral) em 06/10, vencia 10/10 (adiantado).
  cr('r3', { valor_final: 400, valor_recebido: 400, status: 'RECEBIDO', data_vencimento: '2026-10-10', data_recebimento: '2026-10-06' }),
  // Em aberto sem conta: vence 20/10.
  cr('r4', { valor_final: 250, status: 'PENDENTE', data_vencimento: '2026-10-20' }),
  // Atrasado sem conta (vencia 01/10).
  cr('r5', { valor_final: 80, status: 'ATRASADO', data_vencimento: '2026-10-01' }),
  // Cancelado: não existe.
  cr('r6', { valor_final: 999, valor_recebido: 999, status: 'CANCELADO', data_vencimento: '2026-10-04', data_recebimento: '2026-10-04', conta_bancaria_id: 'b1' }),
];
const pagar = [
  // Pago na b1 em 04/10, vencia 04/10.
  cp('p1', { valor_final: 600, valor_pago: 600, status: 'PAGO', data_vencimento: '2026-10-04', data_pagamento: '2026-10-04', conta_bancaria_id: 'b1' }),
  // Em aberto na b1, vence 15/10.
  cp('p2', { valor_final: 1700, status: 'PENDENTE', data_vencimento: '2026-10-15', conta_bancaria_id: 'b1' }),
  // Vencido sem conta (vencia 06/10): esperado hoje.
  cp('p3', { valor_final: 50, status: 'VENCIDO', data_vencimento: '2026-10-06' }),
];

// ── 1. PORTEIRO ─────────────────────────────────────────────────────────────
console.log('--- porteiro: "Todas as contas" é o caderno de sempre ---');
const filtroTodas = { contaId: null, caixaGeralId: 'cx' };
for (const ag of ['dia', 'semana'] as Agrupamento[]) {
  const antes = montarCaderno({ lancamentos: lancamentosDoCaixa({ receber, pagar, hoje: HOJE }), contas, periodo: OUT, agrupamento: ag, hoje: HOJE });
  const { lancamentos, semConta } = lancamentosDaConta({ receber, pagar, filtro: filtroTodas, hoje: HOJE });
  const depois = montarCaderno({ lancamentos, contas, periodo: OUT, agrupamento: ag, hoje: HOJE });
  eq(JSON.stringify(depois), JSON.stringify(antes), `caderno idêntico por ${ag}`);
  eq(semConta, { quantidade: 0, valor: 0 }, `nada fica de fora em todas as contas (${ag})`);
}
{
  // Números fixos do caderno de outubro (congelados em 05/11/2026).
  const c = montarCaderno({ lancamentos: lancamentosDoCaixa({ receber, pagar, hoje: HOJE }), contas, periodo: OUT, agrupamento: 'dia', hoje: HOJE });
  eq([c.saldoInicial, c.entradas, c.saidas, c.saldoFinal], [1200, 2200, 2350, 1050], 'outubro: 1.200 + 2.200 − 2.350 = 1.050');
  eq([c.jaEntrou, c.jaSaiu], [1670, 600], 'outubro: já entrou 1.670 (sem a taxa), já saiu 600');
  eq(c.curva.find(p => p.data === HOJE)?.saldo, 2500, 'saldo de hoje: 1.200 + 1.670 − 600 + 230 dos atrasados projetados');
  eq(c.primeiroDiaNegativo, null, 'caderno de outubro não fica negativo');
}

// ── 2. Previsto × Realizado ─────────────────────────────────────────────────
console.log('--- previsto pelo vencimento, realizado pela baixa ---');
const todas = comparativoDoPeriodo({ receber, pagar, periodo: OUT, visao: 'dia', filtro: filtroTodas, hoje: HOJE });
eq(todas.totais.entradas, { previsto: 2230, realizado: 1670, desvio: -560 }, 'entradas: previsto 2.230, realizado 1.670');
eq(todas.totais.saidas, { previsto: 2350, realizado: 600, desvio: -1750 }, 'saídas: previsto 2.350, realizado 600');
eq(todas.totais.saldo, { previsto: -120, realizado: 1070, desvio: 1190 }, 'saldo = entradas − saídas em cada coluna');
const dia = (d: string) => todas.linhas.find(l => l.inicio === d);
eq(dia('2026-10-02')?.entradas, { previsto: 1000, realizado: 0, desvio: -1000 }, '02/10: venceu e não entrou no dia');
eq(dia('2026-10-03')?.entradas, { previsto: 0, realizado: 970, desvio: 970 }, '03/10: entrou 970 (sem a taxa de 30)');
eq(dia('2026-10-06')?.entradas.realizado, 400, '06/10: recebimento adiantado aparece no dia da baixa');
eq(dia('2026-10-10')?.entradas, { previsto: 400, realizado: 0, desvio: -400 }, '10/10: o adiantado era previsto aqui');
eq(dia('2026-10-04')?.saidas, { previsto: 600, realizado: 600, desvio: 0 }, '04/10: pago no dia, desvio zero');
eq(Boolean(dia(HOJE)), true, 'dia a dia inclui hoje mesmo sem fato');
eq(dia('2026-10-15')?.futura, true, 'linha depois de hoje é futura');

for (const visao of ['dia', 'semana', 'mes'] as Agrupamento[]) {
  const c = comparativoDoPeriodo({ receber, pagar, periodo: OUT, visao, filtro: filtroTodas, hoje: HOJE });
  const soma = (k: 'entradas' | 'saidas' | 'saldo', col: 'previsto' | 'realizado' | 'desvio') => round2(somaPor(c.linhas, l => l[k][col]));
  eq(
    [soma('entradas', 'previsto'), soma('entradas', 'realizado'), soma('saidas', 'previsto'), soma('saidas', 'realizado'), soma('saldo', 'desvio')],
    [c.totais.entradas.previsto, c.totais.entradas.realizado, c.totais.saidas.previsto, c.totais.saidas.realizado, c.totais.saldo.desvio],
    `linhas somam os totais por ${visao}`,
  );
}
const porMes = comparativoDoPeriodo({ receber, pagar, periodo: periodoQueContem('trimestre', HOJE), visao: 'mes', filtro: filtroTodas, hoje: HOJE });
eq(porMes.linhas.map(l => l.rotulo), ['Outubro', 'Novembro', 'Dezembro'], 'trimestre por mês: três linhas');
const porSemana = comparativoDoPeriodo({ receber, pagar, periodo: OUT, visao: 'semana', filtro: filtroTodas, hoje: HOJE });
eq(porSemana.linhas[0].rotulo, '1 a 3 out', 'primeira semana cortada na ponta do mês');
eq(porSemana.linhas[0].entradas, { previsto: 1080, realizado: 970, desvio: -110 }, 'semana de 1 a 3: taxa de 30 + 80 que venceu e não entrou');

// ── 3. Por conta ────────────────────────────────────────────────────────────
console.log('--- uma conta ---');
eq(contaDoTitulo(receber[2] as never, 'receber', 'cx'), 'cx', 'baixa sem conta cai na Caixa Geral');
eq(contaDoTitulo(receber[3] as never, 'receber', 'cx'), null, 'em aberto sem conta não tem conta');
eq(contaDoTitulo(receber[0] as never, 'receber', 'cx'), 'b1', 'conta escolhida vale');
const b1 = comparativoDoPeriodo({ receber, pagar, periodo: OUT, visao: 'mes', filtro: { contaId: 'b1', caixaGeralId: 'cx' }, hoje: HOJE });
eq(b1.totais.entradas, { previsto: 1500, realizado: 1270, desvio: -230 }, 'b1: r1 + r2 (970 + 300)');
eq(b1.totais.saidas, { previsto: 2300, realizado: 600, desvio: -1700 }, 'b1: p1 + p2');
eq(b1.semConta, { quantidade: 3, valor: 380 }, 'b1: 3 previsões sem conta ficam fora (250 + 80 + 50)');
const cx = comparativoDoPeriodo({ receber, pagar, periodo: OUT, visao: 'mes', filtro: { contaId: 'cx', caixaGeralId: 'cx' }, hoje: HOJE });
eq(cx.totais.entradas, { previsto: 400, realizado: 400, desvio: 0 }, 'Caixa Geral: o recebido sem conta');
const t = titulosDaConta({ receber, pagar, folha: [{ descricao: 'Folha', valor: 3000, data_pagamento: '2026-10-05', competencia: '2026-09' }], filtro: { contaId: 'b1', caixaGeralId: 'cx' } });
eq([t.folha.length, t.semConta.quantidade, t.semConta.valor], [0, 4, 3380], 'folha não tem conta: sai e é contada');

{
  // Caderno da b1: saldo inicial só dela, mais só o que é dela.
  const { lancamentos } = lancamentosDaConta({ receber, pagar, filtro: { contaId: 'b1', caixaGeralId: 'cx' }, hoje: HOJE });
  const c = montarCaderno({ lancamentos, contas: [contas[0]], periodo: OUT, agrupamento: 'dia', hoje: HOJE });
  eq([c.saldoInicial, c.entradas, c.saidas, c.saldoFinal], [1000, 1470, 2300, 170], 'caderno da b1: 1.000 + 1.470 − 2.300 = 170');
  eq(c.curva.find(p => p.data === HOJE)?.saldo, 1870, 'b1 hoje: 1.000 + 970 + 300 − 600 + 200 atrasado');
}

// ── 4. Atrasados projetados para hoje ───────────────────────────────────────
console.log('--- atrasados ---');
eq(todas.atrasados, { entradas: 280, saidas: 50, quantidade: 3 }, 'todas: 200 (r2) + 80 (r5) a receber, 50 (p3) a pagar');
eq(b1.atrasados, { entradas: 200, saidas: 0, quantidade: 1 }, 'b1: só o resto do parcial');
{
  const { lancamentos } = lancamentosDaConta({ receber, pagar, filtro: filtroTodas, hoje: HOJE });
  const atrasados = lancamentos.filter(l => l.situacao === 'atrasado');
  eq(atrasados.every(l => l.data === HOJE), true, 'todo atrasado está em hoje no caderno');
}

// ── 5. Saldo mínimo ─────────────────────────────────────────────────────────
console.log('--- saldo mínimo ---');
{
  const { lancamentos } = lancamentosDaConta({ receber, pagar, filtro: { contaId: 'b1', caixaGeralId: 'cx' }, hoje: HOJE });
  const c = montarCaderno({ lancamentos, contas: [contas[0]], periodo: OUT, agrupamento: 'dia', hoje: HOJE });
  const a = alertaDeSaldo(c.curva, 500, HOJE);
  eq(a.primeiroAbaixoDoMinimo, '2026-10-15', 'b1 fica abaixo de 500 em 15/10');
  eq(a.primeiroNegativo, null, 'b1 não fica negativa');
  eq(a.menor, { data: '2026-10-15', saldo: 170 }, 'menor saldo previsto: 170 em 15/10');
  eq(alertaDeSaldo(c.curva, 0, HOJE).primeiroAbaixoDoMinimo, null, 'mínimo zero não alerta abaixo do mínimo');
  eq(alertaDeSaldo(c.curva, 1000000, HOJE).primeiroAbaixoDoMinimo, HOJE, 'mínimo alto: já hoje');
}
{
  // Uma conta a pagar grande no dia 20 deixa a b1 negativa.
  const mais = [...pagar, cp('p4', { valor_final: 500, status: 'PENDENTE', data_vencimento: '2026-10-20', conta_bancaria_id: 'b1' })];
  const { lancamentos } = lancamentosDaConta({ receber, pagar: mais, filtro: { contaId: 'b1', caixaGeralId: 'cx' }, hoje: HOJE });
  const c = montarCaderno({ lancamentos, contas: [contas[0]], periodo: OUT, agrupamento: 'dia', hoje: HOJE });
  const a = alertaDeSaldo(c.curva, 100, HOJE);
  eq([a.primeiroAbaixoDoMinimo, a.primeiroNegativo], ['2026-10-20', '2026-10-20'], 'negativo previsto em 20/10');
  // Negativo no passado não é alerta de previsão.
  const passado = [{ data: '2026-10-01', saldo: -10 }, { data: HOJE, saldo: 50 }, { data: '2026-10-08', saldo: 60 }];
  eq(alertaDeSaldo(passado, 0, HOJE).primeiroNegativo, null, 'negativo antes de hoje não alerta');
}

console.log(`\n${total - falhas}/${total} testes do Previsto × Realizado passaram`);
if (falhas > 0) process.exit(1);
