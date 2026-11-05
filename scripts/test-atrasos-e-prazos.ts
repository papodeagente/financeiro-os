/**
 * Atrasos, prazos e projeção (src/lib/atrasos-e-prazos.ts), 05/11/2026.
 *
 * Prova: hoje e em atraso; saldo por conta com Caixa Geral; faixas nas bordas;
 * PMR/PMP (parcial e sem base); caixa projetado 30/60/90. PORTEIRO: o
 * projetado em 30 dias é o "Caixa previsto" da visão geral e o saldo total é o
 * "Em caixa hoje" (calcularSaldoBancario).
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-atrasos-e-prazos.ts
 */
import { faixaDoResumo, prazoMedio, atrasosEPrazos, saldosPorConta } from '../src/lib/atrasos-e-prazos.ts';
import { posicaoDeHoje } from '../src/lib/visao-geral.ts';
import { calcularSaldoBancario } from '../src/lib/saldo-bancario.ts';
import { addDias, round2 } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-11-05';
const cr = (id: string, x: Record<string, unknown>) => ({ id, cliente_nome: `C ${id}`, descricao: '', valor_final: 0, valor_recebido: 0, status: 'PENDENTE', data_vencimento: '', taxa: 0, conta_bancaria_id: null, ...x }) as never;
const cp = (id: string, x: Record<string, unknown>) => ({ id, fornecedor_nome: `F ${id}`, descricao: '', valor_final: 0, valor_pago: 0, status: 'PENDENTE', data_vencimento: '', conta_bancaria_id: null, ...x }) as never;

console.log('--- Faixas nas bordas ---');
for (const [dias, faixa] of [[0, 'A_VENCER'], [-3, 'A_VENCER'], [1, 'ATE_30'], [30, 'ATE_30'], [31, 'ATE_60'], [60, 'ATE_60'], [61, 'ATE_90'], [90, 'ATE_90'], [91, 'ACIMA_90']] as const) {
  eq(faixaDoResumo(addDias(HOJE, -dias), HOJE), faixa, `${dias} dias de atraso → ${faixa}`);
}
eq(faixaDoResumo('', HOJE), 'A_VENCER', 'sem vencimento → a vencer');

console.log('--- Saldo por conta e Caixa Geral ---');
const contas = [
  { id: 'b1', nome: 'Itaú', saldo_inicial: 1000 },
  { id: 'cg', nome: 'Caixa Geral', saldo_inicial: 0 },
] as never[];
const receber = [
  cr('r1', { status: 'RECEBIDO', valor_final: 500, valor_recebido: 500, taxa: 20, conta_bancaria_id: 'b1', data_emissao: '2026-10-01', data_recebimento: '2026-10-11' }),
  cr('r2', { status: 'PARCIAL', valor_final: 400, valor_recebido: 100, data_vencimento: HOJE, data_emissao: '2026-10-21', data_recebimento: '2026-10-31' }), // sem conta → Caixa Geral
  cr('r3', { status: 'ATRASADO', valor_final: 300, data_vencimento: addDias(HOJE, -45) }),
  cr('r4', { status: 'PENDENTE', valor_final: 200, data_vencimento: addDias(HOJE, 40) }),
  cr('r5', { status: 'PENDENTE', valor_final: 150, data_vencimento: addDias(HOJE, 80) }),
  cr('r6', { status: 'CANCELADO', valor_final: 999, data_vencimento: addDias(HOJE, -10) }),
  cr('r7', { status: 'PENDENTE', valor_final: 70, data_vencimento: addDias(HOJE, -100) }),
];
const pagar = [
  cp('p1', { status: 'PAGO', valor_final: 250, valor_pago: 250, conta_bancaria_id: 'b1', data_emissao: '2026-10-01', data_pagamento: '2026-10-31' }),
  cp('p2', { status: 'VENCIDO', valor_final: 120, data_vencimento: addDias(HOJE, -5) }),
  cp('p3', { status: 'PENDENTE', valor_final: 80, data_vencimento: HOJE }),
  cp('p4', { status: 'PENDENTE', valor_final: 1000, data_vencimento: addDias(HOJE, 65) }),
];
const transferencias = [
  { conta_origem_id: 'b1', conta_destino_id: 'cg', valor: 50, status: 'EFETIVADA' },
  { conta_origem_id: 'b1', conta_destino_id: 'cg', valor: 999, status: 'PENDENTE' },
  { conta_origem_id: 'b1', conta_destino_id: 'apagada', valor: 77, status: 'EFETIVADA' },
];
const r = atrasosEPrazos({ contasBancarias: contas, receber, pagar, transferencias, hoje: HOJE });
eq(r.contas.map(c => [c.id, c.saldo]), [['b1', 1180], ['cg', 150]], 'b1 = 1000 + 480 − 250 − 50; Caixa Geral = 100 + 50');
eq(r.semConta, 0, 'tudo tem conta');
eq(r.saldoTotal, round2(1180 + 150), 'total = soma das contas');

