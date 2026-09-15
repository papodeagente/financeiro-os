/**
 * O que os números estão dizendo, em frases de dono.
 *
 * POR QUE ISTO É UM MÓDULO PURO E TESTADO. "Insight automático" é o lugar mais
 * fácil de um sistema inventar: basta uma frase bem escrita sobre um cálculo
 * que ninguém conferiu, e o dono toma decisão em cima dela. Aqui cada frase
 * nasce de um campo do payload que já foi verificado contra o banco, e cada
 * regra tem teste com os dois lados — quando dispara e quando NÃO dispara.
 *
 * TRÊS DISCIPLINAS:
 *
 *  1. Nenhuma frase sem número. Toda observação carrega a evidência que
 *     permite conferir, porque um insight que não dá para checar é opinião.
 *  2. Variação sobre base zero NÃO é "+100%": é ausência de comparação, e a
 *     frase simplesmente não nasce. Crescer de zero para qualquer coisa é
 *     infinito por cento, e dizer isso não informa nada.
 *  3. O silêncio é resposta. Quando não há o que dizer, a lista volta vazia e
 *     a tela diz que está tudo tranquilo — em vez de encher espaço com
 *     observações vazias que treinam a pessoa a ignorar o bloco.
 */

import type { DashboardFinanceiro } from './dashboard-financeiro';
import { divSegura, round2 } from './money';

export type TomDoInsight = 'positivo' | 'atencao' | 'critico' | 'neutro';

export interface Insight {
  id: string;
  tom: TomDoInsight;
  /** Uma frase. Linguagem de dono de agência, não de contador. */
  texto: string;
  /** O número que sustenta a frase, para dar para conferir. */
  evidencia?: string;
  acao?: { rotulo: string; href: string };
  /** Ordena a lista: quanto maior, mais cedo aparece. */
  peso: number;
}

export type FaixaDeSaude = 'bom' | 'atencao' | 'risco' | 'sem-base';

export interface FatorDeSaude {
  id: string;
  nome: string;
  valor: string;
  faixa: FaixaDeSaude;
  leitura: string;
  /** Onde a marca cai numa régua de 0 a 1, ou null quando não há base. */
  posicao: number | null;
}

/** Acima disto a dependência de um fornecedor vira risco de operação. */
export const CONCENTRACAO_DE_RISCO_PCT = 40;
/** Abaixo disto a agência não tem fôlego para um mês ruim. */
export const FOLEGO_MINIMO_MESES = 1;
/** A partir daqui a operação se sustenta com tranquilidade. */
export const FOLEGO_CONFORTAVEL_MESES = 3;
/** Margem sobre o volume vendido que a operação costuma pedir. */
export const MARGEM_SAUDAVEL_PCT = 15;
/** Acima disto a carteira em atraso deixa de ser exceção. */
export const INADIMPLENCIA_GRAVE_PCT = 15;

/**
 * A ordem de gravidade, escrita UMA vez.
 *
 * 'sem-base' é PIOR que 'bom' de propósito: uma agência em que quase nada pôde
 * ser medido não está saudável, está inconclusiva — e anunciar "Saudável" ali
 * é a afirmação mais perigosa que este painel poderia fazer, porque é a
 * tranquilizadora.
 *
 * O painel de saúde e o chip da manchete consomem esta mesma tabela: eram duas
 * regras diferentes, e a tela chegava a dizer "Saudável" no alto enquanto o
 * painel logo abaixo dizia "Sem base suficiente".
 */
export const ORDEM_DE_GRAVIDADE: Record<FaixaDeSaude, number> = {
  bom: 0,
  'sem-base': 1,
  atencao: 2,
  risco: 3,
};

/**
 * Onde a marca cai na régua de três zonas (risco | atenção | bom).
 *
 * POR QUE NÃO É UMA ESCALA LINEAR SIMPLES. A régua é dividida em terços, e a
 * palavra ao lado nomeia a zona. Uma escala linear sobre o valor bruto põe a
 * marca na zona ERRADA: com margem saudável a partir de 15% e a régua saturando
 * em 30%, uma margem de 15% cai em 0,5 — no meio da zona "atenção" — enquanto o
 * texto ao lado diz "bom". O olho acredita na posição, não na palavra.
 *
 * Então a posição é calculada DENTRO da zona: o valor é normalizado entre as
 * fronteiras daquela faixa e mapeado para o terço correspondente.
 */
