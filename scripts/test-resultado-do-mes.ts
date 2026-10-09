/**
 * FATURAMENTO, RECEITA e LUCRO pelo caixa.
 *
 * As três palavras que o Bruno definiu em 09/10/2026, e o que elas têm de
 * diferente do "Resultado do mês" antigo — que cortava por VENCIMENTO e somava
 * o valor DEVIDO, não o pago.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-resultado-do-mes.ts
 */
import { calcularResultadoDoMes, despesasPagasPorCategoria, fatiaDoFornecedor, mesDoCaixa, ehRepasse } from '../src/lib/resultado-do-mes.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const VENDA = { id: 'v1', valor_final: 10000, valor_total_custo: 8000 }; // 80% do fornecedor
const recebida = (over = {}) => ({
  origem: 'VENDA', venda_id: 'v1', status: 'RECEBIDO',
  valor_final: 10000, valor_recebido: 10000, data_recebimento: '2026-10-15',
  data_vencimento: '2026-10-10', ...over,
});
const paga = (over = {}) => ({
  origem: 'OUTROS', auto_gerado: 'false', status: 'PAGO',
  valor_final: 500, valor_pago: 500, data_pagamento: '2026-10-20',
  data_vencimento: '2026-10-18', ...over,
});

console.log('--- a escada: faturamento, receita, lucro ---');
{
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [recebida()], pagar: [paga()], vendas: [VENDA] });
  eq(r.faturamento, 10000, 'faturamento é o dinheiro de cliente que entrou');
  eq(r.parte_do_fornecedor, 8000, '80% da venda pertence ao fornecedor');
  eq(r.receita, 2000, 'receita é o que sobrou da comissão');
  eq(r.despesas_pagas, 500, 'as contas da agência pagas no mês');
  eq(r.lucro, 1500, 'lucro = receita − contas pagas');
  // A escada fecha: é o ponto do pedido.
  eq(r.faturamento - r.parte_do_fornecedor, r.receita, 'faturamento − fornecedor = receita, sem sobra');
  eq(r.receita - r.despesas_pagas, r.lucro, 'receita − despesas = lucro, sem sobra');
  eq([r.margem_sobre_faturamento, r.margem_sobre_receita], [20, 75], 'as duas margens');
}

console.log('--- o que muda em relação ao resultado antigo (vencimento × caixa) ---');
{
  // Conta que VENCEU em outubro e NÃO foi paga. No modelo antigo ela já
  // derrubava o lucro de outubro; aqui ela só entra quando o dinheiro sair.
  const naoPaga = paga({ status: 'PENDENTE', valor_pago: 0, data_pagamento: null, data_vencimento: '2026-10-05' });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [recebida()], pagar: [naoPaga], vendas: [VENDA] });
  eq(r.despesas_pagas, 0, 'conta vencida e não paga não entra: ninguém tirou dinheiro do caixa');
  eq(r.lucro, 2000, 'e o lucro do mês não cai por causa dela');

  // Conta de SETEMBRO paga em OUTUBRO: no modelo antigo sumia de outubro.
  const atrasada = paga({ valor_final: 300, valor_pago: 300, data_vencimento: '2026-09-02', data_pagamento: '2026-10-07' });
  const r2 = calcularResultadoDoMes({ mes: '2026-10', receber: [recebida()], pagar: [atrasada], vendas: [VENDA] });
  eq(r2.despesas_pagas, 300, 'conta de outro mês, paga neste, entra neste');
  eq(r2.lucro, 1700, 'porque foi neste mês que o dinheiro saiu');

  // Venda fechada em outubro mas recebida em novembro não é faturamento de outubro.
  const aReceber = recebida({ status: 'PENDENTE', valor_recebido: 0, data_recebimento: null, data_vencimento: '2026-11-10' });
  const r3 = calcularResultadoDoMes({ mes: '2026-10', receber: [aReceber], pagar: [], vendas: [VENDA] });
  eq([r3.faturamento, r3.receita, r3.lucro], [0, 0, 0], 'venda ainda não recebida não é faturamento do mês');
}

console.log('--- o repasse ao fornecedor não é despesa ---');
{
  // Ele JÁ foi descontado na parte do fornecedor. Subtrair de novo derrubaria
  // o lucro pelo valor inteiro dos fornecedores — o erro mais caro daqui.
  const repasse = paga({ origem: 'VENDA', auto_gerado: 'true', valor_final: 8000, valor_pago: 8000 });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [recebida()], pagar: [repasse, paga()], vendas: [VENDA] });
  eq(r.despesas_pagas, 500, 'só a despesa própria entra; o repasse fica fora');
  eq(r.lucro, 1500, 'o lucro não é derrubado duas vezes pelo fornecedor');
  eq(ehRepasse({ origem: 'VENDA', auto_gerado: 'true' }), true, 'repasse é auto_gerado + origem VENDA');
  eq([{ origem: 'VENDA', auto_gerado: 'false' }, { origem: 'OUTROS', auto_gerado: 'true' }, {}].map(ehRepasse), [false, false, false], 'conta criada à mão sobre venda NÃO é repasse');
  eq(ehRepasse({ origem: 'VENDA', auto_gerado: true }), true, 'booleano também conta');
}

console.log('--- comissão de fornecedor é receita sem faturamento ---');
{
  const comissao = recebida({ origem: 'COMISSAO_FORNECEDOR', venda_id: null, valor_final: 700, valor_recebido: 700 });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [comissao], pagar: [], vendas: [] });
  eq(r.faturamento, 0, 'ela não infla o volume de vendas');
  eq(r.comissao_de_fornecedor, 700, 'entra na linha dela');
  eq(r.receita, 700, 'e inteira na receita: não tem fatia de ninguém');
  eq(r.margem_sobre_faturamento, null, 'sem faturamento, a margem sobre ele não existe — não é 0%');
}

