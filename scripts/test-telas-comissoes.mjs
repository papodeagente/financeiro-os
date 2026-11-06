/**
 * Telas das comissões por função e dos relatórios de vendas (E5, parte F)
 * desenham sem quebrar, com os textos do contrato: o painel do vendedor com
 * "faltam R$ X para a próxima faixa" e "por que recebi isto?", a escolha da
 * base, e as páginas novas no primeiro desenho (carregando). Renderiza no
 * servidor (react-dom/server). Nenhum banco nem navegador.
 *
 * Uso: node --no-warnings scripts/test-telas-comissoes.mjs
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
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, n) {
    if (/^next\\/(link|navigation|image)$/.test(s)) return n(s + '.js', c);
    return n(s, c);
  }`));

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { normalizarVenda } = await import('../src/lib/venda-modelo.ts');
const { calcularComissoesPorFuncao, normalizarPlano, funcoesDoSistema, frasesDaExplicacao, CONFIG_COMISSAO_PADRAO } = await import('../src/lib/comissao-funcoes.ts');
const { PainelDoVendedorView, fraseDaMeta } = await import('../src/components/comissoes/PainelDoVendedor.tsx');
const { EscolhaDaBase } = await import('../src/components/comissoes/EscolhaDaBase.tsx');
const h = React.createElement;
const html = el => renderToStaticMarkup(el);
const semNbsp = s => s.replace(/ /g, ' ');

const venda = normalizarVenda({
  id: 'v1', numero: 'VND-0001', data_venda: '2026-11-03', cliente: { id: 'c1', nome: 'Ana Lima' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', quantidade: 1, valor_unitario_centavos: 100000, componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }] }],
}).venda;
const plano = normalizarPlano({ id: 'pl', nome: 'Plano Equipe', faixas: [
  { percentual_meta: 0, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } }] },
  { percentual_meta: 100, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 15, sobre: ['RECEITA'] } }] },
] });
const pessoa = { id: 'fn-vendedor:u-bia', funcao_id: 'fn-vendedor', pessoa_id: 'u-bia', pessoa_nome: 'Bia', plano_id: 'pl', data_inicio: '', nao_comissionado: false };
const r = calcularComissoesPorFuncao({
  vendas: [{ venda, cancelada: false, situacao: 'ABERTA' }], funcoes: funcoesDoSistema(), pessoas: [pessoa], planos: [plano],
  metas: [{ pessoa_funcao_id: pessoa.id, mes: '2026-11', centavos: 20000 }], config: { ...CONFIG_COMISSAO_PADRAO, regra: 'FUNCOES' }, ate: '2026-11-30',
});
const painel = {
  pessoa_id: 'u-bia', mes: '2026-11', rotulo_mes: '11/2026', regra: 'FUNCOES', resumos: r.resumos,
  itens: r.itens.map(i => ({ chave: i.chave, venda_id: i.venda_id, venda_numero: i.venda_numero, data_venda: i.data_venda, descricao: i.descricao, cliente_nome: i.cliente_nome,
    funcao_nome: i.funcao_nome, valor_centavos: i.valor_centavos, retido_centavos: 0, liberado_centavos: i.liberado_centavos, fechado_centavos: 0, pago_centavos: 0,
    situacao: 'LIBERADA', por_que: frasesDaExplicacao(i.explicacao, i.valor_centavos) })),
  totais: { previsto: 1000, liberado: 1000, fechado: 0, pago: 0 },
};
const tela = semNbsp(html(h(PainelDoVendedorView, { painel })));
eq(['Sua comissão em 11/2026', 'R$ 10,00', 'Faltam R$ 100,00 para a faixa de 100% da meta.', 'Por que recebi isto?', 'Liberada', 'VND-0001 · Hotel Mar', '/vendas/v1/ficha'].filter(t => !tela.includes(t)), [], 'painel do vendedor: total, quanto falta, extrato e "por que recebi isto?"');
eq(fraseDaMeta({ ...r.resumos[0], erros: ['Meta de 11/2026 não definida.'] }), 'Meta de 11/2026 não definida.', 'erro da pessoa aparece no cartão');
eq(fraseDaMeta({ ...r.resumos[0], proxima_faixa: null, falta_para_proxima_centavos: null }), 'Você está na faixa mais alta do plano.', 'no topo');

const base = html(h(EscolhaDaBase, { rotulo: 'Sobre', valor: ['COMISSAO', 'RAV'], onChange() {} }));
eq(['Escolher os componentes', 'Comissão', 'RAV', '− Desconto'].every(t => base.includes(t)), true, 'escolha da base: componentes com o sinal');
eq(html(h(EscolhaDaBase, { rotulo: 'Sobre', valor: ['RECEITA'], onChange() {} })).includes('O ganho da agência'), true, 'atalho explica o que soma');

// As páginas novas desenham o primeiro estado sem quebrar.
const paginas = {
  funcoes: '../src/app/equipe/funcoes/page.tsx',
  planos: '../src/app/equipe/planos-por-funcao/page.tsx',
  fechar: '../src/app/equipe/fechar-comissoes/page.tsx',
  pagar: '../src/app/equipe/pagar-comissoes/page.tsx',
  minhas: '../src/app/equipe/minhas-comissoes/page.tsx',
  config: '../src/app/config/comissoes/page.tsx',
  metas: '../src/app/equipe/metas-por-funcao/page.tsx',
};
const textos = [];
for (const [nome, caminho] of Object.entries(paginas)) {
  let ok = false;
  try {
    const Pagina = (await import(caminho)).default;
    const saida = html(h(Pagina));
    textos.push(saida);
    ok = saida.length > 100;
  } catch (e) {
    console.log(`   ${nome}: ${e instanceof Error ? e.message : e}`);
  }
  eq(ok, true, `página ${nome} desenha`);
}
// Comissão manual na ficha da venda (E7): o porquê de não poder lançar, numa frase.
const { impedimentoDaManual, situacaoDaManual, ComissoesManuais } = await import('../src/components/vendas/ficha/AbasDoFinanceiro.tsx');
const pessoas = [{ id: 'fn-vendedor:u-bia', nome: 'Bia', funcao_nome: 'Vendedor' }];
eq([
  impedimentoDaManual({ regra: 'ATUAL', cancelada: false, situacao_venda: 'FECHADA', pessoas })?.startsWith('A comissão manual entra no Fechar comissões da regra por função'),
  impedimentoDaManual({ regra: 'FUNCOES', cancelada: false, situacao_venda: 'ABERTA', pessoas }),
  impedimentoDaManual({ regra: 'FUNCOES', cancelada: false, situacao_venda: 'FECHADA', pessoas: [] }),
  impedimentoDaManual({ regra: 'FUNCOES', cancelada: false, situacao_venda: 'FECHADA', pessoas }),
], [true, 'Feche a venda para lançar: assim a base da comissão não muda depois.', 'Ninguém está numa função de comissão ainda (Equipe › Funções).', null], 'comissão manual: regra de hoje, venda aberta, ninguém na função, liberado');
eq([situacaoDaManual({ fechado_centavos: 0, pago_centavos: 0 }).rotulo, situacaoDaManual({ fechado_centavos: 100, pago_centavos: 0 }).rotulo, situacaoDaManual({ fechado_centavos: 100, pago_centavos: 100 }).rotulo], ['A fechar', 'Fechada', 'Paga'], 'situação da comissão manual');
eq(html(h(ComissoesManuais, { vendaId: 'v1' })).includes('animate-pulse'), true, 'bloco da comissão manual desenha carregando');

const { RelatoriosDeVendas } = await import('../src/components/relatorios/RelatoriosDeVendas.tsx');
const rel = html(h(RelatoriosDeVendas, { abrirVenda() {} }));
// E7: a exportação virou o botão único (Excel, PDF e Imprimir num menu) e entrou o envio agendado.
eq(['Relatórios de vendas', 'Por produto', 'Por vendedor', 'Por unidade', 'Por fornecedor', 'Por forma de pagamento', 'Pagamentos', 'Ranking de clientes', 'Tabela dinâmica', 'Exportar', 'Agendar envio', 'Fornecedor', 'Situação do produto', 'Período pela'].filter(t => !rel.includes(t)), [], 'relatórios: os oito relatórios, os filtros, a exportação e o envio agendado');
const { TelaDeEnvios } = await import('../src/components/relatorios/TelaDeEnvios.tsx');
const envios = html(h(TelaDeEnvios));
eq(['Envios agendados', 'Relatórios de vendas'].filter(t => !envios.includes(t)), [], 'envios agendados desenha');
const { FormularioDeEnvio } = await import('../src/components/relatorios/FormularioDeEnvio.tsx');
eq(typeof FormularioDeEnvio, 'function', 'formulário do envio agendado carrega');
const tudo = [tela, base, rel, envios, ...textos].join(' ');
const proibidos = ['Gerar Lançamento', 'Taxa de Serviço Oculta', 'Taxa de Serviço Destacada', 'Saldo Excluído', 'Lei Kandir', 'Fornecimento', 'Representação', 'Gerar Fatura', 'Grupos de Usuário', 'Acesso Total'];
eq(proibidos.filter(t => tudo.includes(t)), [], 'nenhum termo proibido nas telas');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