export function posicaoEmZonas(
  valor: number,
  limiteRisco: number,
  limiteAtencao: number,
  teto: number,
  sentido: 'maior-melhor' | 'menor-melhor' = 'maior-melhor',
): number {
  const dentro = (v: number, de: number, ate: number) =>
    ate <= de ? 0 : Math.min(1, Math.max(0, (v - de) / (ate - de)));

  if (sentido === 'menor-melhor') {
    // Espelha o eixo: 0 é o melhor e `teto` é o pior.
    if (valor > limiteAtencao) return dentro(Math.min(valor, teto), teto, limiteAtencao) / 3;
    if (valor > limiteRisco) return 1 / 3 + dentro(valor, limiteAtencao, limiteRisco) / 3;
    return 2 / 3 + dentro(valor, limiteRisco, 0) / 3;
  }
  if (valor < limiteRisco) return dentro(valor, 0, limiteRisco) / 3;
  if (valor < limiteAtencao) return 1 / 3 + dentro(valor, limiteRisco, limiteAtencao) / 3;
  return 2 / 3 + dentro(valor, limiteAtencao, teto) / 3;
}

const pct = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
const dataBR = (iso: string) => (iso && iso.length >= 10 ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : iso);

/**
 * Os fatores de saúde financeira.
 *
 * NÃO existe score único honesto neste sistema: dois insumos de um score de
 * verdade (tributos provisionados e despesa recorrente confiável) não existem
 * no banco. Inventar pesos para produzir "82 de 100" seria um número de
 * aparência científica sem lastro, e o dono decidiria em cima dele.
 *
 * Então cada fator aparece nomeado, com seu próprio valor e sua própria faixa,
 * e o veredito geral é uma regra visível: a faixa do PIOR fator. Auditável.
 */
