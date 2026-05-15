'use client';

import { useDroppable } from '@dnd-kit/core';

interface Props {
  // Posição na lista onde a inserção vai acontecer. Quando o usuário
  // arrasta um item da paleta e solta na drop zone N, o novo bloco é
  // inserido em secoes[N].
  index: number;
  // True quando há um arrasto vindo da paleta em curso. Controla se a
  // drop zone fica visível (caso contrário ela ocupa apenas 8px e some
  // do fluxo visual normal).
  active: boolean;
  // Texto opcional do hint. Default "Soltar aqui".
  label?: string;
}

export function DropZone({ index, active, label = 'Soltar aqui' }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-zone-${index}`,
    data: { kind: 'drop-zone', index },
  });

  if (!active) {
    // Em estado normal, a drop zone é só um pequeno espaço entre blocos.
    // Mantém o ref pra dnd-kit registrar o droppable, mesmo invisível.
    return <div ref={setNodeRef} className="h-2" />;
  }

  return (
    <div
      ref={setNodeRef}
      className={`transition-all rounded-lg border-2 border-dashed flex items-center justify-center text-[11px] font-medium uppercase tracking-wider ${
        isOver
          ? 'h-14 bg-[var(--t-green)]/15 border-[var(--t-green)] text-[var(--t-green)]'
          : 'h-9 bg-[var(--t-green)]/5 border-[var(--t-green)]/30 text-[var(--t-green)]/60'
      }`}
      aria-label={`Soltar bloco na posição ${index}`}
    >
      {isOver ? `↓ ${label} ↓` : '·  ·  ·'}
    </div>
  );
}
