/**
 * Relatórios de vendas no fechamento da E7 (frente C), lógica pura: o que já
 * existia continua igual (colunas padrão, campos do cartão, fatura sem dados
 * corporativos), as colunas novas, a viagem corporativa, a conciliação do
 * cartão corporativo do cliente e a empresa.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-relatorios-vendas-e7.ts
 */
import { normalizarCamposDaForma, normalizarCorporativo, normalizarVenda, pagoComCartaoCorporativo, textoDosCampos } from '../src/lib/venda-modelo.ts';
import {
  CAMPOS_DA_DINAMICA, COLUNAS_CARTAO_CORPORATIVO, COLUNAS_POR_PRODUTO, colunasPermitidas, dividirPelosPesos, filtrarLinhas,
  linhasDoCartaoCorporativo, linhasPorEmpresa, linhasPorProduto, opcoesDosFiltros, registrosDaDinamica, temFiltroDeProduto, totaisDasLinhas,
} from '../src/lib/relatorios-vendas.ts';
import { CABECALHO_DA_EXPORTACAO, linhasDaExportacao, valorDaColuna } from '../src/lib/fatura-documento.ts';
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
const lida = (o: Record<string, unknown>, empresa_id?: string): VendaLida => {
  const venda = normalizarVenda(o).venda;
  return { venda, status: 'CONFIRMADO', cancelada: false, situacao: 'ABERTA', versao_modelo: 2, pagamentos: venda.pagamentos, ...(empresa_id ? { empresa_id } : {}) };
};

console.log('--- O que já existia não muda ---');
eq(COLUNAS_POR_PRODUTO.filter(c => c.padrao).map(c => c.id),
  ['venda_numero', 'data_venda', 'cliente', 'vendedor', 'tipo', 'descricao', 'fornecedor', 'comp_COMISSAO', 'comp_TAXA_DU', 'comp_RAV', 'comp_FEE', 'faturamento', 'receita', 'percentual_receita'],
  'colunas padrão de Vendas por produto são as de antes');
eq(COLUNAS_POR_PRODUTO.length >= 80, true, 'catálogo com 80 colunas ou mais');
eq(new Set(COLUNAS_POR_PRODUTO.map(c => c.id)).size, COLUNAS_POR_PRODUTO.length, 'ids sem repetição');
eq(normalizarCamposDaForma('CARTAO', { autorizacao: 'X1', bandeira: 'Visa', final_cartao: '9999' }), { autorizacao: 'X1', bandeira: 'Visa', final_cartao: '9999' }, 'cartão comum: os mesmos campos de antes');
eq(normalizarCamposDaForma('PAGO_DIRETO_FORNECEDOR', { final_cartao: '1234' }), undefined, 'pago direto sem marcar cartão corporativo: nada guardado (como antes)');
eq(normalizarCamposDaForma('PIX', { cartao_corporativo: true }), undefined, 'outras formas não guardam campos');
eq(normalizarVenda({ cliente: { nome: 'A' }, data_venda: '2026-11-01' }).venda.corporativo, undefined, 'venda sem dados corporativos não ganha o campo');
eq(CABECALHO_DA_EXPORTACAO.length, 15, 'cabeçalho da fatura exportada é o de sempre');

console.log('--- Viagem corporativa no modelo ---');
eq(normalizarCorporativo({ solicitante: '  Rita ', aprovador: '', nada: 'x', projeto: 'P'.repeat(200) }), { solicitante: 'Rita', projeto: 'P'.repeat(120) }, 'limpa, sem vazio nem campo estranho, com teto');
const campos = normalizarCamposDaForma('PAGO_DIRETO_FORNECEDOR', { cartao_corporativo: true, final_cartao: '5555 4444 3333 2222', autorizacao: 'Z9', requisicao: 'OC-1' });
eq(campos, { autorizacao: 'Z9', final_cartao: '2222', cartao_corporativo: true, requisicao: 'OC-1' }, 'pago direto com o cartão corporativo: só o final');
eq(textoDosCampos(campos), 'corporativo do cliente · final 2222 · aut Z9 · requisição OC-1', 'texto curto do pagamento');
eq([pagoComCartaoCorporativo({ forma: 'CARTAO', campos: { cartao_corporativo: true } }), pagoComCartaoCorporativo({ forma: 'CARTAO', campos: {} })], [true, false], 'pago com o cartão corporativo do cliente?');

console.log('--- Divisão centavo por centavo ---');
eq(dividirPelosPesos(100, [1, 1, 1]), [34, 33, 33], 'três partes iguais');
eq(dividirPelosPesos(1000, [0, 0]), [500, 500], 'pesos zerados: partes iguais');
eq(dividirPelosPesos(999, [2, 1]).reduce((a, b) => a + b, 0), 999, 'soma sempre bate');

console.log('--- Cartão corporativo do cliente ---');
const venda = lida({
  id: 'v1', numero: 'VND-1', data_venda: '2026-11-03', cliente: { id: 'c', nome: 'Empresa X', documento: '11222333000181' },
  corporativo: { centro_custo: 'CC-1', solicitante: 'Rita' },
  produtos: [
    { id: 'a', tipo: 'AEREO', descricao: 'Voo', fornecedor: { id: 'f1', nome: 'Cia' }, localizador: 'L1', detalhes: { cia: 'Voa' },
      passageiros: [{ id: 'p1', nome: 'Ana', documento: '123', tarifa_centavos: 30000 }] },
    { id: 'h', tipo: 'HOSPEDAGEM', descricao: 'Hotel', fornecedor: { id: 'f2', nome: 'Hotel' }, quantidade: 1, valor_unitario_centavos: 20000 },
  ],
  pagamentos: [
    { id: 'g1', forma: 'PAGO_DIRETO_FORNECEDOR', valor_centavos: 30000, fornecedor: { id: 'f1', nome: 'Cia' }, campos: { cartao_corporativo: true, final_cartao: '1111', autorizacao: 'A' } },
    { id: 'g2', forma: 'PIX', valor_centavos: 20000 },
  ],
});
const cc = linhasDoCartaoCorporativo([venda]);
eq(cc.map(l => [l.passageiro, l.fornecedor, l.valor_transacao, l.forma, l.cc_cliente, l.pendencias]),
  [['Ana', 'Cia', 30000, 'Direto no fornecedor', 'CC-1', 'Pronto']], 'pago direto no fornecedor: só os produtos dele');