export function calcularFatoresDeSaude(d: DashboardFinanceiro): FatorDeSaude[] {
  const fatores: FatorDeSaude[] = [];

  // ── Fôlego de caixa ──────────────────────────────────────────────────
  const meses = d.cobertura.meses;
  fatores.push(
    meses === null
      ? {
          id: 'folego',
          nome: 'Fôlego de caixa',
          valor: 'sem base',
          faixa: 'sem-base',
          leitura: 'Nenhuma despesa própria foi paga no período, então não dá para estimar por quanto tempo o caixa cobre a operação.',
          posicao: null,
        }
      : {
          id: 'folego',
          nome: 'Fôlego de caixa',
          valor: `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(meses)} ${meses === 1 ? 'mês' : 'meses'}`,
          faixa: meses < FOLEGO_MINIMO_MESES ? 'risco' : meses < FOLEGO_CONFORTAVEL_MESES ? 'atencao' : 'bom',
          leitura:
            meses < FOLEGO_MINIMO_MESES
              ? 'O caixa de hoje não cobre um mês de despesa própria no ritmo do período.'
              : meses < FOLEGO_CONFORTAVEL_MESES
                ? 'O caixa cobre a operação por pouco tempo: um mês fraco aperta.'
                : 'O caixa cobre a operação com folga no ritmo atual de despesa.',
          // A régua satura em 6 meses: acima disso a diferença não muda decisão.
          posicao: posicaoEmZonas(meses, FOLEGO_MINIMO_MESES, FOLEGO_CONFORTAVEL_MESES, 6),
        },
  );

  // ── Caixa projetado ──────────────────────────────────────────────────
  const negativa = d.projecao.find(p => p.saldoProjetado < 0) ?? null;
  const fim = d.projecao[d.projecao.length - 1] ?? null;
  fatores.push({
    id: 'projecao',
    nome: 'Caixa projetado',
    valor: negativa ? `negativo em ${dias(negativa.dias)}` : fim ? 'positivo em 90 dias' : 'sem base',
    faixa: negativa ? 'risco' : fim ? 'bom' : 'sem-base',
    leitura: negativa
      ? `Com o que já está lançado, o saldo fica negativo até ${dataBR(negativa.data)}.`
      : fim
        ? 'Com o que já está lançado, o saldo se mantém positivo nas próximas janelas.'
        : 'Não há lançamento futuro suficiente para projetar.',
    posicao: negativa ? 0.1 : fim ? 0.9 : null,
  });

  // ── Inadimplência ────────────────────────────────────────────────────
  const carteira = d.posicao.receber.emAberto;
  const atraso = d.posicao.receber.vencido;
  const taxa = carteira > 0 ? round2(divSegura(atraso, carteira) * 100) : null;
  fatores.push(
    taxa === null
      ? {
          id: 'inadimplencia',
          nome: 'Inadimplência',
          valor: 'sem base',
          faixa: 'sem-base',
          leitura: 'Não há nada a receber em aberto, então não há carteira para medir atraso.',
          posicao: null,
        }
      : {
          id: 'inadimplencia',
          nome: 'Inadimplência',
          valor: pct(taxa),
          faixa: taxa > INADIMPLENCIA_GRAVE_PCT ? 'risco' : taxa > 0 ? 'atencao' : 'bom',
          leitura:
            taxa > INADIMPLENCIA_GRAVE_PCT
              ? `Mais de um sétimo do que a agência tem a receber está vencido, em ${d.posicao.receber.contasVencidas} ${d.posicao.receber.contasVencidas === 1 ? 'parcela' : 'parcelas'}.`
              : taxa > 0
                ? `${d.posicao.receber.contasVencidas} ${d.posicao.receber.contasVencidas === 1 ? 'parcela venceu' : 'parcelas venceram'} e ainda não ${d.posicao.receber.contasVencidas === 1 ? 'entrou' : 'entraram'}.`
                : 'Nada vencido na carteira de recebimento.',
          // Régua invertida: quanto MENOS atraso, mais à direita. O limiar de
          // "atenção" é qualquer atraso, então a fronteira de baixo é zero.
          posicao: posicaoEmZonas(taxa, 0.0001, INADIMPLENCIA_GRAVE_PCT, 30, 'menor-melhor'),
        },
  );

  // ── Margem das vendas ────────────────────────────────────────────────
  const margem = d.vendas.margemPct;
  fatores.push(
    margem === null
      ? {
          id: 'margem',
          nome: 'Margem das vendas',
          valor: 'sem base',
          faixa: 'sem-base',
          leitura: 'Nenhuma venda registrada no período, então não há margem para medir.',
          posicao: null,
        }
      : {
          id: 'margem',
          nome: 'Margem das vendas',
          valor: pct(margem),
          faixa: margem < MARGEM_SAUDAVEL_PCT * (2 / 3) ? 'risco' : margem < MARGEM_SAUDAVEL_PCT ? 'atencao' : 'bom',
          leitura: `De cada R$ 100 vendidos, R$ ${Math.round(margem)} ficam com a agência. O resto é repasse a fornecedor.`,
          // Satura em 30%: acima disso já é excelente em intermediação.
          posicao: posicaoEmZonas(margem, MARGEM_SAUDAVEL_PCT * (2 / 3), MARGEM_SAUDAVEL_PCT, 30),
        },
  );

  // ── Compromissos vencidos ────────────────────────────────────────────
  const vencidoAPagar = d.posicao.pagar.vencido;
  fatores.push({
    id: 'compromissos',
    nome: 'Compromissos em dia',
    valor: vencidoAPagar > 0 ? `${d.posicao.pagar.contasVencidas} em atraso` : 'em dia',
    faixa: vencidoAPagar > d.caixa.saldo ? 'risco' : vencidoAPagar > 0 ? 'atencao' : 'bom',
    leitura:
      vencidoAPagar > d.caixa.saldo
        ? 'O que está vencido a pagar é maior que o caixa disponível hoje.'
        : vencidoAPagar > 0
          ? 'Há contas vencidas, e o caixa de hoje cobre.'
          : 'Nenhuma conta a pagar vencida.',
    posicao: vencidoAPagar > 0 ? (vencidoAPagar > d.caixa.saldo ? 0.1 : 0.5) : 1,
  });

  return fatores;
}

/**
 * O veredito geral: a faixa do PIOR fator, pela ordem única de gravidade.
 *
 * Regra visível, não peso escondido — e é a MESMA que o painel de saúde
 * desenha, para a tela nunca dizer "Saudável" no alto e "Sem base suficiente"
 * três centímetros abaixo.
 */
export function classificarSaude(fatores: FatorDeSaude[]): FaixaDeSaude {
  if (fatores.length === 0) return 'sem-base';
  return fatores.reduce<FaixaDeSaude>(
    (pior, f) => (ORDEM_DE_GRAVIDADE[f.faixa] > ORDEM_DE_GRAVIDADE[pior] ? f.faixa : pior),
    'bom',
  );
}

export interface PassoDoResultado {
  id: string;
  rotulo: string;
  valor: number;
  papel: 'inicio' | 'soma' | 'subtrai' | 'total';
  detalhe: string;
}

