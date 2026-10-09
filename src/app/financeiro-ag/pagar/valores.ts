import type { ContaPagar } from '@/lib/crm-types';
import { num, round2 } from '@/lib/money';

/**
 * Valor da conta em BRL.
 *
 * `valor_final` é BRL por contrato (ver venda-financeiro.ts), tanto nas contas
 * geradas por venda quanto nas lançadas à mão. Não se infere formato comparando
 * valor_final com valor_original: contas antigas em moeda estrangeira têm os
 * dois iguais e legitimamente em BRL, e converter de novo inflaria o valor pelo
 * câmbio. `valor_brl` é usado só quando valor_final está ausente.
 */
export function valorBRLDaConta(i: ContaPagar): number {
  const final = num(i.valor_final);
  if (final) return round2(final);
  return round2(num(i.valor_brl));
}

/** Quanto ainda falta pagar (em BRL). Conta PARCIAL mantém o saldo visível. */
export function saldoDevedor(i: ContaPagar): number {
  return round2(valorBRLDaConta(i) - num(i.valor_pago));
}
