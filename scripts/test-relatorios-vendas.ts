/**
 * Relatórios de vendas (E5, parte F), lógica pura: uma linha por produto com
 * a receita aberta por componente, os agrupados (vendedor, unidade, cliente,
 * forma), a tabela dinâmica, as colunas que cada direito vê e a exportação.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-relatorios-vendas.ts
 */
import { normalizarVenda, totaisDaVenda } from '../src/lib/venda-modelo.ts';
import { receitaDaVenda, normalizarConfigReceita } from '../src/lib/venda-receita.ts';
import { montarTabelaDinamica } from '../src/lib/tabela-dinamica.ts';
import {
  COLUNAS_POR_PRODUTO, colunasAgrupadas, colunasPermitidas, csvDaMatriz, linhasPorForma, linhasPorProduto, linhasPorUnidade,
  linhasPorVendedor, matrizParaExportar, formaDoCabecalho, rankingDeClientes, registrosDaDinamica, semColunasSensiveis, totaisDasLinhas,
  chaveDoPagamento, dataDaLinha, filtrarLinhas, linhasDosPagamentos, linhasPorFornecedor, opcoesDosFiltros, paganteDaVenda, seriePorMes, temFiltroDeProduto,
} from '../src/lib/relatorios-vendas.ts';
import type { VendaLida } from '../src/lib/vendas-leitura.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

