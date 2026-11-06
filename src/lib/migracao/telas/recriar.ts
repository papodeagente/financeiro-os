/**
 * E7 · Mudança — recriar o que o sistema anterior não exporta em detalhe
 * (06/11/2026). Puro, sem React e sem rede.
 *
 * A pessoa responde perguntas simples, com exemplos do mercado, e daqui sai
 * o objeto que as telas da E5 já gravam:
 *  - plano de comissão por função (`PUT /api/comissoes-por-funcao/planos`,
 *    formato de `normalizarPlano` em src/lib/comissao-funcoes.ts);
 *  - regra de faturamento (`POST /api/regras-faturamento`, formato de
 *    `normalizarRegra` em src/lib/fatura-regras.ts), com a prévia das
 *    próximas faturas pela rota da própria regra.
 * Junto vai o resumo em frases, para a pessoa conferir antes de gravar.
 */
import { FUNCAO_TODAS, PRODUTO_TODOS } from '../../comissao-funcoes';
import {
  INFO_DO_PERIODO, ROTULO_AJUSTE_DE_DIA, ROTULO_BASE_DE_DATA, DIAS_DA_SEMANA,
  type AjusteDeDiaNaoUtil, type BaseDeData, type PeriodoDaRegra, type RegraDeFaturamento,
} from '../../fatura-regras';
import { ROTULO_TIPO_PRODUTO, type TipoProduto } from '../../venda-modelo';

// ─── Plano de comissão ─────────────────────────────────────────────────────

export type BaseDoPlano = 'RECEITA' | 'VALOR_VENDA' | 'TARIFA';

export const PERGUNTA_DA_BASE: Record<BaseDoPlano, { rotulo: string; exemplo: string }> = {
  RECEITA: { rotulo: 'Sobre a receita da agência', exemplo: 'O que fica para a agência: comissão e over do fornecedor, Taxa DU, RAV, Fee e Markup, menos o desconto. Ex.: 10% de R$ 1.500 de receita = R$ 150.' },
  VALOR_VENDA: { rotulo: 'Sobre o valor da venda', exemplo: 'O que o cliente paga, inteiro. Ex.: 1% de uma venda de R$ 10.000 = R$ 100.' },
  TARIFA: { rotulo: 'Sobre a tarifa', exemplo: 'Só a tarifa dos produtos, sem taxas. Ex.: 2% de R$ 8.000 de tarifa = R$ 160.' },
};

export interface RespostasDoPlano {
  nome: string;
  /** Para qual função (id) ou todas ('*'). */
  funcao_id: string;
  sobre: BaseDoPlano;
  /** % padrão (0 a 100). */
  percentual: number;
  /** Produtos que pagam diferente. */
  por_produto: Array<{ produto: TipoProduto; percentual: number }>;
  /** Faixas por meta: a partir de X% da meta paga Y% (vazio = sem meta). */
  faixas: Array<{ a_partir: number; percentual: number }>;
  modo: 'DEGRAU' | 'PROGRESSIVA';
  /** % diferente quando a venda tem intermediário (null = o mesmo). */
  com_intermediario: number | null;
}

export const PLANO_EM_BRANCO: RespostasDoPlano = {
  nome: '', funcao_id: FUNCAO_TODAS, sobre: 'RECEITA', percentual: 10, por_produto: [], faixas: [], modo: 'DEGRAU', com_intermediario: null,
};

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;