console.log('--- venda sem custo: "não sei" não vira "não tem" ---');
{
  // Tratar custo ausente como zero faria o faturamento inteiro virar receita.
  const r = calcularResultadoDoMes({
    mes: '2026-10', receber: [recebida()], pagar: [],
    vendas: [{ id: 'v1', valor_final: 10000, valor_total_custo: 0 }],
  });
  eq(r.parte_do_fornecedor, 0, 'sem custo cadastrado não se inventa fatia');
  eq(r.faturamento_sem_custo, 10000, 'mas o valor fica declarado, para a tela avisar');
  eq([fatiaDoFornecedor({ valor_final: 10000, valor_total_custo: 0 }), fatiaDoFornecedor(null), fatiaDoFornecedor({ valor_final: 0, valor_total_custo: 5 })], [null, null, null], 'sem custo, sem venda e sem valor devolvem null, nunca 0');
  eq(fatiaDoFornecedor({ valor_final: 100, valor_total_custo: 300 }), 1, 'custo maior que a venda: tudo é do fornecedor, nunca mais que tudo');
}

console.log('--- recebimento parcial conta pelo que entrou ---');
{
  const parcial = recebida({ status: 'PARCIAL', valor_recebido: 2500 });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [parcial], pagar: [], vendas: [VENDA] });
  eq(r.faturamento, 2500, 'entrou 2.500 de 10.000');
  eq(r.parte_do_fornecedor, 2000, 'e 80% disso é do fornecedor');
  eq(r.receita, 500, 'a receita acompanha o que entrou, não o que foi vendido');
}

console.log('--- bordas ---');
{
  const vazio = calcularResultadoDoMes({ mes: '2026-10', receber: [], pagar: [], vendas: [] });
  eq([vazio.faturamento, vazio.receita, vazio.lucro], [0, 0, 0], 'mês sem nada não quebra');
  eq([vazio.margem_sobre_receita, vazio.margem_sobre_faturamento], [null, null], 'e não estampa 0% nem NaN');

  const cancelada = calcularResultadoDoMes({
    mes: '2026-10', receber: [recebida({ status: 'CANCELADO' })],
    pagar: [paga({ status: 'CANCELADO' })], vendas: [VENDA],
  });
  eq([cancelada.faturamento, cancelada.despesas_pagas], [0, 0], 'cancelada não existe para efeito de número');

  // Mês sem receita e com conta paga: o lucro é negativo, e isso tem de aparecer.
  const prejuizo = calcularResultadoDoMes({ mes: '2026-10', receber: [], pagar: [paga()], vendas: [] });
  eq(prejuizo.lucro, -500, 'mês sem receita e com conta paga dá lucro negativo');
  eq(prejuizo.margem_sobre_receita, null, 'sem receita não se divide por ela');

  // Baixa sem data gravada cai no vencimento, como o resto do sistema faz.
  eq(mesDoCaixa({ data_recebimento: '2026-10-15', data_vencimento: '2026-09-01' }), '2026-10', 'a data da baixa manda');
  eq(mesDoCaixa({ data_recebimento: null, data_vencimento: '2026-09-01' }), '2026-09', 'sem data de baixa, vale o vencimento');
  eq(mesDoCaixa({ data_pagamento: '2026-11-02', data_vencimento: '2026-10-01' }), '2026-11', 'do lado de pagar também');
}

console.log('--- centavos ---');
{
  // Três parcelas de uma venda com fatia de 1/3: a soma não pode vazar.
  const terco = { id: 'v2', valor_final: 300, valor_total_custo: 100 };
  const p = (v: number) => recebida({ venda_id: 'v2', valor_final: v, valor_recebido: v });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [p(100.01), p(100.01), p(99.98)], pagar: [], vendas: [terco] });
  eq(r.faturamento, 300, 'as parcelas somam a venda');
  eq(r.faturamento - r.parte_do_fornecedor, r.receita, 'e a escada continua fechando no centavo');
}

console.log('--- o detalhamento fecha com o total ---');
{
  const contas = [
    paga({ categoria_id: '2.2.01', valor_final: 1200, valor_pago: 1200 }),
    paga({ categoria_id: '2.2.01', valor_final: 300, valor_pago: 300 }),
    paga({ categoria_id: '2.3.01', valor_final: 450, valor_pago: 450 }),
    paga({ categoria_id: '', valor_final: 70, valor_pago: 70 }),
    paga({ origem: 'VENDA', auto_gerado: 'true', valor_final: 9000, valor_pago: 9000 }),
    paga({ status: 'PENDENTE', valor_pago: 0, data_pagamento: null, categoria_id: '2.2.01' }),
  ];
  const linhas = despesasPagasPorCategoria({ mes: '2026-10', pagar: contas });
  const r = calcularResultadoDoMes({ mes: '2026-10', receber: [], pagar: contas, vendas: [] });
  eq(linhas.map(l => [l.categoria_id, l.valor]), [['2.2.01', 1500], ['2.3.01', 450], ['', 70]], 'agrupa por categoria, da maior para a menor');
  eq(Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100, r.despesas_pagas, 'a soma das linhas é exatamente o total de despesas pagas');
  eq(linhas.some(l => l.valor === 9000), false, 'o repasse ao fornecedor fica fora do detalhamento também');
  eq(linhas.find(l => l.categoria_id === '')?.valor, 70, 'conta sem categoria aparece, em vez de sumir');
  eq(despesasPagasPorCategoria({ mes: '2026-10', pagar: [] }), [], 'mês sem conta paga não inventa linha');
}

console.log(`\n${total - falhas}/${total} testes do resultado do mês passaram`);
if (falhas > 0) process.exit(1);
