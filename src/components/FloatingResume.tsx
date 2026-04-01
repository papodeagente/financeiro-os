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
    <div className="fixed bottom-4 right-4 z-50 bg-[#1a1a2e] text-white rounded-xl shadow-2xl p-4 min-w-[220px] border border-[#d4a853]/30">
      <div className="text-xs text-[#d4a853] font-semibold mb-1">Preço por PAX (DBL)</div>
      <div className="text-xl font-bold">{formatBRL(dblAvista)}</div>
      <div className="text-xs text-gray-300 mt-1">
        ou {parcelas}x de {formatBRL(dblCartao)}
      </div>
    </div>
  );
}
