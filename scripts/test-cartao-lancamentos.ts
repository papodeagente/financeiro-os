/**
 * Lançamentos de cartão (src/lib/cartao-lancamentos.ts).
 *
 * O caso que motivou: a fatura de outubro traz de novo a MESMA compra
 * parcelada que já está lançada desde julho. Sem identidade estável, cada
 * importação cria despesa nova e a dívida do cartão dobra todo mês.
 */
import {
  normalizarEstabelecimento, idDaCompra, idDaParcela, gerarParcelas,
  conciliarFatura, resumirImportacao, gastosPorEstabelecimento,
  comprometidoFuturo, chaveDeAgrupamento, MAX_PARCELAS,
} from '../src/lib/cartao-lancamentos.ts';
import { soma } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- o nome do estabelecimento varia entre faturas ---');
eq(normalizarEstabelecimento('NETFLIX.COM 03/12'), 'NETFLIX COM', 'tira o sufixo de parcela');
eq(normalizarEstabelecimento('NETFLIX.COM 04/12'), 'NETFLIX COM', 'e o mês seguinte vira o mesmo texto');
eq(normalizarEstabelecimento('NETFLIX.COM  PARC 05/12'), 'NETFLIX COM', 'com a palavra PARC');
eq(normalizarEstabelecimento('  netflix.com  '), 'NETFLIX COM', 'caixa e espaço não importam');
eq(normalizarEstabelecimento('POSTO SÃO JOÃO'), 'POSTO SAO JOAO', 'acento é removido');
eq(normalizarEstabelecimento(''), '', 'vazio continua vazio');

console.log('\n--- identidade da compra ---');
{
  const base = { cartao_id: 'c1', descricao: 'NETFLIX.COM', valor_total: 1200, data_compra: '2026-07-10', parcelas: 12 };
  eq(idDaCompra(base) === idDaCompra({ ...base, descricao: 'NETFLIX.COM 05/12' }), true,
     'o sufixo de parcela na descrição NÃO muda a identidade');
  eq(idDaCompra(base) === idDaCompra({ ...base, data_compra: '2026-07-28' }), true,
     'dia diferente no mesmo mês é a mesma compra: a fatura usa a data de processamento');
  eq(idDaCompra(base) === idDaCompra({ ...base, data_compra: '2026-08-10' }), false,
     'mês diferente é outra compra');
  eq(idDaCompra(base) === idDaCompra({ ...base, parcelas: 6 }), false,
     'mesmo valor no mesmo dia em 6x é outra compra');
  eq(idDaCompra(base) === idDaCompra({ ...base, cartao_id: 'c2' }), false,
     'outro cartão é outra compra');
  eq(idDaCompra(base) === idDaCompra({ ...base, valor_total: 1200.01 }), false,
     'um centavo de diferença é outra compra');
}
eq(idDaParcela('cc_abc', 3), 'cc_abc_03', 'id da parcela é previsível e ordenável');

