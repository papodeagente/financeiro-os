import type { ContaBancaria, ContaReceber, ContaPagar } from './crm-types';
import { num, round2, soma } from './money';
import { taxaRealizada } from './taxa-plataforma';

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

/**
 * Quanto uma conta a receber REALMENTE colocou no banco.
 *
 * A baixa registra o valor cheio que o cliente pagou, porque é isso que
 * quita a conta. Mas quando o pagamento passa por uma adquirente, ela retém
 * a taxa antes de repassar: o extrato mostra a diferença, não o valor cheio.
 * Sem este desconto o saldo computado fica acima do saldo real por todo o
 * valor das taxas, e a conciliação nunca fecha.
 */
export function entradaLiquidaNoBanco(conta: ContaReceber): number {
  return round2(valorMovimentado(conta, 'valor_recebido') - taxaRealizada(conta));
}

export function calcularSaldoBancario(
  contas: ContaBancaria[] | null | undefined,
  receber: ContaReceber[] | null | undefined,
  pagar: ContaPagar[] | null | undefined,
): number {
  const iniciais = soma((contas || []).map(c => c.saldo_inicial));
  const entradas = soma((receber || []).map(entradaLiquidaNoBanco));
  const saidas = soma((pagar || []).map(p => valorMovimentado(p, 'valor_pago')));
  return round2(iniciais + entradas - saidas);
}
