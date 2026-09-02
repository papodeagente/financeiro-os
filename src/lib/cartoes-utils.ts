import type { CartaoCorporativo, ContaPagar, BandeiraCartao } from './crm-types';
import { addDias, dataLocal, dataSegura, dentroDoPeriodo, paraISO, somaPor } from './money';

/** Data civil -> Date ancorado ao meio-dia. Entrada sempre válida aqui. */
function comoDate(iso: string): Date {
  return dataLocal(iso) ?? new Date();
}

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
  return somaPor(
    contas.filter(c => c.cartao_id === cartaoId && c.status !== 'CANCELADO'),
    c => c.valor_final,
  );
}

/**
 * Próximo dia X a partir da data ref, comparando por DATA CIVIL — no próprio
 * dia do fechamento a resposta é hoje, não o mês seguinte (comparar Date com
 * hora contra meia-noite empurrava o dia corrente pro mês que vem).
 * Dia inexistente no mês (31 em mês de 30) cai no último dia.
 */
function proximoDiaDoMes(dia: number, ref: Date): Date {
  const refISO = paraISO(ref);
  const candidato = dataSegura(ref.getFullYear(), ref.getMonth() + 1, dia);
  if (candidato >= refISO) return comoDate(candidato);
  const proxMes = ref.getMonth() + 2;
  const ano = proxMes > 12 ? ref.getFullYear() + 1 : ref.getFullYear();
  const mes = proxMes > 12 ? proxMes - 12 : proxMes;
  return comoDate(dataSegura(ano, mes, dia));
}

/**
 * Próxima data de fechamento a partir de hoje (ou de uma data ref).
 * Se hoje já passou do dia de fechamento neste mês, vai pro próximo.
 */
export function calcProximoFechamento(diaFechamento: number, ref: Date = new Date()): Date {
  if (!diaFechamento || diaFechamento < 1) return ref;
  return proximoDiaDoMes(diaFechamento, ref);
}

/**
 * Próxima data de vencimento a partir de hoje.
 */
export function calcProximoVencimento(diaVencimento: number, ref: Date = new Date()): Date {
  if (!diaVencimento || diaVencimento < 1) return ref;
  return proximoDiaDoMes(diaVencimento, ref);
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
  const diaFechamento = cartao.dia_fechamento || 31;

  // Datas civis (string) o tempo todo: `new Date('YYYY-MM-DD')` parseia como UTC
  // e no BRT volta um dia — o lançamento do dia seguinte ao fechamento sumia de
  // TODAS as faturas.
  const fimISO = dataSegura(ano, mesNum, diaFechamento);
  const anteriorAno = mesNum === 1 ? ano - 1 : ano;
  const anteriorMes = mesNum === 1 ? 12 : mesNum - 1;
  // inicio é o dia SEGUINTE ao fechamento anterior
  const inicioISO = addDias(dataSegura(anteriorAno, anteriorMes, diaFechamento), 1);

  const lancamentos = contas.filter(c => {
    if (c.cartao_id !== cartao.id) return false;
    const ref = c.data_pagamento || c.data_vencimento;
    return dentroDoPeriodo(ref, inicioISO, fimISO);
  });

  const total = somaPor(lancamentos, c => c.valor_final);
  // inicio/fim seguem como Date para a UI que já formata assim
  return { inicio: comoDate(inicioISO), fim: comoDate(fimISO), total, lancamentos };
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