/** O plano no formato que a rota grava, os erros (frases) e o resumo em frases. */
export function planoDasRespostas(r: RespostasDoPlano): { plano: Record<string, unknown>; erros: string[]; frases: string[] } {
  const erros: string[] = [];
  if (!r.nome.trim()) erros.push('Dê um nome ao plano (ex.: "Plano dos consultores").');
  if (!ok(r.percentual)) erros.push('O percentual padrão precisa estar entre 0% e 100%.');
  for (const p of r.por_produto) if (!ok(p.percentual)) erros.push(`O percentual de ${ROTULO_TIPO_PRODUTO[p.produto]} precisa estar entre 0% e 100%.`);
  if (new Set(r.por_produto.map(p => p.produto)).size !== r.por_produto.length) erros.push('Cada produto aparece uma vez só.');
  if (r.com_intermediario !== null && !ok(r.com_intermediario)) erros.push('O percentual com intermediário precisa estar entre 0% e 100%.');
  const faixas = [...r.faixas].sort((a, b) => a.a_partir - b.a_partir);
  for (const f of faixas) {
    if (!(f.a_partir > 0)) erros.push('Cada faixa começa acima de 0% da meta (ex.: a partir de 100%).');
    if (!ok(f.percentual)) erros.push(`A faixa a partir de ${pct(f.a_partir)} da meta precisa de um percentual entre 0% e 100%.`);
  }
  if (new Set(faixas.map(f => f.a_partir)).size !== faixas.length) erros.push('Duas faixas começam no mesmo ponto da meta.');

  const calculo = (percentual: number) => ({ tipo: 'PERCENTUAL', percentual, valor_centavos: 0, sobre: [r.sobre] });
  const fator = (base: number, faixaPct: number) => (r.percentual > 0 ? faixaPct / r.percentual : 0) * base;
  // Faixa 0 = o percentual padrão; cada faixa de meta escala os produtos na mesma proporção.
  const degraus = [{ a_partir: 0, percentual: r.percentual }, ...faixas];
  const plano = {
    id: '', nome: r.nome.trim(), modo_faixa: r.modo, ativo: true, versao: 1,
    faixas: degraus.map(f => ({
      percentual_meta: f.a_partir,
      regras: [
        {
          id: `todos-${f.a_partir}`, produto: PRODUTO_TODOS, funcao_id: r.funcao_id || FUNCAO_TODAS, calculo: calculo(f.percentual),
          com_intermediario: r.com_intermediario === null ? null : calculo(f.a_partir === 0 ? r.com_intermediario : arred(fator(r.com_intermediario, f.percentual))),
        },
        ...r.por_produto.map(p => ({
          id: `${p.produto}-${f.a_partir}`, produto: p.produto, funcao_id: r.funcao_id || FUNCAO_TODAS,
          calculo: calculo(f.a_partir === 0 ? p.percentual : arred(fator(p.percentual, f.percentual))),
          com_intermediario: r.com_intermediario === null ? null : calculo(f.a_partir === 0 ? r.com_intermediario : arred(fator(r.com_intermediario, f.percentual))),
        })),
      ],
    })),
  };

  const frases: string[] = [];
  const base = PERGUNTA_DA_BASE[r.sobre].rotulo.toLowerCase();
  frases.push(`Paga ${pct(r.percentual)} ${base}.`);
  for (const p of r.por_produto) frases.push(`${ROTULO_TIPO_PRODUTO[p.produto]} paga ${pct(p.percentual)}.`);
  if (r.com_intermediario !== null) frases.push(`Venda com intermediário paga ${pct(r.com_intermediario)}.`);
  if (faixas.length) {
    frases.push(r.modo === 'DEGRAU'
      ? 'Por meta, em degrau: ao bater a faixa, o percentual dela vale para todas as vendas do mês.'
      : 'Por meta, progressiva: cada parte das vendas paga o percentual da faixa em que caiu.');
    for (const f of faixas) frases.push(`A partir de ${pct(f.a_partir)} da meta: ${pct(f.percentual)}.`);
  } else {
    frases.push('Sem meta: o percentual é o mesmo em qualquer mês.');
  }
  return { plano, erros: [...new Set(erros)], frases };
}

