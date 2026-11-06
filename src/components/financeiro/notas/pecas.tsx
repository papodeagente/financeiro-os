'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

/** Liga e desliga, com o texto do que muda ao lado. */
export function Interruptor({ ligado, onChange, rotulo, descricao, id, desabilitado }: {
  ligado: boolean;
  onChange: (v: boolean) => void;
  rotulo: string;
  descricao?: React.ReactNode;
  id: string;
  desabilitado?: boolean;
}) {
  return (
    <div className="flex items-start gap-[var(--fin-s-3)]">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-describedby={descricao ? `${id}-desc` : undefined}
        disabled={desabilitado}
        onClick={() => onChange(!ligado)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-[var(--fin-dur-rapida)] disabled:opacity-50',
          ligado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent)]' : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)]',
          FOCO,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-4 rounded-full bg-[var(--fin-surface)] shadow-[var(--fin-e-card)] transition-transform duration-[var(--fin-dur-rapida)]',
            ligado ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{rotulo}</span>
        {descricao ? <span id={`${id}-desc`} className="fin-t-caption text-[var(--fin-text-3)]">{descricao}</span> : null}
      </label>
    </div>
  );
}

/** Opção que se marca e desmarca (um componente de receita, por exemplo). */
export function Pilula({ marcada, onClick, children, tom = 'soma', title, desabilitada }: {
  marcada: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tom?: 'soma' | 'tira';
  title?: string;
  desabilitada?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      title={title}
      disabled={desabilitada}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-[var(--fin-r-md)] border px-2.5 fin-t-caption font-medium transition-colors duration-[var(--fin-dur-rapida)] disabled:cursor-not-allowed disabled:opacity-40 max-lg:h-11',
        marcada
          ? tom === 'soma'
            ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
            : 'border-[var(--fin-negative)] bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]'
          : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
        FOCO,
      )}
    >
      <span aria-hidden="true" className="tabular-nums">{marcada ? (tom === 'soma' ? '+' : '−') : ''}</span>
      {children}
    </button>
  );
}

/** Seleção nativa com o visual dos campos do financeiro. */
export function CampoSelecao({ id, rotulo, valor, onChange, opcoes, ajuda }: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: Array<{ valor: string; rotulo: string }>;
  ajuda?: string;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
      <span className="fin-t-body-strong text-[var(--fin-text)]">{rotulo}</span>
      <select
        id={id}
        value={valor}
        onChange={e => onChange(e.target.value)}
        className={cn('h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] lg:h-10', FOCO)}
      >
        {opcoes.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {ajuda ? <span className="fin-t-caption text-[var(--fin-text-3)]">{ajuda}</span> : null}
    </label>
  );
}

export const CAMPO_TEXTO = cn(
  'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] lg:h-10',
  FOCO,
);

export const SECAO = 'flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
