'use client';

import { Info, RefreshCw, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DataStateProps = {
  estado: 'carregando' | 'erro' | 'ok';
  erro?: { mensagem: string; onTentarDeNovo: () => void } | null;
  /** Avisa que parte dos dados falhou sem derrubar a tela. */
  parcial?: { mensagem: string } | null;
  /** Precisa ter a FORMA do conteúdo real, senão o layout salta. */
  esqueleto: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function DataState({ estado, erro, parcial, esqueleto, children, className }: DataStateProps) {
  if (estado === 'carregando') {
    return (
      <div
        data-slot="fin-data-state"
        data-estado="carregando"
        aria-busy="true"
        aria-live="polite"
        className={className}
      >
        <span className="sr-only">Carregando</span>
        <div aria-hidden="true">{esqueleto}</div>
      </div>
    );
  }

  if (estado === 'erro') {
    return (
      <div
        data-slot="fin-data-state"
        data-estado="erro"
        role="alert"
        className={cn(
          'flex flex-col items-start gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-negative)]/24',
          'bg-[var(--fin-negative-soft)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between',
          className
        )}
      >
        <div className="flex items-start gap-3">
          <TriangleAlert aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[var(--fin-negative-text)]" />
          <div className="flex flex-col gap-1">
            <span className="fin-t-body-strong text-[var(--fin-negative-text)]">
              Não foi possível carregar estes dados
            </span>
            <span className="fin-t-caption text-[var(--fin-text-2)]">
              {erro?.mensagem ?? 'A consulta falhou. Nada foi alterado.'}
            </span>
          </div>
        </div>
        {erro?.onTentarDeNovo && (
          <Button
            onClick={erro.onTentarDeNovo}
            className={cn(
              'h-11 shrink-0 rounded-[var(--fin-r-md)] px-4 lg:h-10 fin-t-body-strong',
              'border border-[var(--fin-border)] bg-[var(--fin-surface)] text-[var(--fin-text)] shadow-none',
              'hover:bg-[var(--fin-surface-2)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]'
            )}
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div data-slot="fin-data-state" data-estado="ok" className={className}>
      {parcial && (
        <div
          role="status"
          className={cn(
            'mb-4 flex items-start gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-warning)]/24',
            'bg-[var(--fin-warning-soft)] px-3 py-2'
          )}
        >
          <Info aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" />
          <span className="fin-t-caption text-[var(--fin-warning-text)]">{parcial.mensagem}</span>
        </div>
      )}
      {children}
    </div>
  );
}

export default DataState;