/**
 * A cascata do resultado: do que o cliente pagou até o que sobrou.
 *
 * POR QUE A SUBTRAÇÃO NÃO É A SOMA DOS CUSTOS. `receitaAgencia` é a margem
 * CLAMPADA POR VENDA: uma viagem vendida abaixo do custo conta zero, não
 * negativo, porque empresa não tem receita negativa. Logo
 * `volume − Σcusto ≠ Σmargem` sempre que houver uma venda no prejuízo, e uma
 * cascata montada com a soma dos custos desenharia um total que não bate com
 * os próprios degraus — o defeito mais corrosivo possível num gráfico que
 * existe justamente para mostrar uma conta.
 *
 * Subtrair `volume − receitaAgencia` fecha por construção, em qualquer cenário.
 * O custo registrado nas vendas continua visível, no detalhe do passo.
 */
export function montarCascataDoResultado(
  d: DashboardFinanceiro,
  formatar: (v: number) => string,
): PassoDoResultado[] {
  const naoFicou = round2(d.vendas.volume - d.vendas.receitaAgencia);
  return [
    {
      id: 'volume',
      rotulo: 'Volume vendido',
      valor: d.vendas.volume,
      papel: 'inicio',
      detalhe: `${d.vendas.quantidade} ${d.vendas.quantidade === 1 ? 'venda' : 'vendas'} no período`,
    },
    {
      id: 'repasse',
      rotulo: 'Não ficou com a agência',
      valor: naoFicou,
      papel: 'subtrai',
      detalhe:
        `Repasse à operadora, ao hotel e à cia aérea` +
        (d.vendas.custo > 0 ? ` · custo registrado nas vendas: ${formatar(d.vendas.custo)}` : ''),
    },
    {
      id: 'receita',
      rotulo: 'Receita da agência',
      valor: d.vendas.receitaAgencia,
      papel: 'total',
      detalhe: 'A margem: o que de fato fica com a empresa',
    },
    {
      id: 'despesa',
      rotulo: 'Despesa própria',
      valor: d.caixa.despesasProprias.atual,
      papel: 'subtrai',
      detalhe: 'Paga no período, já sem o repasse ao fornecedor',
    },
    {
      id: 'resultado',
      rotulo: 'Resultado das vendas',
      valor: round2(d.vendas.receitaAgencia - d.caixa.despesasProprias.atual),
      papel: 'total',
      detalhe:
        'Margem das vendas do período menos a despesa própria paga. É competência de venda, não caixa: ' +
        'pode diferir do que sobrou na conta bancária.',
    },
  ];
}

/**
 * As observações.
 *
 * Cada regra abaixo tem um `if` que a impede de nascer sem base. É essa guarda,
 * e não a frase, que faz este módulo ser confiável.
 */
