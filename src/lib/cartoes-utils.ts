import type { CartaoCorporativo, ContaPagar, BandeiraCartao } from './crm-types';

/**
 * Soma das despesas vinculadas a um cartão — representa o limite consumido.
 *
 * Conta TODAS as contas exceto CANCELADO, independente do status de pagamento:
 * marcar a conta a pagar como PAGO não libera o limite, pois quem libera é
 * o pagamento da própria fatura do cartão (que hoje ainda não é modelado
 * como entidade separada). Enquanto isso, toda despesa lançada no cartão
 * permanece consumindo o limite — comportamento esperado pelo usuário e
 * consistente com como cartões funcionam na prática.
 */
export function calcLimiteUsado(cartaoId: string, contas: ContaPagar[]): number {
  return contas
    .filter(c => c.cartao_id === cartaoId && c.status !== 'CANCELADO')
    .reduce((sum, c) => sum + (c.valor_final || 0), 0);
}

/**
 * Trata o caso "dia 31 em mês de 30 dias" → cap no último dia do mês.
 */
function clampDayToMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

/**
 * Próxima data de fechamento a partir de hoje (ou de uma data ref).
 * Se hoje já passou do dia de fechamento neste mês, vai pro próximo.
 */
export function calcProximoFechamento(diaFechamento: number, ref: Date = new Date()): Date {
  if (!diaFechamento || diaFechamento < 1) return ref;
  const candidato = clampDayToMonth(ref.getFullYear(), ref.getMonth(), diaFechamento);
  if (candidato.getTime() < ref.getTime()) {
    return clampDayToMonth(ref.getFullYear(), ref.getMonth() + 1, diaFechamento);
  }
  return candidato;
}

/**
 * Próxima data de vencimento a partir de hoje.
 */
export function calcProximoVencimento(diaVencimento: number, ref: Date = new Date()): Date {
  if (!diaVencimento || diaVencimento < 1) return ref;
  const candidato = clampDayToMonth(ref.getFullYear(), ref.getMonth(), diaVencimento);
  if (candidato.getTime() < ref.getTime()) {
    return clampDayToMonth(ref.getFullYear(), ref.getMonth() + 1, diaVencimento);
  }
  return candidato;
}

/**
 * Calcula a fatura de um cartão para um mês de referência (formato "YYYY-MM").
 * Período: do fechamento do mês anterior (exclusivo) até o fechamento do mês atual (inclusivo).
 * Filtra contas pelo `data_pagamento` (caiu na fatura), ou pelo `data_vencimento` se não pago ainda.
 */
export function calcFaturaPeriodo(
  cartao: CartaoCorporativo,
  contas: ContaPagar[],
  mes: string
): { inicio: Date; fim: Date; total: number; lancamentos: ContaPagar[] } {
  const [ano, mesNum] = mes.split('-').map(Number);
  const refMesAtual = new Date(ano, mesNum - 1, 1);
  const refMesAnterior = new Date(ano, mesNum - 2, 1);

  const fim = clampDayToMonth(refMesAtual.getFullYear(), refMesAtual.getMonth(), cartao.dia_fechamento || 31);
  const inicioBruto = clampDayToMonth(refMesAnterior.getFullYear(), refMesAnterior.getMonth(), cartao.dia_fechamento || 31);
  // inicio é o dia SEGUINTE ao fechamento anterior
  const inicio = new Date(inicioBruto.getTime() + 24 * 60 * 60 * 1000);

  const lancamentos = contas.filter(c => {
    if (c.cartao_id !== cartao.id) return false;
    const ref = c.data_pagamento || c.data_vencimento;
    if (!ref) return false;
    const refDate = new Date(ref);
    return refDate >= inicio && refDate <= fim;
  });

  const total = lancamentos.reduce((sum, c) => sum + (c.valor_final || 0), 0);
  return { inicio, fim, total, lancamentos };
}

/**
 * Cores temáticas por bandeira (usadas em badges e faixas).
 */
export function bandeiraColor(bandeira: BandeiraCartao): { bg: string; text: string } {
  const map: Record<BandeiraCartao, { bg: string; text: string }> = {
    VISA:       { bg: '#1a1f71', text: '#f7b600' },
    MASTERCARD: { bg: '#eb001b', text: '#ffffff' },
    ELO:        { bg: '#000000', text: '#ffcb00' },
    AMEX:       { bg: '#006fcf', text: '#ffffff' },
    HIPERCARD:  { bg: '#b3131b', text: '#ffffff' },
    OUTRA:      { bg: '#374151', text: '#ffffff' },
  };
  return map[bandeira] || map.OUTRA;
}

export const BANDEIRA_LABEL: Record<BandeiraCartao, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  ELO: 'Elo',
  AMEX: 'Amex',
  HIPERCARD: 'Hipercard',
  OUTRA: 'Outra',
};
