/**
 * A ficha da venda (E5, parte A) desenha sem quebrar, com os textos do
 * contrato: as seis abas, as formas de pagamento por grupo, a posição com o
 * alerta de pagar o fornecedor antes do cliente e a receita aberta.
 * Renderiza as abas no servidor (react-dom/server) com dados montados pelos
 * módulos puros de produção. Nenhum banco nem navegador.
 *
 * Uso: node --no-warnings scripts/test-ficha-da-venda.mjs
 */
import { register } from 'node:module';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

globalThis.__POOL_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
// Fora do bundler, os subcaminhos do pacote next (next/link...) precisam do .js.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, n) {
    if (/^next\\/(link|navigation|image)$/.test(s)) return n(s + '.js', c);
    return n(s, c);
  }`));

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { normalizarVenda, totaisDaVenda, totaisDoProduto } = await import('../src/lib/venda-modelo.ts');
const { contasDaVenda } = await import('../src/lib/venda-contas.ts');
const { posicaoDaVenda } = await import('../src/lib/venda-posicao.ts');
const { CONFIG_RECEITA_PADRAO } = await import('../src/lib/venda-receita.ts');
const { AbaProdutos } = await import('../src/components/vendas/ficha/AbaProdutos.tsx');
const { AbaPagamentos } = await import('../src/components/vendas/ficha/AbaPagamentos.tsx');
const { AbaCliente, AbaFornecedor, AbaComissoes, AbaPosicao } = await import('../src/components/vendas/ficha/AbasDoFinanceiro.tsx');

const venda = normalizarVenda({
  id: 'v1', numero: 'VND-0100', data_venda: '2026-11-01', cliente: { id: 'c1', nome: 'Ana Lima' },
  produtos: [
    { id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Hotel Mar' }, passageiros: [{ id: 'x', nome: 'Ana', tarifa_centavos: 100000 }], componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }, { tipo: 'FEE', valor_centavos: 5000 }] },
    { id: 'p2', tipo: 'AEREO', descricao: 'GRU-LIS', quem_cobra: 'FORNECEDOR', fornecedor: { id: 'f2', nome: 'Cia' }, quantidade: 1, valor_unitario_centavos: 200000, componentes: [{ tipo: 'TAXA_DU', valor_centavos: 4000 }] },
  ],
  pagamentos: [{ id: 'g1', forma: 'BOLETO', valor_centavos: 105000, parcelas: 2 }],
}).venda;
const contas = contasDaVenda({ versao: 2, venda, hoje: '2026-11-05' });
const cr = contas.contas_receber.map(c => ({ ...c }));
const cp = contas.contas_pagar.map(c => ({ ...c, status: 'PAGO', valor_pago: c.valor_final }));
const posicao = posicaoDaVenda({ venda, contas_receber: cr, contas_pagar: cp, hoje: '2026-11-05' });
const porProduto = Object.fromEntries(venda.produtos.map(p => [p.id, totaisDoProduto(p)]));
const ficha = {
  venda, versao_modelo: 2, situacao: 'ABERTA', fechada_em: null, fechada_por: null,
  totais: totaisDaVenda(venda), totais_por_produto: porProduto, receita: posicao.receita, posicao,
  contas_receber: cr, contas_pagar: cp, pendencias: [], comissoes: [],
  eventos: [{ id: 'e1', tipo: 'criada', motivo: '', usuario_id: 'u', usuario_nome: 'Bia', detalhe: { contas: { criadas: 3 } }, criado_em: '2026-11-05T13:00:00Z' }],
  config_receita: CONFIG_RECEITA_PADRAO,
  permissoes: { editar: true, fechar: true, reabrir: true, ver_financeiro: true, ver_receita: true },
};
const h = React.createElement;
const html = el => renderToStaticMarkup(el);

const produtos = html(h(AbaProdutos, { produtos: venda.produtos, editavel: true, verReceita: true, fornecedores: [], onSalvarProduto() {}, onRemoverProduto() {} }));
eq(['Hotel Mar', 'GRU-LIS', 'Adicionar produto', 'Cliente paga', 'Receita'].every(t => produtos.includes(t)), true, 'Produtos: lista com o que o cliente paga e a receita');
const semReceita = html(h(AbaProdutos, { produtos: venda.produtos, editavel: false, verReceita: false, fornecedores: [], onSalvarProduto() {}, onRemoverProduto() {} }));
eq([semReceita.includes('>Receita<'), semReceita.includes('Adicionar produto')], [false, false], 'sem direito: nem receita nem edição');
const pagamentos = html(h(AbaPagamentos, { venda, editavel: true, faltando: 0, contasBancarias: [], clientes: [], onSalvarPagamento() {}, onRemoverPagamento() {} }));
eq(['Boleto', 'Adicionar pagamento', 'Os pagamentos cobrem a venda inteira.'].every(t => pagamentos.includes(t)), true, 'Pagamentos: formas e cobertura');
const cliente = html(h(AbaCliente, { ficha }));
eq(['Parcela 1/2', 'A receber do cliente', 'Contas a receber'].every(t => cliente.includes(t)), true, 'Cliente: contas a receber da venda');
const fornecedor = html(h(AbaFornecedor, { ficha }));
eq(['Hotel Mar', 'Comissão a receber', 'Contas a pagar da venda'].every(t => fornecedor.includes(t)), true, 'Fornecedor: acerto por fornecedor');
const comissoes = html(h(AbaComissoes, { ficha }));
eq(['Comissão a receber do fornecedor', 'Comissão do vendedor', 'Repasse ao intermediário'].every(t => comissoes.includes(t)), true, 'Comissões: fornecedor, repasse e vendedor');
const pos = html(h(AbaPosicao, { ficha }));
eq(['saíram do caixa antes de o cliente pagar', 'Receita da agência', 'Taxa DU', 'Histórico da venda', 'Venda lançada por Bia'].every(t => pos.includes(t)), true, 'Posição: alerta, receita aberta e histórico');
const bloqueada = html(h(AbaPosicao, { ficha: { ...ficha, posicao: null, permissoes: { ...ficha.permissoes, ver_financeiro: false } } }));
eq(bloqueada.includes('Seu acesso não inclui'), true, 'sem direito: a posição explica, não quebra');

// Vocabulário: nada do concorrente nem os termos proibidos.
const tudo = [produtos, pagamentos, cliente, fornecedor, comissoes, pos].join(' ');
const proibidos = ['Gerar Lançamento', 'Taxa de Serviço Oculta', 'Taxa de Serviço Destacada', 'Saldo Excluído', 'Lei Kandir', 'Fornecimento', 'Representação'];
eq(proibidos.filter(t => tudo.includes(t)), [], 'nenhum termo proibido na tela');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
