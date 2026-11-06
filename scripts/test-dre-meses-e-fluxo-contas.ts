/**
 * E7, G3: DRE mês a mês (cada mês numa coluna, total e média), DRE recortado
 * por centro de custo e por rateio, e a grade conta × dia do fluxo de caixa.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-dre-meses-e-fluxo-contas.ts
 */
import { chaveDaLinhaDRE, dreMesAMes, mesesEntre, montarDRE } from '../src/lib/resultado-dre.ts';
import { aplicarRecorteDRE, fracaoNoRecorte, recorteVazio } from '../src/lib/dre-recorte.ts';
import { OUTRAS_CONTAS, SEM_CONTA, gradeContaPorDia } from '../src/lib/fluxo-comparativo.ts';
import { lancamentosDoCaixa, montarCaderno, periodoQueContem } from '../src/lib/caderno-caixa.ts';
import type { ContaPagar, ContaReceber, PlanoContas } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const plano = [
  { id: 'c22', codigo: '2.2', nome: 'Operacionais' },
  { id: 'c221', codigo: '2.2.1', nome: 'Aluguel' },
  { id: 'c26', codigo: '2.6', nome: 'Comerciais' },
] as unknown as PlanoContas[];

const cr = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, taxa: 0, ...o }) as unknown as ContaReceber;
const cp = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, ...o }) as unknown as ContaPagar;

// ── mesesEntre ─────────────────────────────────────────────────────────────
eq(mesesEntre('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'], 'meses atravessam o ano');
eq(mesesEntre('2026-03', '2026-01'), ['2026-01', '2026-02', '2026-03'], 'meses na ordem mesmo invertidos');
eq(mesesEntre('2020-01', '2026-12', 24).length, 24, 'teto de 24 meses');
eq(mesesEntre('x', '2026-01'), [], 'mês inválido');
eq(chaveDaLinhaDRE('Margem líquida (sobre receita): 12.5%'), 'Margem líquida (sobre receita)', 'chave da margem sem o número');

// ── DRE mês a mês ──────────────────────────────────────────────────────────
const receber = [
  cr('f1', { origem: 'FEE', data_vencimento: '2026-01-10', valor_final: 1000 }),
  cr('f2', { origem: 'FEE', data_vencimento: '2026-02-10', valor_final: 500 }),
  cr('o3', { origem: 'OUTROS', data_vencimento: '2026-03-10', valor_final: 300 }),
];
const pagar = [
  cp('a1', { categoria_id: 'c221', data_vencimento: '2026-01-05', valor_final: 400 }),
  cp('a2', { categoria_id: 'c221', data_vencimento: '2026-02-05', valor_final: 400 }),
  cp('m3', { categoria_id: 'c26', data_vencimento: '2026-03-05', valor_final: 100 }),
];
const base = { receber, pagar, vendasComLastro: [], planoContas: plano, comissaoNaoCapturada: new Map<string, number>() };
const mm = dreMesAMes(base, ['2026-01', '2026-02', '2026-03']);
const linha = (nome: string) => mm.linhas.find(l => l.nome === nome)!;
eq(mm.meses, ['2026-01', '2026-02', '2026-03'], 'uma coluna por mês');
eq(linha('Fee de serviço').valores, [1000, 500, 0], 'fee mês a mês');
eq(linha('Fee de serviço').total, 1500, 'total soma os meses');
eq(linha('Fee de serviço').media, 500, 'média divide pelos meses');
eq(linha('LUCRO LÍQUIDO').valores, [600, 100, 200], 'lucro de cada mês');
eq(linha('LUCRO LÍQUIDO').total, 900, 'lucro do período');
for (const [i, mes] of mm.meses.entries()) {
  const sozinho = montarDRE({ ...base, mes });
  eq(sozinho.filter(l => !l.nome.startsWith('Margem')).every(l => mm.linhas.find(x => x.chave === l.nome)?.valores[i] === l.valor), true,
    `coluna de ${mes} é o DRE daquele mês, linha por linha`);
}
const margem = mm.linhas.find(l => l.chave === 'Margem líquida (sobre receita)')!;
eq(margem.percentual, true, 'margem marcada como percentual');
eq(margem.total, 50, 'margem do período = lucro total ÷ receita total (900 ÷ 1800)');
eq(margem.media, 50, 'média da margem = margem do período');
eq(mm.linhas.findIndex(l => l.nome === 'RECEITA BRUTA (comissão + serviços)') < mm.linhas.findIndex(l => l.nome === 'LUCRO LÍQUIDO'), true, 'ordem do demonstrativo preservada');
// Linha que só existe num mês (Outras despesas) entra no lugar certo e vale 0 nos outros.
const comOutra = dreMesAMes({ ...base, pagar: [...pagar, cp('x', { categoria_id: 'nenhuma', data_vencimento: '2026-02-20', valor_final: 50 })] }, ['2026-01', '2026-02']);
const outra = comOutra.linhas.find(l => l.nome === '(-) OUTRAS DESPESAS')!;
eq(outra.valores, [0, -50], 'linha de um mês só vale 0 nos outros');
eq(comOutra.linhas.findIndex(l => l.nome === '(-) OUTRAS DESPESAS') < comOutra.linhas.findIndex(l => l.nome === 'LUCRO LÍQUIDO'), true, 'e entra antes do lucro');

