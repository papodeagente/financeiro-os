import type { Faixa } from '@/components/fin/Meter';

/**
 * Cortes de utilização de cartão preservados literalmente da tela antiga:
 * acima de 85% é crítico, acima de 60% é atenção. Sem arredondar.
 */
export function faixaUtilizacaoCartao(pct: number): Faixa {
  if (pct > 85) return 'critico';
  if (pct > 60) return 'atencao';
  return 'saudavel';
}
