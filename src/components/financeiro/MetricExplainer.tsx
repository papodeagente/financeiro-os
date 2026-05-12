'use client';

import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

// Ícone (?) ao lado de um label que mostra um popover explicativo no hover/click.
// Lazy — só renderiza o conteúdo quando aberto. Sem libs externas (Radix etc.)
// pra manter o bundle leve.

interface Props {
  /** Título curto da explicação (negrito). */
  title?: string;
  /** Texto explicativo (suporta line break com \n). */
  text: string;
  /** Posição preferencial do popover (default 'bottom'). */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Tamanho do ícone (default 14px). */
  size?: number;
}

export function MetricExplainer({ title, text, position = 'bottom', size = 14 }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  }[position];

  return (
    <span ref={containerRef} className="inline-flex items-center relative align-middle">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        className="inline-flex items-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors ml-1"
        aria-label="Ver explicação"
      >
        <HelpCircle style={{ width: size, height: size }} />
      </button>

      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 ${positionClasses} w-64 p-3 rounded-lg bg-[var(--t-surface)] border border-[var(--t-border)] shadow-lg text-left normal-case`}
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
        >
          {title && (
            <span className="block text-xs font-semibold text-[var(--t-text)] mb-1">
              {title}
            </span>
          )}
          <span className="block text-[11px] leading-relaxed text-[var(--t-text-secondary)] whitespace-pre-line">
            {text}
          </span>
        </span>
      )}
    </span>
  );
}