const lida = (o: Record<string, unknown>): VendaLida => {
  const venda = normalizarVenda(o).venda;
  return { venda, status: 'CONFIRMADO', cancelada: false, situacao: 'ABERTA', versao_modelo: 2, pagamentos: venda.pagamentos };
};
const vendas = [
  lida({ id: 'a', numero: 'VND-1', data_venda: '2026-10-02', cliente: { id: 'c1', nome: 'Carla' }, vendedor: { id: 'u1', nome: 'Bia' }, centro_custo: 'Matriz',
    produtos: [
      { id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel', quantidade: 1, valor_unitario_centavos: 100000, componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }, { tipo: 'RAV', valor_centavos: 3000 }] },
      { id: 'p2', tipo: 'AEREO', descricao: 'Voo', moeda: 'USD', cambio: 5, quantidade: 1, valor_unitario_centavos: 20000, componentes: [{ tipo: 'TAXA_DU', valor_centavos: 1000 }] },
    ],
    pagamentos: [{ id: 'g', forma: 'PIX', valor_centavos: 108000 }, { id: 'h', forma: 'CARTAO', valor_centavos: 105000, parcelas: 3 }] }),
  lida({ id: 'b', numero: 'VND-2', data_venda: '2026-11-04', cliente: { id: 'c2', nome: 'Davi' }, vendedor: { id: 'u2', nome: 'Leo' },
    produtos: [{ id: 'p3', tipo: 'SEGURO', descricao: 'Seguro', quantidade: 2, valor_unitario_centavos: 10000, componentes: [{ tipo: 'MARKUP', valor_centavos: 4000 }, { tipo: 'DESCONTO', valor_centavos: 1000 }] }],
    pagamentos: [{ id: 'g', forma: 'PIX', valor_centavos: 23000 }] }),
];

console.log('--- Por produto ---');
const linhas = linhasPorProduto(vendas);
eq(linhas.map(l => [l.venda_id, l.descricao, l.faturamento, l.receita]), [['a', 'Hotel', 103000, 13000], ['a', 'Voo', 105000, 5000], ['b', 'Seguro', 23000, 3000]], 'uma linha por produto, em reais (câmbio aplicado)');
eq([linhas[0].comp_COMISSAO, linhas[0].comp_RAV, linhas[2].comp_DESCONTO], [10000, 3000, 1000], 'receita aberta por componente');
const fatVendas = vendas.reduce((a, v) => a + totaisDaVenda(v.venda).valor_cliente, 0);
const recVendas = vendas.reduce((a, v) => a + receitaDaVenda(v.venda).receita, 0);
eq([linhas.reduce((a, l) => a + Number(l.faturamento), 0), linhas.reduce((a, l) => a + Number(l.receita), 0)], [fatVendas, recVendas], 'soma das linhas = soma das vendas');
const semRav = linhasPorProduto(vendas, normalizarConfigReceita({ componentes: { RAV: false } }));
eq(semRav[0].receita, 10000, 'receita segue a escolha da agência (RAV fora)');

console.log('--- Agrupados ---');
const pv = linhasPorVendedor(linhas);
eq(pv.map(l => [l.grupo, l.vendas, l.produtos, l.faturamento, l.receita, l.ticket_medio]), [['Bia', 1, 2, 208000, 18000, 208000], ['Leo', 1, 1, 23000, 3000, 23000]], 'por vendedor');
eq(linhasPorUnidade(linhas).map(l => l.grupo), ['Matriz', 'Sem unidade'], 'por unidade (sem centro de custo tem nome)');
eq(rankingDeClientes(linhas).map(l => [l.posicao, l.grupo, l.ultima_compra]), [[1, 'Carla', '2026-10-02'], [2, 'Davi', '2026-11-04']], 'ranking de clientes');
const pf = linhasPorForma(vendas);
eq(pf.map(l => [l.forma, l.vendas, l.parcelas, l.valor]), [['PIX', 2, 2, 131000], ['CARTAO', 1, 3, 105000]], 'por forma de pagamento');
eq(Math.round(pf.reduce((a, l) => a + Number(l.percentual), 0)), 100, 'percentuais somam 100');
eq([formaDoCabecalho('AVISTA_PIX'), formaDoCabecalho('Cartão'), formaDoCabecalho('FATURADO'), formaDoCabecalho('MISTO')], ['PIX', 'CARTAO', 'FATURAR', 'OUTROS'], 'forma do cabeçalho antigo');

console.log('--- Tabela dinâmica ---');
const tab = montarTabelaDinamica(registrosDaDinamica(linhas, 'faturamento'), ['Vendedor'], ['Mês']);
eq([tab.totalGeral, tab.colunas.map(c => c.caminho[0])], [fatVendas, ['2026-10 out', '2026-11 nov']], 'dinâmica por vendedor × mês soma o faturamento');
eq(registrosDaDinamica(linhas, 'receita')[0].ref, { venda_id: 'a', venda_numero: 'VND-1' }, 'célula leva à venda');

console.log('--- Direitos e exportação ---');
eq(colunasPermitidas(COLUNAS_POR_PRODUTO, false, ['receita', 'comp_COMISSAO', 'faturamento']).map(c => c.id), ['faturamento'], 'sem o direito: só o que não é ganho');
eq(colunasPermitidas(COLUNAS_POR_PRODUTO, true, []).some(c => c.id === 'receita'), true, 'com o direito: a receita aparece no padrão');
const limpas = semColunasSensiveis(linhas, COLUNAS_POR_PRODUTO, false);
eq(['receita', 'comp_COMISSAO', 'valor_fornecedor', 'percentual_receita'].some(k => k in limpas[0]), false, 'o número sensível nem sai');
const cols = colunasPermitidas(colunasAgrupadas('Vendedor'), true, ['grupo', 'vendas', 'faturamento', 'percentual_receita']);
eq(totaisDasLinhas(pv, cols), { vendas: 2, faturamento: 231000, percentual_receita: 9.09 }, 'totais com % recalculado');
const m = matrizParaExportar(cols, pv);
eq([m[0], m[1], m[m.length - 1]], [['Vendedor', 'Vendas', 'Faturamento', '% de receita'], ['Bia', 1, 2080, 8.65], ['Total', 2, 2310, 9.09]], 'matriz em reais com total');
eq(csvDaMatriz(m).split('\r\n')[1], 'Bia;1;2080;8,65', 'CSV com vírgula decimal');
eq(matrizParaExportar(colunasPermitidas(COLUNAS_POR_PRODUTO, true, ['data_venda']), linhas)[1], ['02/10/2026'], 'data em dd/mm/aaaa');

console.log('--- Filtros, ranking pela receita, pagamentos e série (E7) ---');
{
  const ls = linhasPorProduto(vendas);
  eq(filtrarLinhas(ls, {}).length, 3, 'sem filtro: todas');
  eq(filtrarLinhas(ls, { vendedor: 'id:u2' }).map(l => l.descricao), ['Seguro'], 'por vendedor (chave do cadastro)');
  eq(filtrarLinhas(ls, { tipo: 'AEREO' }).map(l => l.descricao), ['Voo'], 'por tipo de produto');
  eq(filtrarLinhas(ls, { produto: 'hótel' }).map(l => l.descricao), ['Hotel'], 'busca no produto sem acento');
  eq(filtrarLinhas(ls, { unidade: 'Matriz' }).length, 2, 'por unidade');
  eq(filtrarLinhas(ls, { situacao_produto: 'cancelados' }).length, 0, 'só cancelados');
  eq(filtrarLinhas(ls, { fornecedor: 'nome:inexistente' }).length, 0, 'fornecedor que não está');
  const comDatas = ls.map((l, i) => ({ ...l, data_inicio: ['2027-01-10', '2026-12-01', ''][i] }));
  eq(filtrarLinhas(comDatas, { data_base: 'inicio', de: '2027-01-01', ate: '2027-01-31' }).map(l => l.descricao), ['Hotel'], 'período pela data de início do serviço');
  eq(filtrarLinhas(comDatas, { data_base: 'inicio', de: '2026-01-01' }).some(l => l.descricao === 'Seguro'), false, 'sem a data escolhida, fica fora do período');
  eq(dataDaLinha(comDatas[0], 'venda'), '2026-10-02', 'data da venda');
  eq(temFiltroDeProduto({ situacao_produto: 'todos', data_base: 'venda' }), false, 'padrão não é filtro');
  const op = opcoesDosFiltros(ls);
  eq([op.vendedores.map(o => o.rotulo), op.tipos.map(o => o.valor), op.unidades.map(o => o.valor)], [['Bia', 'Leo'], ['AEREO', 'HOSPEDAGEM', 'SEGURO'], ['Matriz', 'Sem unidade']], 'opções dos filtros tiradas das vendas');
  eq(ls[0].pagante, 'Carla', 'pagante é o cliente quando o pagamento não diz');
  eq(paganteDaVenda({ cliente: { id: 'c', nome: 'Carla' }, pagamentos: [{ pagante: { id: 'e', nome: 'Empresa X' } }, { pagante: null }] } as never), 'Empresa X', 'pagante do pagamento');

  // Ranking pela receita: Davi tem menos faturamento mas, com a receita maior, sobe.
  const outro = [...ls, { ...ls[2], venda_id: 'c', cliente: 'Eva', faturamento: 1000, receita: 90000 }];
  eq(rankingDeClientes(outro, 'receita').map(l => l.grupo), ['Eva', 'Carla', 'Davi'], 'ranking pela receita');
  eq(rankingDeClientes(outro).map(l => l.grupo), ['Carla', 'Davi', 'Eva'], 'ranking pelo faturamento (padrão)');
  eq(linhasPorFornecedor(ls).map(l => l.grupo), ['Sem fornecedor'], 'por fornecedor');

  const liq = new Map([
    [chaveDoPagamento('a', 'g'), { valor_centavos: 108000, liquidado_centavos: 108000, ultima_liquidacao: '2026-10-05', conta_bancaria_id: 'cb1', contas: 1 }],
    [chaveDoPagamento('a', 'h'), { valor_centavos: 105000, liquidado_centavos: 35000, ultima_liquidacao: '2026-11-05', conta_bancaria_id: '', contas: 3 }],
  ]);
  const pags = linhasDosPagamentos(vendas, liq, new Map([['cb1', 'Itaú']]));
  eq(pags.map(l => [l.venda_numero, l.grupo, l.valor, l.liquidado, l.situacao_pagamento, l.conta]), [
    ['VND-1', 'Pix', 108000, 108000, 'Liquidado', 'Itaú'],
    ['VND-1', 'Cartão', 105000, 35000, 'Parcial', ''],
    ['VND-2', 'Pix', 23000, 0, 'Em aberto', ''],
  ], 'um pagamento por linha, com o que já entrou');
  eq(pags[1].cartao_cheque, 'Crédito', 'cartão de crédito');
  eq(linhasDosPagamentos(vendas, liq, new Map(), { soLiquidados: true }).length, 1, 'só liquidados');
  const credito = lida({ id: 'z', numero: 'VND-9', data_venda: '2026-11-09', cliente: { id: 'c1', nome: 'Carla' }, produtos: [],
    pagamentos: [{ id: 'k', forma: 'CREDITO_CLIENTE', valor_centavos: 5000, venda_origem_credito: 'VND-1' }] });
  const pc = linhasDosPagamentos([credito], new Map(), new Map())[0];
  eq([pc.situacao_pagamento, pc.venda_origem_credito, pc.liquidado], ['Compensado', 'VND-1', 5000], 'crédito do cliente: compensado, com a venda de origem');

  eq(seriePorMes(ls, 'faturamento').map(p => [p.rotulo, p.centavos]), [['out/2026', 208000], ['nov/2026', 23000]], 'série por mês');
  const reg = registrosDaDinamica(ls, 'faturamento')[0].campos;
  eq([reg['Ano'], reg['Destino'], reg['Pagante'], reg['Representante'], reg['Situação do produto']], ['2026', 'Sem destino', 'Carla', 'Sem representante', 'Ativo'], 'mais dimensões na tabela dinâmica');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