// ── Recorte por centro de custo e rateio ───────────────────────────────────
const centros = [
  { id: 'mtz', nome: 'Matriz' },
  { id: 'loja', nome: 'Loja', centro_pai_id: 'mtz' },
  { id: 'fil', nome: 'Filial' },
];
const rRec = [
  cr('r1', { origem: 'FEE', data_vencimento: '2026-01-10', valor_final: 1000, centro_custo_id: 'mtz' }),
  cr('r2', { origem: 'FEE', data_vencimento: '2026-01-10', valor_final: 600, centro_custo_id: 'fil' }),
  cr('r3', { origem: 'FEE', data_vencimento: '2026-01-10', valor_final: 200, status: 'RECEBIDO', valor_recebido: 200, data_recebimento: '2026-01-11', taxa: 10,
    rateio: [{ centro_custo_id: 'loja', percentual: 25 }, { centro_custo_id: 'fil', percentual: 75 }] }),
  cr('vr', { origem: 'VENDA', venda_id: 'v1', data_vencimento: '2026-01-15', valor_final: 3000, centro_custo: 'Filial' }),
];
const rPag = [
  cp('p1', { categoria_id: 'c221', data_vencimento: '2026-01-05', valor_final: 300,
    rateio: [{ centro_custo_id: 'mtz', percentual: 50 }, { centro_custo_id: 'fil', percentual: 50 }] }),
  cp('p2', { categoria_id: 'c221', data_vencimento: '2026-01-05', valor_final: 100, centro_custo: 'Loja' }),
];
const vendas = [
  { id: 'v1', status: 'CONFIRMADO', valor_final: 3000, valor_total_custo: 2500, data_venda: '2026-01-15', centro_custo: 'Matriz' },
  { id: 'v2', status: 'CONFIRMADO', valor_final: 1000, valor_total_custo: 800, data_venda: '2026-01-20', centro_custo: 'Loja' },
];
eq(recorteVazio({ rateio: 'todas' }), true, 'sem centro e todas = sem recorte');
eq(fracaoNoRecorte(rRec[2], { centro_id: 'mtz' }, centros, 'receber'), 0.25, 'conta rateada: a parte do centro (Loja está abaixo da Matriz)');
eq(fracaoNoRecorte(rRec[1], { centro_id: 'mtz' }, centros, 'receber'), 0, 'conta de outro centro fica fora');
eq(fracaoNoRecorte(rPag[1], { centro_id: 'loja' }, centros, 'pagar'), 1, 'centro pelo nome escrito na conta');
const semRecorte = aplicarRecorteDRE({ receber: rRec, pagar: rPag, vendas }, null, centros);
eq(semRecorte.receber, rRec, 'sem recorte devolve as contas intactas');
const mtz = aplicarRecorteDRE({ receber: rRec, pagar: rPag, vendas, encargos: new Map([['contas_receber:r3', { juros: 4, multa: 0, desconto: 0, taxa: 0 }]]) }, { centro_id: 'mtz' }, centros);
eq(mtz.receber.map(c => [c.id, c.valor_final]), [['r1', 1000], ['r3', 50]], 'Matriz: r1 inteira e 25% de r3');
eq(mtz.receber.find(c => c.id === 'r3')!.valor_recebido, 50, 'recebido também na proporção');
eq(mtz.receber.find(c => c.id === 'r3')!.taxa, 2.5, 'taxa também na proporção');
eq(mtz.pagar.map(c => [c.id, c.valor_final]), [['p1', 150], ['p2', 100]], 'Matriz: metade de p1 e p2 da Loja (abaixo dela)');
eq(mtz.encargos?.get('contas_receber:r3')?.juros, 1, 'encargo da liquidação na proporção');
eq(mtz.vendas.map(v => v.id), ['v2'], 'venda pela conta dela (v1 é da Filial) ou pelo centro escrito (v2 na Loja)');
const fil = aplicarRecorteDRE({ receber: rRec, pagar: rPag, vendas }, { centro_id: 'fil' }, centros);
eq(fil.vendas.map(v => [v.id, v.valor_final]), [['v1', 3000]], 'Filial: a venda cuja conta é da Filial');
const so = aplicarRecorteDRE({ receber: rRec, pagar: rPag, vendas }, { rateio: 'rateadas' }, centros);
eq([so.receber.map(c => c.id), so.pagar.map(c => c.id), so.vendas.length], [['r3'], ['p1'], 0], 'só rateadas');
const semRateio = aplicarRecorteDRE({ receber: rRec, pagar: rPag, vendas }, { rateio: 'sem_rateio' }, centros);
eq([semRateio.receber.map(c => c.id), semRateio.pagar.map(c => c.id)], [['r1', 'r2', 'vr'], ['p2']], 'só sem rateio');
// As partes de todos os centros somam o DRE inteiro.
const dreDe = (r: typeof semRecorte) => montarDRE({ receber: r.receber, pagar: r.pagar, vendasComLastro: [], planoContas: plano, comissaoNaoCapturada: new Map(), mes: '2026-01' })
  .find(l => l.nome === 'LUCRO LÍQUIDO')!.valor;