console.log('\n--- quebra em parcelas ---');
{
  const p = gerarParcelas({
    cartao_id: 'c1', descricao: 'Notebook', valor_total: 100, data_compra: '2026-09-05',
    categoria_id: '', fornecedor_nome: '', parcelas: 3, observacoes: '',
  }, 10);
  eq(p.map(x => x.valor), [33.33, 33.33, 33.34],
     'o centavo que sobra vai na ÚLTIMA, como o helper auditado do sistema faz em venda e conta');
  eq(soma(p.map(x => x.valor)), 100, 'a soma bate com o total, sem centavo sumido');
  eq(p.map(x => x.competencia), ['2026-09', '2026-10', '2026-11'], 'uma parcela por mês');
  eq(p.map(x => x.data_vencimento), ['2026-09-10', '2026-10-10', '2026-11-10'], 'vence no dia do cartão');
  eq(p.map(x => x.descricao), ['Notebook (1/3)', 'Notebook (2/3)', 'Notebook (3/3)'], 'descrição diz a parcela');
  eq(new Set(p.map(x => x.id)).size, 3, 'cada parcela tem id próprio');
}
{
  const p = gerarParcelas({
    cartao_id: 'c1', descricao: 'Almoço', valor_total: 80, data_compra: '2026-09-05',
    categoria_id: '', fornecedor_nome: '', parcelas: 1, observacoes: '',
  }, 10);
  eq([p.length, p[0].valor, p[0].descricao], [1, 80, 'Almoço'], 'à vista não escreve (1/1) na descrição');
}
{
  const p = gerarParcelas({
    cartao_id: 'c1', descricao: 'X', valor_total: 2400, data_compra: '2026-09-05',
    categoria_id: '', fornecedor_nome: '', parcelas: 99, observacoes: '',
  }, 10);
  eq(p.length, MAX_PARCELAS, 'acima de 24 é limitado, em vez de gerar 99 despesas');
}
{
  const p = gerarParcelas({
    cartao_id: 'c1', descricao: 'X', valor_total: 300, data_compra: '2026-12-05',
    categoria_id: '', fornecedor_nome: '', parcelas: 3, observacoes: '',
  }, 31);
  eq(p.map(x => x.competencia), ['2026-12', '2027-01', '2027-02'], 'vira o ano');
  eq(p[0].data_vencimento, '2026-12-28', 'dia acima de 28 é limitado: fevereiro não tem 31');
}

console.log('\n--- O CASO QUE MOTIVOU: a fatura do mês seguinte ---');
{
  // Compra de R$ 1.200 em 12x feita em julho. Parcelas 1 a 3 já lançadas.
  const compra = {
    cartao_id: 'c1', descricao: 'NETFLIX.COM', valor_total: 1200, data_compra: '2026-07-10',
    categoria_id: '', fornecedor_nome: '', parcelas: 12, observacoes: '',
  };
  const geradas = gerarParcelas(compra, 10);
  const jaLancadas = geradas.slice(0, 3).map(p => p.id);
  const comprasConhecidas = [geradas[0].compra_id];

  // Fatura de outubro: traz a parcela 4/12, de R$ 100.
  const fatura = [{ descricao: 'NETFLIX.COM 04/12', valor: 100, data: '2026-10-10', parcela_numero: 4, total_parcelas: 12 }];
  const [item] = conciliarFatura(fatura, 'c1', jaLancadas, comprasConhecidas);
  eq(item.situacao, 'PARCELA_CONHECIDA', 'a parcela 4 é reconhecida como da MESMA compra');
  eq(item.compra_id, geradas[0].compra_id, 'e o id da compra bate com o que já estava no sistema');
  eq(item.parcela_id, geradas[3].id, 'o id da parcela bate com a 4 que faltava');

  // Reimportar a MESMA fatura não pode lançar de novo.
  const fatura3 = [{ descricao: 'NETFLIX.COM 03/12', valor: 100, data: '2026-09-10', parcela_numero: 3, total_parcelas: 12 }];
  const [item3] = conciliarFatura(fatura3, 'c1', jaLancadas, comprasConhecidas);
  eq(item3.situacao, 'JA_LANCADO', 'a parcela 3, que já está lançada, NÃO entra de novo');
  eq(item3.motivo.includes('já está lançada'), true, 'e o motivo explica');
}
{
  // Compra nova, que o sistema nunca viu.
  const [item] = conciliarFatura(
    [{ descricao: 'PADARIA CENTRAL', valor: 45.9, data: '2026-10-03', parcela_numero: 1, total_parcelas: 1 }],
    'c1', [], [],
  );
  eq([item.situacao, item.valor], ['NOVO', 45.9], 'compra à vista nova');
}
{
  // A fatura só mostra a PARCELA. O total da compra é reconstruído, senão
  // a mesma compra em 12x viraria 12 compras diferentes.
  const a = conciliarFatura([{ descricao: 'CURSO', valor: 100, data: '2026-10-10', parcela_numero: 4, total_parcelas: 12 }], 'c1', [], []);
  const b = conciliarFatura([{ descricao: 'CURSO', valor: 100, data: '2026-11-10', parcela_numero: 5, total_parcelas: 12 }], 'c1', [], []);
  eq(a[0].compra_id, b[0].compra_id, 'parcelas 4 e 5 da mesma compra dão o MESMO id de compra');
  eq(a[0].parcela_id !== b[0].parcela_id, true, 'mas ids de parcela diferentes');
}
{
  // Duas compras iguais no mesmo mês, uma em 3x e outra em 6x.
  const x = conciliarFatura([{ descricao: 'LOJA', valor: 100, data: '2026-10-05', parcela_numero: 1, total_parcelas: 3 }], 'c1', [], []);
  const y = conciliarFatura([{ descricao: 'LOJA', valor: 50, data: '2026-10-05', parcela_numero: 1, total_parcelas: 6 }], 'c1', [], []);
  eq(x[0].compra_id !== y[0].compra_id, true, 'parcelamentos diferentes não se confundem');
}

