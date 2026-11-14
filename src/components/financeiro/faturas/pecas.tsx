'use client';

/**
 * Peças de tela das faturas (E5, parte B): abas, seção, rótulo/valor e o
 * botão discreto das linhas. Só tokens --fin-*.
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export const SECAO = 'flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] md:p-[var(--fin-s-5)]';
export const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
export const CONTROLE = cn('h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] lg:h-10 disabled:opacity-60', FOCO);
export const LINK = cn('text-[var(--fin-accent)] underline-offset-2 hover:underline', FOCO);
export const BOTAO_LINHA = cn(
  'inline-flex h-8 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-caption text-[var(--fin-text-2)] max-lg:h-11',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:pointer-events-none disabled:opacity-50', FOCO,
);

export function Abas<T extends string>({ rotulo, abas, valor, onChange, idBase }: {
  rotulo: string;
  abas: ReadonlyArray<{ id: T; rotulo: string; contagem?: number }>;
  valor: T;
  onChange: (v: T) => void;
  idBase: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-1 overflow-x-auto border-b border-[var(--fin-border)]">
      {abas.map((a, i) => {
        const ativa = a.id === valor;
        return (
          <button
            key={a.id} type="button" role="tab" id={`${idBase}-aba-${a.id}`} aria-selected={ativa} aria-controls={`${idBase}-painel`} tabIndex={ativa ? 0 : -1}
            onClick={() => onChange(a.id)}
            onKeyDown={e => {
              const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!passo) return;
              e.preventDefault();
              const prox = abas[(i + passo + abas.length) % abas.length];
              onChange(prox.id);
              document.getElementById(`${idBase}-aba-${prox.id}`)?.focus();
            }}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 fin-t-body transition-colors duration-[var(--fin-dur-rapida)]',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fin-accent)]',
              ativa ? 'border-[var(--fin-accent)] font-medium text-[var(--fin-text)]' : 'border-transparent text-[var(--fin-text-2)] hover:text-[var(--fin-text)]',
            )}
          >
            {a.rotulo}
            {a.contagem !== undefined ? <span className="ml-1.5 tabular-nums text-[var(--fin-text-3)]">{a.contagem}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TituloDaSecao({ titulo, descricao, acao, id }: { titulo: string; descricao?: React.ReactNode; acao?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={id} className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        {descricao ? <p className="fin-t-caption text-[var(--fin-text-2)]">{descricao}</p> : null}
      </div>
      {acao ? <div className="flex shrink-0 flex-wrap gap-[var(--fin-s-2)]">{acao}</div> : null}
    </div>
  );
}

export function Aviso({ tom = 'info', children }: { tom?: 'info' | 'aviso' | 'negativo' | 'positivo' | 'neutro'; children: React.ReactNode }) {
  const cor = {
    info: 'bg-[var(--fin-info-soft)] text-[var(--fin-info)]',
    aviso: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
    negativo: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
    positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
    neutro: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
  }[tom];
  return <div className={cn('rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body', cor)}>{children}</div>;
}
