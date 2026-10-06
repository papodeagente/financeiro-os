'use client';

import { useDroppable } from '@dnd-kit/core';

interface Props {
  draggingType?: string | null;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

// Drop area UNICA que cobre o documento inteiro. Quando o usuario
// arrasta um bloco da paleta, qualquer lugar do documento aceita o
// drop — o handleDragEnd calcula a posicao Y do cursor vs os blocos
// existentes pra decidir onde inserir. Acaba com a frustracao das
// "zonas azuis discretas" entre blocos.
//
// Visual: durante drag, overlay azul translucido sobre TODO o documento
// + ring + label "Solte aqui" centralizada quando o ponteiro entra na
// area. pointer-events-none pra nao bloquear click nos blocos quando
// nao ha drag em curso.
export function CanvasDropArea({ draggingType, children, className, style, onClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas-drop',
    data: { kind: 'canvas' },
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative ${className || ''}`}
      style={style}
      onClick={onClick}
    >
      {children}
      {draggingType && (
        <div
          className={`absolute inset-0 pointer-events-none rounded-lg transition-all ${
 isOver
 ? 'ring-4 ring-[var(--fin-accent)] bg-[var(--fin-accent-soft)] shadow-2xl '
 : 'ring-2 ring-[var(--fin-accent)]/60 bg-[var(--fin-accent-soft)]'
 }`}
          style={{ zIndex: 50 }}
          aria-hidden
        >
          {isOver && (
            <div className="sticky top-3 mx-auto w-fit px-4 py-2 rounded-full bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-xs font-bold shadow-xl uppercase tracking-wider flex items-center gap-2 animate-pulse">
              <span className="text-lg">↓</span>
              Solte em qualquer lugar
              <span className="text-lg">↓</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
