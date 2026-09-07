import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';

export type DeltaIndicatorProps = {
  /** null significa "sem base de comparação". O componente SOME. Nunca renderiza 0. */
  pct: number | null;
  direcao: 'up' | 'down';
  polaridade: 'subirBom' | 'subirRuim';
  /** "vs. mês anterior" */
  base: string;
  size?: 'caption' | 'body';
};

function formatarPct(magnitude: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(magnitude)}%`;
}

export function DeltaIndicator({
  pct,
  direcao,
  polaridade,
  base,
  size = 'caption',
}: DeltaIndicatorProps) {
  if (pct === null) return null;

  const favoravel = polaridade === 'subirBom' ? direcao === 'up' : direcao === 'down';
  const Glifo = direcao === 'up' ? ArrowUpRight : ArrowDownRight;
  const sinal = direcao === 'up' ? '+' : '-';
  const magnitude = Number.isFinite(pct) ? Math.abs(pct) : 0;
  const rotuloDirecao = direcao === 'up' ? 'aumento de' : 'queda de';

  return (
    <span
      data-fin-delta={favoravel ? 'favoravel' : 'desfavoravel'}
      className={cn(
        'inline-flex items-center gap-1',
        size === 'body' ? 'fin-t-body' : 'fin-t-caption',
        favoravel ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative-text)]',
      )}
    >
      <Glifo className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{rotuloDirecao}</span>
      <span className="font-semibold tabular-nums">{`${sinal}${formatarPct(magnitude)}`}</span>
      <span className="font-normal text-[var(--fin-text-3)]">{base}</span>
    </span>
  );
}

export default DeltaIndicator;
