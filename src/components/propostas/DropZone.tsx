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
  // Posição na lista onde a inserção vai acontecer. Quando o usuário
  // arrasta um item da paleta e solta na drop zone N, o novo bloco é
  // inserido em secoes[N].
  index: number;
  // Tipo do bloco sendo arrastado da paleta. Quando definido, drop
  // zones ficam visíveis e mostram contexto (nome do bloco). Quando
  // null/undefined, drop zone fica oculta (8px).
  draggingType?: string | null;
  // Texto opcional do hint. Default e contextual (nome do bloco) ou
  // "Soltar aqui" se sem draggingType.
  label?: string;
  // Forca visivel mesmo sem drag (ex.: empty state)
  forceVisible?: boolean;
}

export function DropZone({ index, draggingType, label, forceVisible }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-zone-${index}`,
    data: { kind: 'drop-zone', index },
  });

  const active = !!draggingType || !!forceVisible;
  if (!active) {
    return <div ref={setNodeRef} className="h-2" />;
  }

  const tipoLabel = draggingType ? (TIPO_LABELS[draggingType] || draggingType) : '';
  const displayLabel = label || (tipoLabel ? `Soltar ${tipoLabel} aqui` : 'Soltar aqui');

  return (
    <div
      ref={setNodeRef}
      className={`transition-all rounded-lg border-2 border-dashed flex items-center justify-center text-[11px] font-medium uppercase tracking-wider ${
        isOver
          ? 'h-16 bg-[var(--t-green)]/20 border-[var(--t-green)] text-[var(--t-green)] scale-[1.01] shadow-md'
          : 'h-9 bg-[var(--t-green)]/5 border-[var(--t-green)]/30 text-[var(--t-green)]/70'
      }`}
      aria-label={`Soltar bloco na posição ${index}`}
    >
      {isOver ? (
        <span className="flex items-center gap-1.5">
          <span className="animate-bounce">↓</span>
          {displayLabel}
          <span className="animate-bounce">↓</span>
        </span>
      ) : (
        <span className="opacity-60">{tipoLabel ? `↓ ${tipoLabel}` : '·  ·  ·'}</span>
      )}
    </div>
  );
}