console.log('\n--- resumo da importação ---');
{
  const itens = conciliarFatura([
    { descricao: 'A', valor: 10, data: '2026-10-01', parcela_numero: 1, total_parcelas: 1 },
    { descricao: 'B', valor: 20, data: '2026-10-02', parcela_numero: 1, total_parcelas: 1 },
  ], 'c1', [], []);
  const jaTem = [itens[0].parcela_id];
  const outra = conciliarFatura([
    { descricao: 'A', valor: 10, data: '2026-10-01', parcela_numero: 1, total_parcelas: 1 },
    { descricao: 'B', valor: 20, data: '2026-10-02', parcela_numero: 1, total_parcelas: 1 },
  ], 'c1', jaTem, []);
  const r = resumirImportacao(outra);
  eq([r.novos, r.ja_lancados, r.total_a_lancar], [1, 1, 20],
     'o total a lançar EXCLUI o que já existe: é o número que vai virar dívida');
}

console.log('\n--- onde o dinheiro está indo ---');
{
  const g = gastosPorEstabelecimento([
    { descricao: 'UBER *TRIP 123', valor: 30 },
    { descricao: 'UBER *TRIP 456', valor: 20 },
    { descricao: 'IFOOD', valor: 100 },
  ]);
  eq(g.map(x => [x.rotulo, x.total, x.quantidade]), [['IFOOD', 100, 1], ['UBER TRIP', 50, 2]],
     'corridas de Uber viram UM gasto, senão o relatório não diz nada');
  eq(g[0].share_pct, 66.67, 'participação no total');
  eq(soma(g.map(x => x.total)), 150, 'nada se perde no agrupamento');
}
eq(gastosPorEstabelecimento([]), [], 'sem lançamento não quebra');
{
  // A distinção que importa: agrupar é mais agressivo que identificar.
  eq(chaveDeAgrupamento('UBER *TRIP 123'), 'UBER TRIP', 'o relatório descarta o código da transação');
  eq(normalizarEstabelecimento('UBER *TRIP 123'), 'UBER TRIP 123',
     'mas a IDENTIDADE preserva o código: fundir compras diferentes faria uma sumir');
  eq(chaveDeAgrupamento('LOJA 24H'), 'LOJA 24H',
     'mas 24H faz parte do NOME e é preservado: só número puro no fim é código');
  eq(chaveDeAgrupamento('PAG*MERCADO 998877'), 'PAG MERCADO', 'código puro no fim sai');
}

console.log('\n--- limite comprometido nos próximos meses ---');
{
  const p = [
    { competencia: '2026-10', valor: 100, pago: false },
    { competencia: '2026-10', valor: 50, pago: true },
    { competencia: '2026-11', valor: 100, pago: false },
    { competencia: '2026-12', valor: 100, pago: false },
  ];
  const c = comprometidoFuturo(p, '2026-10', 3);
  eq(c.map(x => x.total), [100, 100, 100], 'parcela já paga não conta como compromisso futuro');
  eq(c.map(x => x.competencia), ['2026-10', '2026-11', '2026-12'], 'um mês por linha');
}

console.log(`\n${total - falhas}/${total} testes do cartão passaram`);
process.exit(falhas > 0 ? 1 : 0);
