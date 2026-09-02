/**
 * Planejamento mensal da agência — matemática de ponto de equilíbrio, meta
 * de lucro e economia de aquisição.
 *
 * Modelo de negócio: INTERMEDIAÇÃO. O cliente paga o ticket cheio da viagem,
 * mas a receita da agência é só a COMISSÃO sobre esse valor — o resto é
 * repasse ao fornecedor. Confundir volume intermediado com receita própria
 * é o erro que mais distorce decisão aqui, então as métricas separam os dois
 * explicitamente.
 *
 * Lib pura (sem React/DOM) para poder ser testada: scripts/test-planejamento.ts
 */

export interface CustoFixo {
  categoria: string;
  valor: number;
  observacao: string;
}

export interface CustoVariavel {
  nome: string;
  percentual: number;
  base?: 'VENDA' | 'COMISSAO';
}

export interface CanalMarketing {
  canal: string;
  valor: number;
}

export interface CustosData {
  id: string;
  mes: string;
  custos_fixos: CustoFixo[];
  custos_variaveis: CustoVariavel[];
  marketing: CanalMarketing[];
  // Indicadores de planejamento
  ticket_medio: number;
  margem_comissao: number;
  taxa_conversao: number;
  lucro_desejado: number;
  dias_uteis: number;
  vendedores_ativos: number;
}

export const CATEGORIAS_FIXOS = ['Aluguel/Sede', 'Folha de pagamento', 'Ferramentas e software', 'Marketing fixo recorrente', 'Outros fixos'];
export const CANAIS_MARKETING = ['Instagram Ads', 'Google Ads', 'Influenciadores', 'Eventos', 'Afiliados', 'Outros'];

export interface Relatorio {
  custoFixoTotal: number;
  marketingTotal: number;
  custoFixoMaisMarketing: number;
  comissaoPorVenda: number;
  custoVarPorVenda: number;
  lucroPorVenda: number;
  vendasBreakEven: number;
  faturamentoBreakEven: number;
  receitaBreakEven: number;
  vendasMeta: number;
  faturamentoMeta: number;
  receitaMeta: number;
  comissaoMeta: number;
  atendimentosMeta: number;
  atendimentosPorDia: number;
  vendasPorVendedorMes: number;
  atendimentosPorVendedorDia: number;
  /** Teto do que se pode pagar por lead sem destruir a margem da venda. */
  cplTeto: number;
  /** O que o orçamento de marketing atual implica pagar por lead. */
  cplAtual: number;
  /** cplAtual em % do teto — quanto da capacidade de aquisição o plano usa. */
  usoDoTetoPct: number;
  /** Receita da agência ÷ investimento em marketing. */
  retornoMarketing: number;
  /** Margem sobre a RECEITA da agência (comissões), não sobre o volume. */
  margemSobreReceitaPct: number;
  /** Margem sobre o volume intermediado — útil só como referência. */
  margemSobreVolumePct: number;
  /** Margem de contribuição unitária em % da comissão. */
  margemContribuicaoPct: number;
  /** Lucro que as vendas arredondadas realmente produzem. */
  lucroProjetado: number;
  comissaoMediaPorVenda: number;
  faturamentoDiario: number;
  vendasPorDia: number;
  /** Não dá pra planejar sem ticket e margem: bloqueia números fantasiosos. */
  premissasIncompletas: boolean;
}

