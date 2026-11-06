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

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
