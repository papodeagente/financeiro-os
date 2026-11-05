/**
 * Os números comerciais do mês que vêm do CRM (Bruno, 20/10/2026): "não
 * consegue captar quantos leads foram atendidos, sendo que essa informação
 * está no CRM; ele deve puxar tudo e mostrar quantos atendimentos de fato
 * foram feitos, quantas vendas fechadas."
 *
 * O CRM responde com as contas da tela Análises dele (funis de vendas), para
 * o Financeiro nunca mostrar outro número do mesmo mês:
 *
 *   negociacoes     "Total de Negociações": abertas criadas no mês mais as
 *                   ganhas e perdidas fechadas no mês. É o "leads atendidos".
 *   ganhas          "Ganhas": as vendas fechadas no mês.
 *   taxa_decididas  a "Taxa de conversão" das Análises: ganhas sobre ganhas +
 *                   perdidas. O plano usa vendas sobre leads; a tela diz qual
 *                   é qual.
 *
 * Aqui só a leitura da resposta (pura, testada). A chamada assinada mora em
 * crm-integration.ts (consultarMetricasComerciais).
 */

export const TIPO_METRICAS_COMERCIAIS = 'METRICAS_COMERCIAIS';

export interface MetricasDoCrm {
  negociacoes: number;
  ganhas: number;
  perdidas: number;
  abertas: number;
  /** Valor das ganhas no mês, em reais. */
  valor_ganho: number;
  /** Ganhas sobre ganhas + perdidas, em %. */
  taxa_decididas: number;
  /** Um número por dia do mês (posição 0 = dia 1). */
  por_dia: { negociacoes: number[]; ganhas: number[] };
}

/** O que a consulta ao CRM deu: os números, ou por que não vieram. */
export type ComercialDoCrm =
  | { situacao: 'ok'; metricas: MetricasDoCrm; consultado_em: string }
  | { situacao: 'sem_integracao' | 'crm_sem_suporte' | 'indisponivel'; detalhe: string };

function diasNoMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

const contagem = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * Lê o `metricas` da resposta do CRM. Devolve null quando a resposta não é a
 * do mês pedido ou não tem os totais: número que não se sabe ler não vira
 * zero, vira "não veio".
 */
export function lerMetricasDoCrm(bruto: unknown, mes: string): MetricasDoCrm | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const m = bruto as Record<string, unknown>;
  if (m.mes !== mes) return null;
  const negociacoes = contagem(m.negociacoes);
  const ganhas = contagem(m.ganhas);
  if (negociacoes === null || ganhas === null) return null;
  const n = diasNoMes(mes);
  const por_dia = { negociacoes: Array.from({ length: n }, () => 0), ganhas: Array.from({ length: n }, () => 0) };
  if (Array.isArray(m.por_dia)) {
    for (const d of m.por_dia as Array<Record<string, unknown>>) {
      const dia = typeof d?.dia === 'string' ? d.dia : '';
      if (dia.slice(0, 7) !== mes) continue;
      const i = Number(dia.slice(8, 10)) - 1;
      if (!(i >= 0 && i < n)) continue;
      por_dia.negociacoes[i] += contagem(d.negociacoes) ?? 0;
      por_dia.ganhas[i] += contagem(d.ganhas) ?? 0;
    }
  }
  const valor = Number(m.valor_ganho);
  const taxa = Number(m.taxa_decididas);
  return {
    negociacoes,
    ganhas,
    perdidas: contagem(m.perdidas) ?? 0,
    abertas: contagem(m.abertas) ?? 0,
    valor_ganho: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0,
    taxa_decididas: Number.isFinite(taxa) && taxa >= 0 ? taxa : 0,
    por_dia,
  };
}
