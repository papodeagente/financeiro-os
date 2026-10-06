'use client';

import { useDroppable } from '@dnd-kit/core';

const TIPO_LABELS: Record<string, string> = {
  TEXTO: 'Texto', SERVICO: 'Serviço', VOO: 'Voo', ROTEIRO_DIA: 'Roteiro',
  GALERIA: 'Galeria', INCLUSOS: 'Inclusos', VALORES: 'Valores',
  DEPOIMENTO: 'Depoimento', CTA: 'CTA', VIDEO: 'Vídeo', MAPA: 'Mapa',
  FAQ: 'FAQ', COUNTDOWN: 'Countdown', ALOJAMENTO: 'Hospedagem',
  TRANSPORTE: 'Transporte',
};

interface Props {
  index: number;
  locationKey: string;
  draggingType?: string | null;
  label?: string;
  forceVisible?: boolean;
  variant?: 'inline' | 'page';
}

export function DropZone({ index, locationKey, draggingType, label, forceVisible, variant = 'inline' }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-zone-${locationKey}`,
    data: { kind: 'drop-zone', index },
  });

  const active = !!draggingType || !!forceVisible;
  if (!active) {
    // Em repouso, ocupa minimo. Pequeno padding pra dnd-kit registrar
    // bounds positivas (zero-height pode causar issues).
    return <div ref={setNodeRef} className="h-2" />;
  }

  const tipoLabel = draggingType ? (TIPO_LABELS[draggingType] || draggingType) : '';
  const displayLabel = label || (tipoLabel ? `Soltar ${tipoLabel} aqui` : 'Soltar aqui');

  // Drop zones MUITO visiveis durante drag. Mesmo design pra inline e
  // page — diferenca so na altura. Cores fortes, bordas grossas,
  // animacao bounce quando isOver pra confirmacao visual clara.
  const baseHeight = variant === 'page' ? 'min-h-24' : 'min-h-16';

  return (
    <div
      ref={setNodeRef}
      className={`${baseHeight} my-2 transition-all rounded-xl border-2 border-dashed flex items-center justify-center text-sm font-semibold uppercase tracking-wider ${
 isOver
 ? 'bg-[var(--fin-accent)] border-[var(--fin-accent)] text-[var(--fin-text-on-fill)] shadow-xl scale-[1.02]'
 : 'bg-[var(--fin-accent-soft)] border-[var(--fin-accent)]/30 text-[var(--fin-accent)]'
 }`}
      aria-label={`Soltar bloco na posição ${index}`}
      data-drop-zone-key={locationKey}
    >
      {isOver ? (
        <span className="flex items-center gap-2 text-base">
          <span className="text-xl animate-bounce">↓</span>
          {displayLabel}
          <span className="text-xl animate-bounce">↓</span>
        </span>
      ) : (
        <span className="flex items-center gap-2 opacity-90">
          <span className="text-xs">●</span>
          {displayLabel}
          <span className="text-xs">●</span>
        </span>
      )}
    </div>
  );
}