export function calcRelatorio(data: CustosData): Relatorio {
  const custoFixoTotal = data.custos_fixos.reduce((s, c) => s + (c.valor || 0), 0);
  const marketingTotal = data.marketing.reduce((s, c) => s + (c.valor || 0), 0);

  // Custo mensal da operação = TUDO que sai antes de qualquer venda.
  // "Marketing fixo recorrente" (assinatura de ferramenta, retainer de
  // agência) e a verba de campanha por canal são gastos DIFERENTES e somam.
  // A versão anterior subtraía o fixo recorrente para "evitar dupla
  // contagem", e com isso ele sumia da conta quando o usuário não repetia o
  // mesmo valor no bloco de canais — as metas saíam subdimensionadas.
  const custoFixoMaisMarketing = custoFixoTotal + marketingTotal;

  const ticket = data.ticket_medio || 0;
  const margemPct = (data.margem_comissao || 0) / 100;
  const comissaoPorVenda = ticket * margemPct;
  const premissasIncompletas = ticket <= 0 || comissaoPorVenda <= 0;

  let custoVarPorVenda = 0;
  for (const cv of data.custos_variaveis) {
    const base = cv.base === 'COMISSAO' ? comissaoPorVenda : ticket;
    custoVarPorVenda += base * (cv.percentual || 0) / 100;
  }

  // Margem de contribuição unitária: o que cada venda deixa para pagar os
  // custos fixos e virar lucro.
  const lucroPorVenda = comissaoPorVenda - custoVarPorVenda;
  const viavel = lucroPorVenda > 0;

  const vendasBreakEven = viavel ? Math.ceil(custoFixoMaisMarketing / lucroPorVenda) : 0;
  const faturamentoBreakEven = vendasBreakEven * ticket;
  const receitaBreakEven = vendasBreakEven * comissaoPorVenda;

  const vendasMeta = viavel ? Math.ceil((custoFixoMaisMarketing + (data.lucro_desejado || 0)) / lucroPorVenda) : 0;
  const faturamentoMeta = vendasMeta * ticket;
  // Receita da agência: no regime de intermediação o faturamento é volume
  // transacionado; o que entra no caixa é a comissão.
  const receitaMeta = vendasMeta * comissaoPorVenda;
  const comissaoMeta = receitaMeta;
  // Vendas são inteiras, então o lucro real fica igual ou acima do desejado.
  const lucroProjetado = viavel ? (vendasMeta * lucroPorVenda) - custoFixoMaisMarketing : 0;

  const taxaConv = (data.taxa_conversao || 0) / 100;
  const atendimentosMeta = taxaConv > 0 ? Math.ceil(vendasMeta / taxaConv) : 0;
  const diasUteis = data.dias_uteis || 22;
  const vendedores = data.vendedores_ativos || 1;
  const atendimentosPorDia = diasUteis > 0 ? Math.ceil(atendimentosMeta / diasUteis) : 0;
  const vendasPorVendedorMes = vendedores > 0 ? Math.ceil(vendasMeta / vendedores) : 0;
  const atendimentosPorVendedorDia = (diasUteis * vendedores) > 0 ? Math.ceil(atendimentosMeta / (diasUteis * vendedores)) : 0;

  // TETO de custo por lead: cada lead vale a margem da venda multiplicada
  // pela chance de fechar. Pagar acima disso destrói a margem.
  // (o cálculo anterior devolvia marketing ÷ leads, que é o custo que o
  // orçamento ATUAL implica — não um teto, e induzia a limitar a verba)
  const cplTeto = viavel ? lucroPorVenda * taxaConv : 0;
  const cplAtual = atendimentosMeta > 0 ? marketingTotal / atendimentosMeta : 0;
  // Nota sobre o modelo: cplAtual = M·lpv·conv / (fixos + M + lucro), então
  // cplAtual/cplTeto = M / (fixos + M + lucro) < 1 sempre — a verba se paga
  // dentro da própria meta. Ou seja, o custo por lead NUNCA cruza o teto por
  // aumento de verba; ele apenas se aproxima. O que importa é o quanto da
  // capacidade de aquisição o plano já consome: acima de ~85% o resultado
  // fica dependente de mídia e frágil a qualquer queda de conversão.
  const usoDoTetoPct = cplTeto > 0 ? (cplAtual / cplTeto) * 100 : 0;

  // Retorno do marketing sobre a RECEITA da agência. Usar o faturamento
  // (volume intermediado) inflava o número em ~4x num negócio de comissão.
  const retornoMarketing = marketingTotal > 0 ? receitaMeta / marketingTotal : 0;

  const margemSobreReceitaPct = receitaMeta > 0 ? ((data.lucro_desejado || 0) / receitaMeta) * 100 : 0;
  const margemSobreVolumePct = faturamentoMeta > 0 ? ((data.lucro_desejado || 0) / faturamentoMeta) * 100 : 0;
  const margemContribuicaoPct = comissaoPorVenda > 0 ? (lucroPorVenda / comissaoPorVenda) * 100 : 0;

  const faturamentoDiario = diasUteis > 0 ? faturamentoMeta / diasUteis : 0;
  const vendasPorDia = diasUteis > 0 ? vendasMeta / diasUteis : 0;

  return {
    custoFixoTotal, marketingTotal, custoFixoMaisMarketing,
    comissaoPorVenda, custoVarPorVenda, lucroPorVenda,
    vendasBreakEven, faturamentoBreakEven, receitaBreakEven,
    vendasMeta, faturamentoMeta, receitaMeta, comissaoMeta, lucroProjetado,
    atendimentosMeta, atendimentosPorDia, vendasPorVendedorMes, atendimentosPorVendedorDia,
    cplTeto, cplAtual, usoDoTetoPct, retornoMarketing,
    margemSobreReceitaPct, margemSobreVolumePct, margemContribuicaoPct,
    comissaoMediaPorVenda: comissaoPorVenda, faturamentoDiario, vendasPorDia,
    premissasIncompletas,
  };
}

