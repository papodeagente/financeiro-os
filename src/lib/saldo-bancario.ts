import type { ContaBancaria, ContaReceber, ContaPagar } from './crm-types';

// ──────────────────────────────────────────────────────────────────────────
// Saldo bancário COMPUTADO — fonte da verdade é o histórico de baixas,
// não o saldo_atual armazenado. Evita inconsistência quando algum fluxo
// de UI altera CR/CP sem passar pelo PUT que sincroniza saldo.
//
// Função PURA (sem imports de db/pool) — importável de componentes
// client e server livremente.
// ──────────────────────────────────────────────────────────────────────────

export function calcularSaldoBancario(
  contas: ContaBancaria[] | null | undefined,
  receber: ContaReceber[] | null | undefined,
  pagar: ContaPagar[] | null | undefined,
): number {
  let total = 0;
  for (const c of contas || []) {
    total += Number(c.saldo_inicial) || 0;
  }
  for (const r of receber || []) {
    if (r.status === 'RECEBIDO') {
      total += Number(r.valor_recebido) || Number(r.valor_final) || 0;
    }
  }
  for (const p of pagar || []) {
    if (p.status === 'PAGO') {
      total -= Number(p.valor_pago) || Number(p.valor_final) || 0;
    }
  }
  return Number(total.toFixed(2));
}