function arred(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** "Numa venda de R$ 10.000 com receita de R$ 1.500, o vendedor ganha R$ 150." */
export function exemploDoPlano(r: RespostasDoPlano): string {
  const exemplo = { RECEITA: 150_000, VALOR_VENDA: 1_000_000, TARIFA: 800_000 }[r.sobre];
  const ganho = Math.round(exemplo * r.percentual / 100);
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const base = r.sobre === 'RECEITA' ? `com ${brl(exemplo)} de receita` : r.sobre === 'TARIFA' ? `com ${brl(exemplo)} de tarifa` : `de ${brl(exemplo)}`;
  return `Numa venda ${r.sobre === 'VALOR_VENDA' ? base : `de R$ 10.000,00 ${base}`}, a comissão é ${brl(ganho)}.`;
}

// ─── Regra de faturamento ──────────────────────────────────────────────────

/** Os períodos que a pergunta oferece, com um exemplo do mercado. */
export const PERIODOS_DA_PERGUNTA: Array<{ periodo: PeriodoDaRegra; exemplo: string }> = [
  { periodo: 'SEMANAL_IATA', exemplo: 'Como o aéreo: de segunda a domingo, uma fatura por semana.' },
  { periodo: 'SEMANAL', exemplo: 'Toda semana, começando no dia que o cliente pede.' },
  { periodo: 'DECENDIAL', exemplo: 'Três por mês: até o dia 10, até o 20 e até o fim do mês.' },
  { periodo: 'QUINZENAL', exemplo: 'Duas por mês: até o dia 15 e até o fim do mês.' },
  { periodo: 'MENSAL', exemplo: 'Uma por mês, com tudo o que foi vendido no mês.' },
  { periodo: 'DIARIO', exemplo: 'Uma por dia, para cliente com muito volume.' },
  { periodo: 'AVULSO', exemplo: 'Cada venda vira a sua fatura.' },
];

export interface RespostasDaRegra {
  pessoa: { id: string; nome: string } | null;
  periodo: PeriodoDaRegra;
  /** 0 = domingo … 6 = sábado (só no semanal). */
  inicio_semana: number;
  faturar_por: BaseDeData;
  /** Dias depois do fim do período para vencer. */
  prazo_dias: number;
  dia_nao_util: AjusteDeDiaNaoUtil;
}

export const REGRA_EM_BRANCO: RespostasDaRegra = {
  pessoa: null, periodo: 'MENSAL', inicio_semana: 1, faturar_por: 'VENDA', prazo_dias: 10, dia_nao_util: 'PROXIMO',
};

/** A regra no formato que a rota grava, os erros e o resumo em frases. */
export function regraDasRespostas(r: RespostasDaRegra): { regra: Partial<RegraDeFaturamento>; erros: string[]; frases: string[] } {
  const erros: string[] = [];
  if (!r.pessoa) erros.push('Escolha o cliente da regra.');
  const prazo = Math.floor(Number(r.prazo_dias));
  if (!Number.isFinite(prazo) || prazo < 0 || prazo > 120) erros.push('O prazo de vencimento vai de 0 a 120 dias.');
  const regra: Partial<RegraDeFaturamento> = {
    pessoa_tipo: 'CLIENTE', pessoa_id: r.pessoa?.id ?? '', pessoa_nome: r.pessoa?.nome ?? '', produto_tipo: '', fornecedor_id: '', fornecedor_nome: '',
    periodo: r.periodo, inicio_semana: r.inicio_semana, faturar_por: r.faturar_por, sentido: 'DEPOIS', prazo_dias: Number.isFinite(prazo) ? prazo : 0,
    dia_nao_util: r.dia_nao_util, considerar_feriados: true, faixas: [], descricao: '', solicitante: '', centro_custo: '', modelo: 'PADRAO', ativa: true,
  };
  const frases = [
    `${INFO_DO_PERIODO[r.periodo].rotulo}: ${INFO_DO_PERIODO[r.periodo].ajuda}`,
    ...(r.periodo === 'SEMANAL' ? [`A semana começa no(a) ${DIAS_DA_SEMANA[r.inicio_semana] ?? 'segunda-feira'}.`] : []),
    `Cada item entra pela ${ROTULO_BASE_DE_DATA[r.faturar_por]}.`,
    r.periodo === 'AVULSO' ? `Vence ${prazo} dia(s) depois da ${ROTULO_BASE_DE_DATA[r.faturar_por]}.` : `Vence ${prazo} dia(s) depois do fim do período.`,
    `Vencimento em sábado, domingo ou feriado: ${ROTULO_AJUSTE_DE_DIA[r.dia_nao_util].toLowerCase()}.`,
  ];
  return { regra, erros, frases };
}