eq([cc[0].pagante, cc[0].pagante_documento, cc[0].solicitante], ['Empresa X', '11222333000181', 'Rita'], 'pagante e quem pediu');
eq(linhasDoCartaoCorporativo([lida({ cliente: { nome: 'A' }, data_venda: '2026-11-01', produtos: [], pagamentos: [{ forma: 'PIX', valor_centavos: 100 }] })]).length, 0, 'sem cartão corporativo: nada');
eq(COLUNAS_CARTAO_CORPORATIVO.filter(c => c.sensivel).map(c => c.id), ['taxa_du', 'rav', 'fee', 'desconto'], 'o que é ganho da agência fica para quem pode ver');
eq(COLUNAS_CARTAO_CORPORATIVO.some(c => /numero.*cartao/i.test(c.id)), false, 'nenhuma coluna de número de cartão');

console.log('--- Empresa ---');
const outra = lida({ id: 'v2', numero: 'VND-2', data_venda: '2026-11-04', cliente: { nome: 'B' },
  produtos: [{ id: 'z', tipo: 'OUTROS', descricao: 'Passeio', quantidade: 1, valor_unitario_centavos: 5000 }], pagamentos: [{ forma: 'PIX', valor_centavos: 5000 }] }, 'emp_b');
const nomes = new Map([['principal', 'Viaje Bem'], ['emp_b', 'Loja B']]);
const ls = linhasPorProduto([venda, outra], undefined, nomes);
eq(ls.map(l => l.empresa), ['Viaje Bem', 'Viaje Bem', 'Loja B'], 'nome da empresa em cada linha');
eq(linhasPorEmpresa(ls).map(l => [l.grupo, l.vendas, l.faturamento]), [['Viaje Bem', 1, 50000], ['Loja B', 1, 5000]], 'vendas por empresa');
eq(filtrarLinhas(ls, { empresa: 'emp_b' }).map(l => l.descricao), ['Passeio'], 'filtro por empresa');
eq(temFiltroDeProduto({ empresa: 'emp_b' }), true, 'empresa conta como filtro');
eq(opcoesDosFiltros(ls).empresas, [{ valor: 'emp_b', rotulo: 'Loja B' }, { valor: 'principal', rotulo: 'Viaje Bem' }], 'opções de empresa');
eq(colunasPermitidas(COLUNAS_POR_PRODUTO, true, ['venda_numero', 'empresa']).map(c => c.id), ['venda_numero'], 'uma empresa só: sem a coluna');
eq(colunasPermitidas(COLUNAS_POR_PRODUTO, true, ['venda_numero', 'empresa'], true).map(c => c.id), ['venda_numero', 'empresa'], 'duas empresas: com a coluna');
eq([CAMPOS_DA_DINAMICA.includes('Empresa'), registrosDaDinamica(ls, 'faturamento')[2].campos['Empresa']], [true, 'Loja B'], 'empresa na tabela dinâmica');
eq(linhasPorProduto([outra])[0].empresa, 'emp_b', 'sem os nomes: o id');
eq(totaisDasLinhas(ls, COLUNAS_POR_PRODUTO.filter(c => ['tarifa_moeda', 'tarifa'].includes(c.id))), { tarifa: 55000 }, 'moeda de origem fora do total');

console.log('--- Fatura com a viagem corporativa ---');
const item = {
  conta_id: 'c1', venda_numero: 'VND-1', data_venda: '2026-11-03', descricao: 'Venda VND-1', valor_centavos: 1000,
  detalhes: { produtos: [], centro_custo: '', solicitante: 'Rita', corporativo: { cc_cliente: 'CC-1', aprovador: 'Paulo', projeto: 'Sul' } },
};
eq([valorDaColuna(item, 'cc_cliente'), valorDaColuna(item, 'aprovador'), valorDaColuna(item, 'matricula')], ['CC-1', 'Paulo', ''], 'colunas corporativas do item');
const base = { numero: 1, pessoa_nome: 'Empresa X', vencimento: '2026-12-10', emissao: null, notas: [], totais: { itens: 1000, creditos: 0, debitos: 0, bruto: 1000, total_retencoes: 0, liquido: 1000, retencoes: [] } };
const semCorp = linhasDaExportacao({ ...base, itens: [{ ...item, detalhes: { ...item.detalhes, corporativo: undefined } }] });
eq(semCorp[0], [...CABECALHO_DA_EXPORTACAO], 'sem dados corporativos: o arquivo de sempre');
const comCorp = linhasDaExportacao({ ...base, itens: [item] });
eq(comCorp[0].slice(12, 19), ['Solicitante', 'Centro de custo do cliente', 'Aprovador', 'Matrícula', 'Projeto', 'Motivo da viagem', 'Requisição'], 'com dados corporativos: as colunas depois de Solicitante');
eq(comCorp.every(l => l.length === comCorp[0].length), true, 'todas as linhas do mesmo tamanho');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
