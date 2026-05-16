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
  // CHAVE UNICA dentro do DndContext. Cada DropZone PRECISA de uma
  // locationKey unica — varias drop zones podem apontar pro mesmo
  // index (ex.: page-level + inner ambas inserem na pos 0) mas
  // devem ter ids diferentes pra dnd-kit registrar todas.
  locationKey: string;
  // Tipo do bloco sendo arrastado da paleta. Quando definido, drop
  // zones ficam visíveis e mostram contexto (nome do bloco).
  draggingType?: string | null;
  // Texto opcional do hint. Default e contextual (nome do bloco) ou
  // "Soltar aqui" se sem draggingType.
  label?: string;
  // Forca visivel mesmo sem drag (ex.: empty state)
  forceVisible?: boolean;
  // Variante visual:
  //  - 'inline' (default): drop zone discreta entre blocos
  //  - 'page' : drop zone full-width entre secoes de pagina (capa/
  //    blocos/rodape) — visual mais prominente
  variant?: 'inline' | 'page';
}

export function DropZone({ index, locationKey, draggingType, label, forceVisible, variant = 'inline' }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-zone-${locationKey}`,
    data: { kind: 'drop-zone', index },
  });

  const active = !!draggingType || !!forceVisible;
  if (!active) {
    // Em repouso, drop zone ocupa o minimo possivel pra nao interferir.
    return <div ref={setNodeRef} className={variant === 'page' ? 'h-1' : 'h-2'} />;
  }

  const tipoLabel = draggingType ? (TIPO_LABELS[draggingType] || draggingType) : '';
  const displayLabel = label || (tipoLabel ? `Soltar ${tipoLabel} aqui` : 'Soltar aqui');

  // Variant 'page' e mais prominente — usado entre capa/blocos/rodape.
  // Variant 'inline' e usado entre blocos individuais.
  const baseHeight = variant === 'page' ? 'h-20' : 'h-12';
  const overHeight = variant === 'page' ? 'h-24' : 'h-16';

  return (
    <div
      ref={setNodeRef}
      className={`transition-all rounded-xl border-2 border-dashed flex items-center justify-center text-xs font-medium ${
        isOver
          ? `${overHeight} bg-[var(--t-green)]/25 border-[var(--t-green)] text-[var(--t-green)] scale-[1.01] shadow-lg`
          : `${baseHeight} bg-[var(--t-green)]/8 border-[var(--t-green)]/40 text-[var(--t-green)]/80`
      }`}
      aria-label={`Soltar bloco na posição ${index}`}
    >
      {isOver ? (
        <span className="flex items-center gap-2 uppercase tracking-wider font-bold">
          <span className="animate-bounce text-base">↓</span>
          {displayLabel}
          <span className="animate-bounce text-base">↓</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 opacity-80">
          <span className="w-1 h-1 rounded-full bg-current" />
          {tipoLabel ? `Soltar ${tipoLabel} aqui` : displayLabel}
          <span className="w-1 h-1 rounded-full bg-current" />
        </span>
      )}
    </div>
  );
}