export function gerarInsights(
  d: DashboardFinanceiro,
  formatar: (v: number) => string,
): Insight[] {
  const lista: Insight[] = [];
  const add = (i: Insight) => lista.push(i);

  // ── O caixa vai ficar negativo ───────────────────────────────────────
  const negativa = d.projecao.find(p => p.saldoProjetado < 0);
  if (negativa) {
    add({
      id: 'caixa-negativo',
      tom: 'critico',
      peso: 100,
      texto: `Com o que já está lançado, o caixa fica negativo dentro de ${dias(negativa.dias)}.`,
      evidencia: `${formatar(negativa.saldoProjetado)} projetados para ${dataBR(negativa.data)}`,
      acao: { rotulo: 'Ver contas a pagar', href: '/financeiro-ag/pagar' },
    });
  }

  // ── Vencidos ─────────────────────────────────────────────────────────
  if (d.posicao.pagar.vencido > 0) {
    add({
      id: 'pagar-vencido',
      tom: 'critico',
      peso: 90,
      texto: `${d.posicao.pagar.contasVencidas} ${d.posicao.pagar.contasVencidas === 1 ? 'conta a pagar está vencida' : 'contas a pagar estão vencidas'}.`,
      evidencia: formatar(d.posicao.pagar.vencido),
      acao: { rotulo: 'Pagar', href: '/financeiro-ag/pagar' },
    });
  }
  if (d.posicao.receber.vencido > 0) {
    const taxa = d.posicao.receber.emAberto > 0
      ? round2(divSegura(d.posicao.receber.vencido, d.posicao.receber.emAberto) * 100)
      : null;
    add({
      id: 'receber-vencido',
      tom: taxa !== null && taxa > INADIMPLENCIA_GRAVE_PCT ? 'critico' : 'atencao',
      peso: 85,
      texto:
        taxa !== null
          ? `${pct(taxa)} do que a agência tem a receber está vencido.`
          : `${d.posicao.receber.contasVencidas} ${d.posicao.receber.contasVencidas === 1 ? 'parcela venceu' : 'parcelas venceram'} e não entrou.`,
      evidencia: `${formatar(d.posicao.receber.vencido)} em ${d.posicao.receber.contasVencidas} ${d.posicao.receber.contasVencidas === 1 ? 'parcela' : 'parcelas'}`,
      acao: { rotulo: 'Cobrar', href: '/financeiro-ag/receber' },
    });
  }

  // ── Fôlego ───────────────────────────────────────────────────────────
  if (d.cobertura.meses !== null && d.cobertura.meses < FOLEGO_MINIMO_MESES) {
    add({
      id: 'folego-curto',
      tom: 'critico',
      peso: 80,
      texto: 'O caixa de hoje não cobre um mês de despesa própria.',
      evidencia: `${formatar(d.caixa.saldo)} em caixa contra ${formatar(d.cobertura.despesaMensal)} por mês`,
    });
  } else if (d.cobertura.meses !== null && d.cobertura.meses >= FOLEGO_CONFORTAVEL_MESES) {
    add({
      id: 'folego-bom',
      tom: 'positivo',
      peso: 20,
      texto: `O caixa cobre ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(d.cobertura.meses)} meses de despesa própria.`,
      evidencia: `${formatar(d.caixa.saldo)} em caixa`,
    });
  }

  // ── O aperto que só existe em agência de viagens ─────────────────────
  if (d.descasamento.length > 0) {
    const total = round2(d.descasamento.reduce((s, x) => s + x.exposicao, 0));
    const pior = d.descasamento[0];
    add({
      id: 'descasamento',
      tom: 'atencao',
      peso: 70,
      texto: `Em ${d.descasamento.length} ${d.descasamento.length === 1 ? 'venda' : 'vendas'}, o fornecedor vence antes de o cliente pagar: o dinheiro sai do bolso da agência no meio.`,
      evidencia: `${formatar(total)} adiantados, o pior caso por ${dias(pior.diasDeGap)}`,
    });
  }

  // ── Concentração de fornecedor ───────────────────────────────────────
  // O denominador é TUDO que saiu no período, não a soma do top 12 da lista.
  // Dividir pelo top 12 infla o percentual: com uma cauda longa de pequenos
  // fornecedores, o maior aparece com 45% quando ele é 18% do que a agência
  // pagou — e o alarme dispara sobre um risco que não existe.
  const maior = d.fornecedores[0];
  const totalPago = d.caixa.saidas.atual;
  // 'pendente' é o balde de quem não foi identificado: ali a conversa é sobre
  // cadastro incompleto, não sobre dependência de um parceiro.
  if (maior && maior.id !== 'pendente' && totalPago > 0) {
    const share = round2(divSegura(maior.valor, totalPago) * 100);
    if (share >= CONCENTRACAO_DE_RISCO_PCT) {
      add({
        id: 'concentracao',
        tom: 'atencao',
        peso: 55,
        texto: `${maior.nome} concentra ${pct(share)} de tudo que a agência pagou no período.`,
        evidencia: `${formatar(maior.valor)} de ${formatar(totalPago)}`,
      });
    }
  }

  // ── Despesa própria subindo ──────────────────────────────────────────
  const varDespesa = d.caixa.despesasProprias.variacao;
  if (varDespesa !== null && varDespesa >= 15) {
    add({
      id: 'despesa-subiu',
      tom: 'atencao',
      peso: 60,
      texto: `A despesa própria da agência subiu ${pct(varDespesa)} em relação ao período anterior.`,
      evidencia: `${formatar(d.caixa.despesasProprias.anterior)} para ${formatar(d.caixa.despesasProprias.atual)}`,
    });
  }

  // ── Volume sobe e receita não acompanha ──────────────────────────────
  if (d.vendas.margemPct !== null && d.vendas.margemPct < MARGEM_SAUDAVEL_PCT && d.vendas.quantidade > 0) {
    add({
      id: 'margem-apertada',
      tom: 'atencao',
      peso: 65,
      texto: `A margem das vendas do período está em ${pct(d.vendas.margemPct)} — abaixo dos ${MARGEM_SAUDAVEL_PCT}% que a operação costuma pedir.`,
      evidencia: `${formatar(d.vendas.receitaAgencia)} de receita sobre ${formatar(d.vendas.volume)} vendidos`,
    });
  }

  // ── Receita que não existe no caixa ──────────────────────────────────
  if (d.vendas.semLastro.quantidade > 0) {
    add({
      id: 'sem-lastro',
      tom: 'atencao',
      peso: 50,
      texto: `${d.vendas.semLastro.quantidade} ${d.vendas.semLastro.quantidade === 1 ? 'venda confirmada não tem' : 'vendas confirmadas não têm'} nenhuma conta lançada no financeiro.`,
      evidencia: `${formatar(d.vendas.semLastro.volume)} vendidos que não aparecem no caixa`,
      acao: { rotulo: 'Ver vendas', href: '/vendas' },
    });
  }

  // ── O gráfico de categoria está cego ─────────────────────────────────
  const totalDespesa = d.caixa.despesasProprias.atual;
  if (totalDespesa > 0 && d.atencao.naoCategorizadas.valor > 0) {
    const share = round2(divSegura(d.atencao.naoCategorizadas.valor, totalDespesa) * 100);
    if (share >= 30) {
      add({
        id: 'sem-categoria',
        tom: 'atencao',
        peso: 40,
        texto: `${pct(share)} da despesa do período não tem categoria, então a divisão por categoria não conta a história inteira.`,
        evidencia: `${formatar(d.atencao.naoCategorizadas.valor)} em ${d.atencao.naoCategorizadas.contas} ${d.atencao.naoCategorizadas.contas === 1 ? 'conta' : 'contas'}`,
        acao: { rotulo: 'Ver contas a pagar', href: '/financeiro-ag/pagar' },
      });
    }
  }

  // ── Dinheiro sem data ────────────────────────────────────────────────
  if (d.atencao.semVencimento > 0) {
    add({
      id: 'sem-vencimento',
      tom: 'atencao',
      peso: 35,
      texto: `${d.atencao.semVencimento} ${d.atencao.semVencimento === 1 ? 'lançamento não tem' : 'lançamentos não têm'} data de vencimento, então não ${d.atencao.semVencimento === 1 ? 'entra' : 'entram'} em nenhuma projeção.`,
    });
  }

  // ── Comissão de operadora, a receita pura ────────────────────────────
  const comissao = d.receitaPorOrigem.find(o => o.id === 'COMISSAO_FORNECEDOR');
  const totalEntradas = d.caixa.entradas.atual;
  if (comissao && totalEntradas > 0) {
    const share = round2(divSegura(comissao.valor, totalEntradas) * 100);
    if (share >= 10) {
      add({
        id: 'comissao-operadora',
        tom: 'positivo',
        peso: 25,
        texto: `${pct(share)} do que entrou no período é comissão de operadora, que é receita da agência por inteiro.`,
        evidencia: formatar(comissao.valor),
      });
    }
  }

  // ── O que a semana reserva ───────────────────────────────────────────
  const seteDias = d.projecao.find(p => p.dias === 7);
  if (seteDias && seteDias.saidas > 0) {
    add({
      id: 'semana',
      tom: 'neutro',
      peso: 30,
      texto: `Nos próximos 7 dias estão previstos ${formatar(seteDias.saidas)} em pagamentos e ${formatar(seteDias.entradas)} em recebimentos.`,
    });
  }

  // ── Crescimento de entradas ──────────────────────────────────────────
  // Só quando HÁ base de comparação. Crescer de zero é infinito por cento, e
  // dizer isso não informa nada.
  const varEntradas = d.caixa.entradas.variacao;
  if (varEntradas !== null && Math.abs(varEntradas) >= 10) {
    add({
      id: 'entradas-variaram',
      tom: varEntradas > 0 ? 'positivo' : 'atencao',
      peso: 45,
      texto:
        varEntradas > 0
          ? `As entradas cresceram ${pct(varEntradas)} em relação ao período anterior.`
          : `As entradas caíram ${pct(Math.abs(varEntradas))} em relação ao período anterior.`,
      evidencia: `${formatar(d.caixa.entradas.anterior)} para ${formatar(d.caixa.entradas.atual)}`,
    });
  }

  return lista.sort((a, b) => b.peso - a.peso);
}
