'use client';

import { GrupoViagem } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';

export function FloatingResume({ grupo }: { grupo: GrupoViagem }) {
  const proposta = calcProposta(grupo);
  const dblAvista = proposta.totalPaxAvista['dbl'] || 0;
  const dblCartao = proposta.parcelaPaxCC['dbl'] || 0;
  const parcelas = grupo.params.parcelas;

  if (dblAvista === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-[var(--t-header-bg)] text-[var(--t-header-text)] rounded-xl shadow-2xl p-4 min-w-[220px] border border-[var(--t-accent)]/30">
      <div className="text-xs text-[var(--t-accent)] font-semibold mb-1">Preço por PAX (DBL)</div>
      <div className="text-xl font-bold">{formatBRL(dblAvista)}</div>
      <div className="text-xs text-[var(--t-text-secondary)] mt-1">
        ou {parcelas}x de {formatBRL(dblCartao)}
      </div>
    </div>
  );
}
