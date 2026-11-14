/**
 * Conta bancária desativada (06/11/2026, E7): some dos seletores (lançar,
 * liquidar, transferir, conciliar), mas continua nos relatórios, no extrato
 * e no histórico. Ausente = ativa, como sempre foi.
 */
export function contaBancariaAtiva(c: { ativo?: unknown } | null | undefined): boolean {
  if (!c) return false;
  return c.ativo !== false && c.ativo !== 'false';
}

/**
 * Para os seletores: só as ativas, mais a conta que o registro já usa (para a
 * tela de um título antigo não perder o nome da conta desativada).
 */
export function contasParaEscolher<T extends { id: string; ativo?: unknown }>(contas: readonly T[], jaEscolhida?: string | null): T[] {
  return contas.filter(c => contaBancariaAtiva(c) || (jaEscolhida ? c.id === jaEscolhida : false));
}
