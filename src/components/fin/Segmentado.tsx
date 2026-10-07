'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export type OpcaoSegmentada<T extends string> = { valor: T; rotulo: string };

export type SegmentadoProps<T extends string> = {
  /** Nome do grupo para leitor de tela: "Período", "Agrupar por". */
  rotulo: string;
  opcoes: ReadonlyArray<OpcaoSegmentada<T>>;
  valor: T;
  onChange: (valor: T) => void;
  /** Ocupa a largura toda, com os segmentos divididos por igual. 'celular': só abaixo de md. */
  cheio?: boolean | 'celular';
  className?: string;
};

/**
 * Controle segmentado: poucas opções excludentes, todas à vista.
 *
 * É um grupo de rádio (role="radiogroup"): Tab entra no selecionado e as
 * setas trocam, como num controle nativo.
 */
export function Segmentado<T extends string>({
  rotulo, opcoes, valor, onChange, cheio = false, className,
}: SegmentadoProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function aoTeclar(e: React.KeyboardEvent, indice: number) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    const proximo = (indice + passo + opcoes.length) % opcoes.length;
    onChange(opcoes[proximo].valor);
    refs.current[proximo]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className={cn(
        'inline-flex gap-0.5 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-0.5',
        cheio === true && 'flex w-full',
        cheio === 'celular' && 'flex w-full md:inline-flex md:w-auto',
        className,
      )}
    >
      {opcoes.map((o, i) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(o.valor)}
            onKeyDown={e => aoTeclar(e, i)}
            className={cn(
              'h-9 whitespace-nowrap rounded-[var(--fin-r-sm)] px-3 fin-t-body lg:h-8',
              'transition-[background-color,color,box-shadow] duration-[var(--fin-dur-rapida)]',
              cheio === true && 'flex-1 px-2',
              cheio === 'celular' && 'min-w-0 flex-1 px-1.5 md:flex-none md:px-3',
              ativo
                ? 'bg-[var(--fin-surface)] font-medium text-[var(--fin-text)] shadow-[var(--fin-e-card)] ring-1 ring-[var(--fin-border)]'
                : 'text-[var(--fin-text-2)] hover:text-[var(--fin-text)]',
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

export default Segmentado;