const semCaixaGeral = saldosPorConta({ contasBancarias: [contas[0]], receber, pagar });
eq([semCaixaGeral.contas[0].saldo, semCaixaGeral.semConta], [1230, 100], 'sem Caixa Geral: baixa sem conta fica separada');

console.log('--- Hoje e em atraso ---');
eq(r.receber.hoje, { valor: 300, quantidade: 1 }, 'receber hoje: o que falta da parcial');
eq(r.receber.emAtraso, { valor: 370, quantidade: 2 }, 'receber em atraso (cancelada fora)');
eq(r.pagar.hoje, { valor: 80, quantidade: 1 }, 'pagar hoje');
eq(r.pagar.emAtraso, { valor: 120, quantidade: 1 }, 'pagar em atraso');
eq(r.receber.faixas.map(f => [f.id, f.valor, f.quantidade]),
  [['A_VENCER', 650, 3], ['ATE_30', 0, 0], ['ATE_60', 300, 1], ['ATE_90', 0, 0], ['ACIMA_90', 70, 1]], 'faixas do receber');
eq(r.pagar.faixas.map(f => [f.id, f.valor]), [['A_VENCER', 1080], ['ATE_30', 120], ['ATE_60', 0], ['ATE_90', 0], ['ACIMA_90', 0]], 'faixas do pagar');
eq(round2(r.receber.faixas.reduce((s, f) => s + f.valor, 0)), r.receber.emAberto.valor, 'faixas somam o em aberto');

console.log('--- PMR / PMP ---');
// r1: 10 dias × 500; r2: 10 dias × 100 (parcial pelo acumulado) → 10.
eq(r.pmr, { dias: 10, baixas: 2, valor: 600 }, 'PMR ponderado, parcial entra pelo acumulado');
eq(r.pmp, { dias: 30, baixas: 1, valor: 250 }, 'PMP');
eq(prazoMedio([], () => null, () => 0, HOJE), { dias: null, baixas: 0, valor: 0 }, 'sem base: null, não zero');
const antiga = [cr('x', { status: 'RECEBIDO', valor_final: 10, valor_recebido: 10, data_emissao: '2026-01-01', data_recebimento: '2026-02-01' })];
eq(atrasosEPrazos({ contasBancarias: contas, receber: antiga, pagar: [], hoje: HOJE }).pmr.dias, null, 'baixa fora dos 90 dias não entra');
const ponderado = [
  cr('a', { status: 'RECEBIDO', valor_final: 300, valor_recebido: 300, data_vencimento: '2026-11-01', data_recebimento: '2026-11-01' }),
  cr('b', { status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, data_emissao: '2026-10-02', data_recebimento: '2026-11-01' }),
  cr('c', { status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, data_emissao: '2026-11-04', data_recebimento: '2026-11-01' }),
];
eq(atrasosEPrazos({ contasBancarias: contas, receber: ponderado, pagar: [], hoje: HOJE }).pmr.dias, 6, 'sem emissão usa vencimento; baixa antes da emissão = 0 dias; (0·300+30·100+0·100)/500');

console.log('--- Caixa projetado e porteiro ---');
const p = posicaoDeHoje({ contasBancarias: contas, receber, pagar, hoje: HOJE });
eq(r.projetado[0].valor, p.previsto.valor, 'PORTEIRO: projetado 30 dias = Caixa previsto da visão geral');
eq(r.projetado[0].data, p.previsto.data, 'PORTEIRO: mesma data');
eq(r.saldoTotal, calcularSaldoBancario(contas as never, receber as never, pagar as never), 'PORTEIRO: saldo total = Em caixa hoje');
eq(r.saldoTotal, p.emCaixa, 'PORTEIRO: saldo total = posição de hoje');
// 30: 1330 + (300+370) − (120+80) = 1800; 60: + 200 − 0 = 2000; 90: + 150 − 1000 = 1150
eq(r.projetado.map(x => [x.dias, x.valor]), [[30, 1800], [60, 2000], [90, 1150]], 'projetado 30/60/90');

console.log(`\n${total - falhas}/${total} testes de atrasos, prazos e projeção passaram`);
if (falhas) process.exit(1);
