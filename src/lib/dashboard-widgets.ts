/**
 * Catálogo dos widgets do Dashboard financeiro (12/11/2026).
 *
 * Pedido do Bruno: "quero criar uma área de widget onde eu possa escolher
 * quais dados quero que apareçam no dashboard. Crie dashboard de todos os
 * itens que já existem." Cada item que o /api/dashboard já calcula vira um
 * widget; a pessoa liga, desliga e ordena, e a escolha fica no cadastro dela
 * (usuarios.data.dashboard_widgets).
 *
 * Sem React e sem Next: a tela, a rota e o teste importam daqui.
 */

export const IDS_DOS_WIDGETS = [
  'atencao',
  'saude',
  'serie',
  'projecao',
  'aging',
  'cascata',
  'origem',
  'despesa',
  'fornecedores',
  'margem',
  'clientes',
  'agenda',
  'descasamento',
  'vendas',
  'qualidade',
] as const;

export type IdDoWidget = (typeof IDS_DOS_WIDGETS)[number];

export type GrupoDoWidget = 'Caixa' | 'Resultado' | 'Contas' | 'Pessoas e fornecedores' | 'Controle';

export interface WidgetDoCatalogo {
  id: IdDoWidget;
  titulo: string;
  /** Uma linha, para a janela de personalizar. */
  descricao: string;
  grupo: GrupoDoWidget;
  /** Colunas que ocupa na grade larga (1 ou 2 de 3). */
  largura: 1 | 2;
}

export const CATALOGO: Record<IdDoWidget, WidgetDoCatalogo> = {
  atencao: { id: 'atencao', titulo: 'Precisa da sua atenção', descricao: 'Os avisos do período, do mais urgente ao menos, com o número que sustenta cada um.', grupo: 'Controle', largura: 1 },
  saude: { id: 'saude', titulo: 'Saúde financeira', descricao: 'Cada fator medido por conta própria; o pior deles dá o veredito.', grupo: 'Controle', largura: 1 },
  serie: { id: 'serie', titulo: 'Entrou, saiu e sobrou', descricao: 'Mês a mês, em regime de caixa: pela data em que o dinheiro se moveu.', grupo: 'Caixa', largura: 2 },
  projecao: { id: 'projecao', titulo: 'Projeção de caixa', descricao: 'O saldo de hoje somado ao que já está lançado para 7, 15, 30, 60 e 90 dias.', grupo: 'Caixa', largura: 1 },
  aging: { id: 'aging', titulo: 'Quando o dinheiro entra e sai', descricao: 'A receber e a pagar em aberto por prazo, na mesma escala.', grupo: 'Contas', largura: 1 },
  cascata: { id: 'cascata', titulo: 'Do que o cliente pagou até o que sobrou', descricao: 'Volume vendido, repasse ao fornecedor, receita da agência e resultado.', grupo: 'Resultado', largura: 1 },
  origem: { id: 'origem', titulo: 'De onde veio o dinheiro', descricao: 'Entradas por origem. A comissão de operadora é receita da agência por inteiro.', grupo: 'Caixa', largura: 1 },
  despesa: { id: 'despesa', titulo: 'Para onde o dinheiro foi', descricao: 'Despesa própria por categoria; o repasse ao fornecedor fica fora.', grupo: 'Caixa', largura: 1 },
  fornecedores: { id: 'fornecedores', titulo: 'Para quem a agência mais pagou', descricao: 'Fornecedores pelo valor pago, repasse incluído.', grupo: 'Pessoas e fornecedores', largura: 1 },
  margem: { id: 'margem', titulo: 'Quem dá margem', descricao: 'Margem por fornecedor nos itens das vendas: volume não é o mesmo que resultado.', grupo: 'Pessoas e fornecedores', largura: 1 },
  clientes: { id: 'clientes', titulo: 'De quem a agência recebeu', descricao: 'Clientes pelo valor recebido. A comissão de operadora fica fora.', grupo: 'Pessoas e fornecedores', largura: 1 },
  agenda: { id: 'agenda', titulo: 'Próximos movimentos', descricao: 'Os próximos 30 dias, incluindo o que já venceu e não se moveu.', grupo: 'Contas', largura: 1 },
  descasamento: { id: 'descasamento', titulo: 'Fornecedor vence antes do cliente', descricao: 'Vendas em que o dinheiro sai antes de entrar e a diferença sai do caixa.', grupo: 'Contas', largura: 1 },
  vendas: { id: 'vendas', titulo: 'Vendas do período', descricao: 'Volume, custo, receita da agência, comissão de operadora e ticket médio.', grupo: 'Resultado', largura: 1 },
  qualidade: { id: 'qualidade', titulo: 'Cadastro incompleto', descricao: 'O que falta lançar para os números ficarem certos: custo, fornecedor, vencimento e categoria.', grupo: 'Controle', largura: 1 },
};

/** O que aparece para quem nunca escolheu. Os demais ficam a um clique. */
export const WIDGETS_PADRAO: IdDoWidget[] = [
  'atencao', 'saude', 'serie', 'projecao', 'aging', 'cascata', 'origem', 'agenda', 'vendas',
];

const CONJUNTO = new Set<string>(IDS_DOS_WIDGETS);

/**
 * A escolha gravada (ou enviada) vira uma lista válida: só ids do catálogo,
 * sem repetição, na ordem dada. Qualquer coisa que não seja lista → null
 * (= nunca escolheu, usa o padrão). Lista vazia é escolha válida.
 */
export function normalizarSelecao(valor: unknown): IdDoWidget[] | null {
  if (!Array.isArray(valor)) return null;
  const vistos = new Set<string>();
  const saida: IdDoWidget[] = [];
  for (const item of valor) {
    if (typeof item !== 'string' || !CONJUNTO.has(item) || vistos.has(item)) continue;
    vistos.add(item);
    saida.push(item as IdDoWidget);
  }
  return saida;
}

/** Os ids escondidos, na ordem do catálogo. */
export function widgetsEscondidos(selecao: IdDoWidget[]): IdDoWidget[] {
  const ligados = new Set(selecao);
  return IDS_DOS_WIDGETS.filter(id => !ligados.has(id));
}
