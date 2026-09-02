import type { ContaBancaria, ContaReceber, ContaPagar } from './crm-types';
import { num, round2, soma } from './money';

// ──────────────────────────────────────────────────────────────────────────
// Saldo bancário COMPUTADO — fonte da verdade é o histórico de baixas,
// não o saldo_atual armazenado. Evita inconsistência quando algum fluxo
// de UI altera CR/CP sem passar pelo PUT que sincroniza saldo.
//
// Função PURA (sem imports de db/pool) — importável de componentes
// client e server livremente.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Dinheiro que uma conta já movimentou no extrato.
 *
 * Conta PARCIAL conta pelo ACUMULADO já recebido/pago — ignorá-la faria o
 * saldo computado divergir do saldo real do banco (o dinheiro entrou, mas o
 * relatório não via). Conta pendente vale 0, mesmo tendo valor_final.
 */
export function valorMovimentado(
  conta: { status?: string; valor_recebido?: number | null; valor_pago?: number | null; valor_final?: number | null },
  campo: 'valor_recebido' | 'valor_pago',
): number {
  const status = String(conta.status ?? '');
  const quitado = campo === 'valor_recebido' ? 'RECEBIDO' : 'PAGO';
  if (status === 'PARCIAL') return round2(num(conta[campo]));
  if (status === quitado) return round2(num(conta[campo]) || num(conta.valor_final));
  return 0;
}

export function calcularSaldoBancario(
  contas: ContaBancaria[] | null | undefined,
  receber: ContaReceber[] | null | undefined,
  pagar: ContaPagar[] | null | undefined,
): number {
  const iniciais = soma((contas || []).map(c => c.saldo_inicial));
  const entradas = soma((receber || []).map(r => valorMovimentado(r, 'valor_recebido')));
  const saidas = soma((pagar || []).map(p => valorMovimentado(p, 'valor_pago')));
  return round2(iniciais + entradas - saidas);
}
