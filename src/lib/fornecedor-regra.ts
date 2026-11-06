/**
 * REGRA DE FATURAMENTO DO FORNECEDOR (E5, parte C, 05/11/2026).
 *
 * O cadastro do fornecedor sempre teve "dia de corte" e "dia de vencimento"
 * (fornecedores_crm.data.regras_faturamento), mas nada usava. Aqui eles passam
 * a valer: os itens a pagar ao fornecedor entram na fatura do período que
 * termina no corte, e a fatura vence no dia de vencimento seguinte, ajustado
 * para dia útil (fim de semana e feriado, src/lib/feriados.ts).
 *
 *   período  = (corte anterior, corte]        ex.: corte 25 → 26/10 a 25/11
 *   vencimento = o primeiro "dia de vencimento" DEPOIS do corte
 *                ex.: corte 25, vencimento 10 → 10 do mês seguinte
 *                     corte 10, vencimento 25 → 25 do mesmo mês
 *   dia que não existe no mês (31 em novembro) vira o último dia do mês.
 *
 * A data que decide o período de cada item é a "data base": a da venda
 * (padrão), a do início ou a do fim da viagem.
 *
 * Arquivo puro: datas civis 'AAAA-MM-DD', sem relógio.
 */
import { addDias, dataSegura, num } from './money';
import {
  CALENDARIO_NACIONAL, diaUtilAnterior, motivoDeNaoSerUtil, proximoDiaUtil, type Calendario,
} from './feriados';

export type AjusteDoVencimento = 'proximo' | 'anterior' | 'nenhum';
export type DataBaseDaFatura = 'venda' | 'inicio' | 'fim';

export interface RegraDeFaturamento {
  /** 1 a 31 (31 = último dia do mês). */
  dia_corte: number;
  /** 1 a 31 (31 = último dia do mês). */
  dia_vencimento: number;
  /** Vencimento que cai em fim de semana ou feriado vai para o dia útil seguinte (padrão) ou anterior. */
  ajuste_vencimento: AjusteDoVencimento;
  /** Qual data do item decide o período. */
  data_base: DataBaseDaFatura;
  /** No dia seguinte ao corte, a fatura é montada sozinha (o sino avisa sempre). */
  gerar_sozinha: boolean;
  /** O prazo de sempre (dias depois da venda), usado na conta da venda antes de faturar. */
  prazo_pagamento_dias: number;
}

/** O que o cadastro novo do fornecedor já traz (crm-types.ts, createFornecedorCRM). */
export const REGRA_PADRAO: RegraDeFaturamento = {
  dia_corte: 25, dia_vencimento: 10, ajuste_vencimento: 'proximo', data_base: 'venda', gerar_sozinha: false, prazo_pagamento_dias: 30,
};

export const ROTULO_AJUSTE: Record<AjusteDoVencimento, string> = {
  proximo: 'Adiar para o próximo dia útil',
  anterior: 'Antecipar para o dia útil anterior',
  nenhum: 'Manter o dia, mesmo sem expediente',
};

export const ROTULO_DATA_BASE: Record<DataBaseDaFatura, string> = {
  venda: 'Data da venda',
  inicio: 'Início da viagem',
  fim: 'Fim da viagem',
};

function dia(v: unknown, padrao: number): number {
  const n = Math.floor(num(v));
  return n >= 1 && n <= 31 ? n : padrao;
}

/** Lê a regra do cadastro (campos que faltam ficam no padrão). */
export function normalizarRegra(v: unknown): RegraDeFaturamento {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const ajuste = String(o.ajuste_vencimento ?? '');
  const base = String(o.data_base ?? '');
  const prazo = o.prazo_pagamento_dias === undefined || o.prazo_pagamento_dias === null || o.prazo_pagamento_dias === '' ? -1 : Math.floor(num(o.prazo_pagamento_dias));
  return {
    dia_corte: dia(o.dia_corte, REGRA_PADRAO.dia_corte),
    dia_vencimento: dia(o.dia_vencimento, REGRA_PADRAO.dia_vencimento),
    ajuste_vencimento: ajuste === 'anterior' || ajuste === 'nenhum' ? ajuste : 'proximo',
    data_base: base === 'inicio' || base === 'fim' ? base : 'venda',
    gerar_sozinha: o.gerar_sozinha === true,
    prazo_pagamento_dias: prazo >= 0 && prazo <= 365 ? prazo : REGRA_PADRAO.prazo_pagamento_dias,
  };
}

const anoMes = (iso: string) => ({ ano: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) });
function mesMais(ano: number, mes: number, n: number): { ano: number; mes: number } {
  const t = ano * 12 + (mes - 1) + n;
  return { ano: Math.floor(t / 12), mes: (t % 12) + 1 };
}
function corteDoMes(ano: number, mes: number, r: RegraDeFaturamento): string {
  return dataSegura(ano, mes, r.dia_corte);
}

