/**
 * Visão geral do Financeiro (src/lib/visao-geral.ts).
 *
 * Os números desta tela precisam bater com as outras:
 *   1) "Em caixa hoje" é o mesmo saldo das contas bancárias (sem a taxa da plataforma);
 *   2) "Caixa previsto em D+30" = caixa + entradas − saídas da agenda, centavo a centavo;
 *   3) o que venceu e não se moveu vem no topo, e entra no previsto;
 *   4) o mês compara com os MESMOS dias do mês anterior.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-visao-geral.ts
 */
import {
  agendaDosProximosDias, diasEntre, grupoDoVencimento, hojePorExtenso, mesAteHoje, pendencias, posicaoDeHoje, rotuloDoGrupo,
} from '../src/lib/visao-geral.ts';
import { calcularSaldoBancario } from '../src/lib/saldo-bancario.ts';
import { round2 } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-10-08'; // quinta-feira
const cr = (id: string, x: Record<string, unknown>) => ({ id, cliente_nome: `Cliente ${id}`, descricao: '', valor_final: 0, valor_recebido: 0, status: 'PENDENTE', data_vencimento: '', taxa: 0, ...x }) as never;
const cp = (id: string, x: Record<string, unknown>) => ({ id, fornecedor_nome: `Fornecedor ${id}`, descricao: '', valor_final: 0, valor_pago: 0, status: 'PENDENTE', data_vencimento: '', ...x }) as never;

const contas = [{ id: 'b1', nome: 'Itaú', saldo_inicial: 100000 }, { id: 'b2', nome: 'Inter', saldo_inicial: 5000 }] as never[];
const receber = [
  cr('r1', { status: 'ATRASADO', valor_final: 1560, data_vencimento: '2026-09-28', parcela_numero: 2, total_parcelas: 3, descricao: 'Pacote Gramado', venda_id: 'v4' }),
  cr('r2', { status: 'PENDENTE', valor_final: 1560, data_vencimento: '2026-10-01', venda_id: 'v6' }),
  cr('r3', { status: 'PENDENTE', valor_final: 47, data_vencimento: '2026-10-08', plataforma_origem: 'hotmart', descricao: 'Workshop · hotmart' }),
  cr('r4', { status: 'PARCIAL', valor_final: 4000, valor_recebido: 750, data_vencimento: '2026-10-09', data_recebimento: '2026-10-02' }),
  cr('r5', { status: 'PENDENTE', valor_final: 12400, data_vencimento: '2026-10-15' }),
  cr('r6', { status: 'PENDENTE', valor_final: 9874.61, data_vencimento: '2026-11-07' }),
  cr('r7', { status: 'PENDENTE', valor_final: 999, data_vencimento: '2026-11-08' }), // fora da janela
  cr('r8', { status: 'RECEBIDO', valor_final: 3000, valor_recebido: 3000, taxa: 120, data_vencimento: '2026-10-03', data_recebimento: '2026-10-03' }),
  cr('r9', { status: 'CANCELADO', valor_final: 5000, data_vencimento: '2026-10-10' }),
  cr('r10', { status: 'recebido', valor_final: 50, valor_recebido: 50, data_vencimento: '2026-10-01', data_recebimento: '2026-10-01' }), // fora do enum
  cr('r11', { status: 'RECEBIDO', valor_final: 2000, valor_recebido: 2000, data_vencimento: '2026-09-05', data_recebimento: '2026-09-05' }),
  cr('r12', { status: 'RECEBIDO', valor_final: 900, valor_recebido: 900, data_vencimento: '2026-09-20', data_recebimento: '2026-09-20' }), // depois do dia 8: fora da comparação
];
const pagar = [
  cp('p1', { status: 'PENDENTE', valor_final: 2447.4, data_vencimento: '2026-11-05', fornecedor_nome: '', fornecedor_pendente: true, venda_id: 'v6', descricao: 'Custo da venda' }),
  cp('p2', { status: 'VENCIDO', valor_final: 300, data_vencimento: '2026-10-05' }),
  cp('p3', { status: 'PAGO', valor_final: 1861.65, valor_pago: 1861.65, data_vencimento: '2026-10-05', data_pagamento: '2026-10-05' }),
  cp('p4', { status: 'PAGO', valor_final: 400, valor_pago: 400, data_vencimento: '2026-09-02', data_pagamento: '2026-09-02' }),
];

console.log('--- posição de hoje ---');
const pos = posicaoDeHoje({ contasBancarias: contas, receber, pagar, hoje: HOJE });
eq(pos.emCaixa, calcularSaldoBancario(contas as never, receber as never, pagar as never), 'em caixa hoje = saldo das contas bancárias (o mesmo número das outras telas)');
eq(pos.emCaixa, round2(105000 + 750 + 2880 + 2000 + 900 - 1861.65 - 400), 'taxa da plataforma descontada; status fora do enum não conta');
eq(pos.aReceber.total, round2(1560 + 1560 + 47 + 3250 + 12400 + 9874.61 + 999), 'a receber: tudo em aberto, parcial pelo que falta');
eq(pos.aReceber.vencido, 3120, 'vencido: as duas parcelas que passaram');
eq(pos.aReceber.parcelas, 7, '7 parcelas em aberto (cancelada e recebidas fora)');
eq([pos.aPagar.total, pos.aPagar.vencido, pos.aPagar.contas, pos.aPagar.proximoVencimento], [2747.4, 300, 2, '2026-11-05'], 'a pagar: total, vencido, quantas e a próxima');
eq(pos.previsto.data, '2026-11-07', 'previsto para daqui a 30 dias');

