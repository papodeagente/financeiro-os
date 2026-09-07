import * as React from 'react';

import { cn } from '@/lib/utils';

export type Faixa = 'saudavel' | 'atencao' | 'critico';

export const ROTULO_FAIXA: Record<Faixa, string> = {
  saudavel: 'Saudável',
  atencao: 'Atenção',
  critico: 'Crítico',
};

export type MeterProps = {
  pct: number;
  faixa: Faixa;
  /** "R$ 3.200 de R$ 10.000" */
  descricao: string;
  size?: 'sm' | 'md';
};

const COR_TEXTO: Record<Faixa, string> = {
  saudavel: 'text-[var(--fin-positive)]',
  atencao: 'text-[var(--fin-warning-text)]',
  critico: 'text-[var(--fin-negative-text)]',
};

const COR_BARRA: Record<Faixa, string> = {
  saudavel: 'bg-[var(--fin-positive)]',
  atencao: 'bg-[var(--fin-warning)]',
  critico: 'bg-[var(--fin-negative)]',
};

function formatarPct(pct: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(pct)}%`;
}

export function Meter({ pct, faixa, descricao, size = 'md' }: MeterProps) {
  const valido = Number.isFinite(pct) ? pct : 0;
  const preenchido = Math.min(100, Math.max(0, valido));
  const rotulo = ROTULO_FAIXA[faixa];
  const texto = formatarPct(valido);

  return (
    <div data-fin-meter={faixa} className="flex w-full flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('fin-t-overline', COR_TEXTO[faixa])}>{rotulo}</span>
        <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{texto}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={preenchido}
        aria-valuetext={`${texto}, ${rotulo}. ${descricao}`}
        className={cn(
          'w-full overflow-hidden rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]',
          size === 'sm' ? 'h-1' : 'h-2',
        )}
      >
        <div
          className={cn('h-full w-[var(--fin-meter)] rounded-[var(--fin-r-sm)]', COR_BARRA[faixa])}
          style={{ '--fin-meter': `${preenchido}%` } as React.CSSProperties}
        />
      </div>
      <span className="fin-t-caption text-[var(--fin-text-3)]">{descricao}</span>
    </div>
  );
}

export default Meter;
