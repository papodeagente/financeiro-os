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

import { percentual, round2, soma, somaPor } from './money';

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
  /** Não dá pra planejar sem ticket, margem e conversão: bloqueia números fantasiosos. */
  premissasIncompletas: boolean;
}

/**
 * O formulário entrega números, mas o cálculo também recebe dados persistidos
 * e payloads de API. Estas proteções locais impedem NaN, Infinity e valores
 * negativos de contaminarem todas as métricas caso um registro legado ou
 * malformado chegue até aqui. A validação da API continua sendo a responsável
 * por rejeitar o payload inválido e informar o erro ao usuário.
 */
function numeroNaoNegativo(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.max(0, valor) : 0;
}

function dinheiroNaoNegativo(valor: unknown): number {
  return round2(numeroNaoNegativo(valor));
}

function percentualSeguro(valor: unknown): number {
  return Math.min(100, numeroNaoNegativo(valor));
}

function inteiroPositivoOu(valor: unknown, fallback: number): number {
  const numero = numeroNaoNegativo(valor);
  return numero >= 1 ? Math.floor(numero) : fallback;
}

/**
 * Divide valores monetários em centavos inteiros. Mesmo depois de round2,
 * decimais como 0,09 não têm representação binária exata e Math.ceil(0.27 /
 * 0.09) pode devolver 4. Em centavos, a mesma conta é exatamente 27 / 9.
 */
function unidadesParaCobrir(total: number, valorUnitario: number): number {
  const totalCentavos = Math.round(round2(total) * 100);
  const unitarioCentavos = Math.round(round2(valorUnitario) * 100);
  return totalCentavos > 0 && unitarioCentavos > 0
    ? Math.ceil(totalCentavos / unitarioCentavos)
    : 0;
}

export function calcRelatorio(data: CustosData): Relatorio {
  const custosFixos = Array.isArray(data.custos_fixos) ? data.custos_fixos : [];
  const custosVariaveis = Array.isArray(data.custos_variaveis) ? data.custos_variaveis : [];
  const canaisMarketing = Array.isArray(data.marketing) ? data.marketing : [];

  const custoFixoTotal = somaPor(custosFixos, c => dinheiroNaoNegativo(c?.valor));
  const marketingTotal = somaPor(canaisMarketing, c => dinheiroNaoNegativo(c?.valor));

  // Custo mensal da operação = TUDO que sai antes de qualquer venda.
  // "Marketing fixo recorrente" (assinatura de ferramenta, retainer de
  // agência) e a verba de campanha por canal são gastos DIFERENTES e somam.
  // A versão anterior subtraía o fixo recorrente para "evitar dupla
  // contagem", e com isso ele sumia da conta quando o usuário não repetia o
  // mesmo valor no bloco de canais — as metas saíam subdimensionadas.
  const custoFixoMaisMarketing = soma([custoFixoTotal, marketingTotal]);

  const ticket = dinheiroNaoNegativo(data.ticket_medio);
  const margemComissao = percentualSeguro(data.margem_comissao);
  const taxaConversao = percentualSeguro(data.taxa_conversao);
  const comissaoPorVenda = percentual(ticket, margemComissao);
  const premissasIncompletas = ticket <= 0 || comissaoPorVenda <= 0 || taxaConversao <= 0;

  const custosVariaveisPorVenda: number[] = [];
  for (const cv of custosVariaveis) {
    const base = cv?.base === 'COMISSAO' ? comissaoPorVenda : ticket;
    custosVariaveisPorVenda.push(percentual(base, percentualSeguro(cv?.percentual)));
  }
  const custoVarPorVenda = soma(custosVariaveisPorVenda);

  // Margem de contribuição unitária: o que cada venda deixa para pagar os
  // custos fixos e virar lucro.
  const lucroPorVenda = round2(comissaoPorVenda - custoVarPorVenda);
  const viavel = lucroPorVenda > 0;

  const vendasBreakEven = viavel ? unidadesParaCobrir(custoFixoMaisMarketing, lucroPorVenda) : 0;
  const faturamentoBreakEven = round2(vendasBreakEven * ticket);
  const receitaBreakEven = round2(vendasBreakEven * comissaoPorVenda);

  const lucroDesejado = dinheiroNaoNegativo(data.lucro_desejado);
  const vendasMeta = viavel ? unidadesParaCobrir(soma([custoFixoMaisMarketing, lucroDesejado]), lucroPorVenda) : 0;
  const faturamentoMeta = round2(vendasMeta * ticket);
  // Receita da agência: no regime de intermediação o faturamento é volume
  // transacionado; o que entra no caixa é a comissão.
  const receitaMeta = round2(vendasMeta * comissaoPorVenda);
  const comissaoMeta = receitaMeta;
  // Vendas são inteiras, então o lucro real fica igual ou acima do desejado.
  const lucroProjetado = viavel ? round2((vendasMeta * lucroPorVenda) - custoFixoMaisMarketing) : 0;

  const taxaConv = taxaConversao / 100;
  const atendimentosMeta = taxaConv > 0 ? Math.ceil(vendasMeta / taxaConv) : 0;
  const diasUteis = inteiroPositivoOu(data.dias_uteis, 22);
  const vendedores = inteiroPositivoOu(data.vendedores_ativos, 1);
  const atendimentosPorDia = diasUteis > 0 ? Math.ceil(atendimentosMeta / diasUteis) : 0;
  const vendasPorVendedorMes = vendedores > 0 ? Math.ceil(vendasMeta / vendedores) : 0;
  const atendimentosPorVendedorDia = (diasUteis * vendedores) > 0 ? Math.ceil(atendimentosMeta / (diasUteis * vendedores)) : 0;

  // TETO de custo por lead: cada lead vale a margem da venda multiplicada
  // pela chance de fechar. Pagar acima disso destrói a margem.
  // (o cálculo anterior devolvia marketing ÷ leads, que é o custo que o
  // orçamento ATUAL implica — não um teto, e induzia a limitar a verba)
  const cplTeto = viavel ? percentual(lucroPorVenda, taxaConversao) : 0;
  const cplAtual = atendimentosMeta > 0 ? round2(marketingTotal / atendimentosMeta) : 0;
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

  const margemSobreReceitaPct = receitaMeta > 0 ? (lucroProjetado / receitaMeta) * 100 : 0;
  const margemSobreVolumePct = faturamentoMeta > 0 ? (lucroProjetado / faturamentoMeta) * 100 : 0;
  const margemContribuicaoPct = comissaoPorVenda > 0 ? (lucroPorVenda / comissaoPorVenda) * 100 : 0;

  const faturamentoDiario = diasUteis > 0 ? round2(faturamentoMeta / diasUteis) : 0;
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