/** O corte do período em que a data cai (a própria data, se for dia de corte). */
export function corteDe(data: string, r: RegraDeFaturamento): string {
  const { ano, mes } = anoMes(data);
  const c = corteDoMes(ano, mes, r);
  if (data <= c) return c;
  const p = mesMais(ano, mes, 1);
  return corteDoMes(p.ano, p.mes, r);
}

/** O corte anterior a um corte. */
export function corteAnterior(corte: string, r: RegraDeFaturamento): string {
  const { ano, mes } = anoMes(corte);
  const p = mesMais(ano, mes, -1);
  return corteDoMes(p.ano, p.mes, r);
}

/** O último corte que já passou (ou é hoje). */
export function ultimoCortePassado(hoje: string, r: RegraDeFaturamento): string {
  const c = corteDe(hoje, r);
  return c === hoje ? c : corteAnterior(c, r);
}

export interface Vencimento {
  /** O dia em que a fatura vence. */
  data: string;
  /** O dia pela regra, antes do ajuste de dia útil. */
  pela_regra: string;
  /** Por que mudou ("domingo", "Natal"...), ou null. */
  motivo_ajuste: string | null;
}

/** Vencimento da fatura que fecha num corte. */
export function vencimentoDoCorte(corte: string, r: RegraDeFaturamento, cal: Calendario = CALENDARIO_NACIONAL): Vencimento {
  const { ano, mes } = anoMes(corte);
  let alvo = dataSegura(ano, mes, r.dia_vencimento);
  if (alvo <= corte) {
    const p = mesMais(ano, mes, 1);
    alvo = dataSegura(p.ano, p.mes, r.dia_vencimento);
  }
  const motivo = motivoDeNaoSerUtil(alvo, cal);
  let data = alvo;
  if (motivo && r.ajuste_vencimento === 'proximo') data = proximoDiaUtil(alvo, cal);
  if (motivo && r.ajuste_vencimento === 'anterior') data = diaUtilAnterior(alvo, cal);
  return { data, pela_regra: alvo, motivo_ajuste: data !== alvo ? motivo : null };
}

export interface PeriodoDaFatura {
  inicio: string;
  corte: string;
  vencimento: Vencimento;
}

export function periodoDoCorte(corte: string, r: RegraDeFaturamento, cal: Calendario = CALENDARIO_NACIONAL): PeriodoDaFatura {
  return { inicio: addDias(corteAnterior(corte, r), 1), corte, vencimento: vencimentoDoCorte(corte, r, cal) };
}

/** O período em que uma data cai. */
export function periodoDe(data: string, r: RegraDeFaturamento, cal: Calendario = CALENDARIO_NACIONAL): PeriodoDaFatura {
  return periodoDoCorte(corteDe(data, r), r, cal);
}

/** As próximas N faturas a partir de hoje (a do período atual primeiro). Para a prévia ao editar a regra. */
export function proximasFaturas(hoje: string, r: RegraDeFaturamento, n = 3, cal: Calendario = CALENDARIO_NACIONAL): PeriodoDaFatura[] {
  const saida: PeriodoDaFatura[] = [];
  let corte = corteDe(hoje, r);
  for (let i = 0; i < n; i++) {
    saida.push(periodoDoCorte(corte, r, cal));
    corte = corteDe(addDias(corte, 1), r);
  }
  return saida;
}

/** A data que decide o período de um item, pela regra (cai na data da venda quando falta a da viagem). */
export function dataBaseDoItem(item: { data_venda: string; data_inicio?: string; data_fim?: string }, r: RegraDeFaturamento): string {
  if (r.data_base === 'inicio' && item.data_inicio) return item.data_inicio;
  if (r.data_base === 'fim' && item.data_fim) return item.data_fim;
  return item.data_venda;
}

/** Frase da regra para a tela ("Corte dia 25, vence dia 10 do mês seguinte, adiado para dia útil"). */
export function descreverRegra(r: RegraDeFaturamento): string {
  const corte = r.dia_corte >= 31 ? 'no último dia do mês' : `dia ${r.dia_corte}`;
  const mesmoMes = r.dia_vencimento > r.dia_corte;
  const venc = r.dia_vencimento >= 31 ? 'no último dia' : `dia ${r.dia_vencimento}`;
  const ajuste = r.ajuste_vencimento === 'proximo' ? ', adiado para o próximo dia útil'
    : r.ajuste_vencimento === 'anterior' ? ', antecipado para o dia útil anterior' : '';
  return `Corte ${corte}; vence ${venc} ${mesmoMes ? 'do mesmo mês' : 'do mês seguinte'}${ajuste}.`;
}