const somaCentros = Math.round((dreDe(mtz) + dreDe(fil)) * 100) / 100;
eq(somaCentros, dreDe(semRecorte), 'Matriz + Filial = o DRE sem recorte');

// ── Fluxo: grade conta × dia ───────────────────────────────────────────────
const hoje = '2026-11-10';
const periodo = periodoQueContem('mes', '2026-11-05');
const contas = [
  { id: 'itau', nome: 'Itaú', saldo_inicial: 1000 },
  { id: 'cx', nome: 'Caixa Geral', saldo_inicial: 50 },
];
const fRec = [
  cr('e1', { status: 'RECEBIDO', valor_final: 300, valor_recebido: 300, data_recebimento: '2026-11-03', data_vencimento: '2026-11-03', conta_bancaria_id: 'itau' }),
  cr('e2', { status: 'RECEBIDO', valor_final: 80, valor_recebido: 80, data_recebimento: '2026-10-20', data_vencimento: '2026-10-20' }),
  cr('e3', { valor_final: 200, data_vencimento: '2026-11-20' }),
  cr('e4', { valor_final: 70, data_vencimento: '2026-11-15', conta_bancaria_id: 'apagada' }),
];
const fPag = [
  cp('s1', { status: 'PAGO', valor_final: 100, valor_pago: 100, data_pagamento: '2026-11-03', data_vencimento: '2026-11-03', conta_bancaria_id: 'itau' }),
  cp('s2', { valor_final: 40, data_vencimento: '2026-11-25', conta_bancaria_id: 'itau' }),
];
const grade = gradeContaPorDia({ receber: fRec, pagar: fPag, contas, caixaGeralId: 'cx', periodo, hoje });
eq(grade.dias.length, 30, 'um dia por coluna (novembro)');
eq(grade.linhas.map(l => l.id), ['itau', 'cx', SEM_CONTA, OUTRAS_CONTAS], 'contas, previsto sem conta e outras contas');
const itau = grade.linhas[0];
eq(itau.saldoInicial, 1000, 'saldo inicial da conta');
eq(itau.movimentos[2], 200, 'dia 3: +300 −100');
eq(itau.saldos[2], 1200, 'saldo no fim do dia 3');
eq(itau.saldos[29], 1160, 'saldo no fim do mês com a previsão do dia 25');
eq(grade.linhas[1].saldoInicial, 130, 'baixa sem conta cai na Caixa Geral (antes do período)');
eq(grade.linhas[2].saldos[29], 200, 'previsão sem conta numa linha própria');
eq(grade.linhas[3].movimentos[14], 70, 'conta apagada vai para Outras contas');
eq(Object.keys(itau.lancamentosPorDia), ['2026-11-03', '2026-11-25'], 'lançamentos guardados nos dias com movimento');
const todas = montarCaderno({ lancamentos: lancamentosDoCaixa({ receber: fRec, pagar: fPag, hoje }), contas, periodo, agrupamento: 'dia', hoje });
eq(grade.total.saldos, todas.curva.map(p => p.saldo), 'a soma das linhas é o caderno de todas as contas, dia a dia');
eq(grade.total.saldoInicial, todas.saldoInicial, 'e o saldo inicial também');
const semNada = gradeContaPorDia({ receber: [], pagar: [], contas, periodo, hoje });
eq(semNada.linhas.map(l => l.id), ['itau', 'cx'], 'sem títulos, só as contas');
const comFolha = gradeContaPorDia({ receber: [], pagar: [], folha: [{ descricao: 'Folha', valor: 500, data_pagamento: '2026-11-05', competencia: '2026-10' }], contas, periodo, hoje });
eq(comFolha.linhas[2]?.movimentos[9], -500, 'folha vencida e não lançada entra hoje em Previsto sem conta');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