console.log('--- agenda dos próximos 30 dias ---');
const ag = agendaDosProximosDias({ receber, pagar, hoje: HOJE });
eq(ag.linhas.map(l => l.id), ['r1', 'r2', 'p2', 'r3', 'r4', 'r5', 'p1', 'r6'], 'vencidos no topo, depois por data; fora da janela e cancelada não entram');
eq(ag.linhas.map(l => l.grupo), ['vencido', 'vencido', 'vencido', 'semana', 'semana', 'proxima', 'depois', 'depois'], 'grupos');
eq(round2(pos.emCaixa + ag.entradas - ag.saidas), pos.previsto.valor, 'caixa previsto = caixa + entradas − saídas da agenda');
eq(pos.previsto.variacao, round2(ag.entradas - ag.saidas), 'a variação em 30 dias é a diferença da agenda');
eq(ag.quantidade, { todas: 8, receber: 6, pagar: 2 }, 'contagem por filtro');
const r1 = ag.linhas[0];
eq([r1.diaDaSemana, r1.atraso, r1.acao, r1.origem, r1.detalhe], ['seg', 'vencida há 10 dias', 'Cobrar', 'Do CRM', 'Parcela 2 de 3 · Pacote Gramado'], 'linha vencida do CRM');
const r3 = ag.linhas.find(l => l.id === 'r3')!;
eq([r3.diaDaSemana, r3.origem, r3.detalhe, r3.acao], ['hoje', 'via Hotmart', 'Workshop', 'Receber'], 'linha da plataforma, de hoje');
eq(ag.linhas.find(l => l.id === 'r4')!.valor, 3250, 'parcial: só o que falta');
const p1 = ag.linhas.find(l => l.id === 'p1')!;
eq([p1.quem, p1.semFornecedor, p1.acao], ['Fornecedor não informado', true, 'Pagar'], 'custo sem fornecedor avisa antes de pagar');
eq([grupoDoVencimento('2026-10-11', HOJE), grupoDoVencimento('2026-10-12', HOJE), grupoDoVencimento('2026-10-18', HOJE), grupoDoVencimento('2026-10-19', HOJE)],
  ['semana', 'proxima', 'proxima', 'depois'], 'semana de segunda a domingo');
eq(rotuloDoGrupo('depois', ag.ate), 'Até 07/11', 'rótulo do último grupo');

console.log('--- precisa de você ---');
const brl = (v: number) => `R$ ${v.toFixed(2)}`;
const pend = pendencias({
  receber, pagar, hoje: HOJE, formatar: brl,
  extratoPendente: [{ conta_bancaria_id: 'b1', data: '2026-10-03' }, { conta_bancaria_id: 'b2', data: '2026-10-01' }, { conta_bancaria_id: 'b1', data: '2026-10-07' }],
  nomesDasContas: { b1: 'Itaú', b2: 'Inter' },
  plataformasParaConferir: 1,
});
eq(pend.map(p => p.chave), ['receber-vencido', 'pagar-vencido', 'extrato', 'sem-fornecedor', 'plataformas'], 'as cinco pendências, na ordem de urgência');
eq([pend[0].titulo, pend[0].detalhe], ['2 parcelas de clientes vencidas', 'R$ 3120.00 · a mais antiga há 10 dias'], 'parcelas vencidas');
eq([pend[2].titulo, pend[2].detalhe], ['3 movimentos do extrato sem conciliar', 'Itaú e Inter, desde 01/10'], 'extrato');
eq([pend[3].titulo, pend[3].detalhe], ['1 custo de venda sem fornecedor', 'R$ 2447.40 · vence em 05/11'], 'sem fornecedor');
eq(pendencias({ receber: [], pagar: [], hoje: HOJE, formatar: brl, extratoPendente: [], nomesDasContas: {}, plataformasParaConferir: 0 }), [], 'nada pendente: lista vazia');

console.log('--- o mês até hoje ---');
const mes = mesAteHoje(receber, pagar, HOJE);
eq([mes.entrou, mes.saiu, mes.resultado], [round2(2880 + 750), 1861.65, round2(3630 - 1861.65)], 'outubro pela data da baixa, entrada sem a taxa');
eq(mes.anterior, { de: '2026-09-01', ate: '2026-09-08', resultado: round2(2000 - 400) }, 'setembro, só de 1 a 8: o dia 20 fica fora');
eq([mes.nomeDoMes, mes.nomeDoMesAnterior], ['outubro', 'setembro'], 'nomes dos meses');
eq(mesAteHoje([], [], '2026-03-31').anterior, { de: '2026-02-01', ate: '2026-02-28', resultado: 0 }, '31 de março compara com fevereiro até o último dia');
eq(mesAteHoje([], [], '2026-01-15').anterior.de, '2025-12-01', 'janeiro compara com dezembro do ano anterior');

console.log('--- textos ---');
eq(hojePorExtenso(HOJE), 'Quinta-feira, 8 de outubro', 'data por extenso');
eq(diasEntre('2026-09-28', HOJE), 10, 'dias entre datas civis');

console.log(`\n${total - falhas}/${total} testes da visão geral passaram`);
if (falhas > 0) process.exit(1);
