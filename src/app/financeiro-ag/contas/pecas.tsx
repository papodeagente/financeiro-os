'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';

import { cn, formatBRL } from '@/lib/utils';

/** Peças pequenas dos diálogos de lote (05/11/2026). */

export const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body text-[var(--fin-text)] lg:h-10';
export const SELECT = cn(
  CAMPO,
  'w-full border px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
);

export function Rotulo({ texto, children, ajuda }: { texto: string; children: React.ReactNode; ajuda?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 fin-t-caption text-[var(--fin-text-3)]">
      <span className="fin-t-body-strong text-[var(--fin-text-2)]">{texto}</span>
      {children}
      {ajuda ? <span>{ajuda}</span> : null}
    </label>
  );
}

export interface ItemDaPrevia {
  chave: string;
  titulo: string;
  detalhe: string;
  ok: boolean;
  valor?: number;
  /** "de → para" ou a consequência. */
  nota?: string;
  aviso?: string;
}

export interface ItemDeFora {
  chave: string;
  titulo: string;
  detalhe: string;
  motivo: string;
}

/**
 * A prévia conta por conta: o que muda (com o "de → para") e, à parte, o que
 * fica de fora e por quê. Nada aqui grava.
 */
export function ListaDaPrevia({
  titulo, itens, fora, carregando, concluido = false,
}: {
  titulo: string;
  itens: ItemDaPrevia[];
  fora: ItemDeFora[];
  carregando?: boolean;
  /** Depois de gravar: o mesmo desenho, dizendo que foi feito. */
  concluido?: boolean;
}) {
  if (carregando) {
    return (
      <div aria-busy="true" className="flex flex-col gap-[var(--fin-s-2)]">
        {[0, 1, 2].map(i => <span key={i} className="block h-12 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />)}
        <span className="sr-only" role="status">Calculando a prévia.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      {itens.length > 0 ? (
        <section aria-label={titulo} className="flex flex-col">
          <h3 className="pb-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">
            {titulo} <span className="font-normal tabular-nums text-[var(--fin-text-3)]">({itens.length})</span>
          </h3>
          <ul className="max-h-72 overflow-y-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
            {itens.map(i => (
              <li key={i.chave} className="flex items-start gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] last:border-b-0">
                <span aria-hidden="true" className={cn('mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full', concluido ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' : 'text-[var(--fin-accent)]')}>
                  <Check className="size-3" />
                </span>
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate fin-t-body text-[var(--fin-text)]" title={i.titulo}>{i.titulo}</span>
                  {i.detalhe ? <span className="truncate fin-t-caption text-[var(--fin-text-3)]" title={i.detalhe}>{i.detalhe}</span> : null}
                  {i.nota ? <span className="fin-t-caption text-[var(--fin-text-2)]">{i.nota}</span> : null}
                  {i.aviso ? <span className="fin-t-caption text-[var(--fin-warning-text)]">{i.aviso}</span> : null}
                </span>
                {i.valor !== undefined ? <span className="shrink-0 fin-t-body-strong tabular-nums text-[var(--fin-text)]">{formatBRL(i.valor)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {fora.length > 0 ? (
        <section aria-label="Ficam de fora" className="flex flex-col">
          <h3 className="pb-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">
            Ficam de fora <span className="font-normal tabular-nums text-[var(--fin-text-3)]">({fora.length})</span>
          </h3>
          <ul className="max-h-48 overflow-y-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)]">
            {fora.map(f => (
              <li key={f.chave} className="flex items-start gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] last:border-b-0">
                <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate fin-t-body text-[var(--fin-text-2)]" title={f.titulo}>{f.titulo}{f.detalhe ? <span className="text-[var(--fin-text-3)]"> · {f.detalhe}</span> : null}</span>
                  <span className="fin-t-caption text-[var(--fin-text-2)]">{f.motivo}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {itens.length === 0 && fora.length === 0 ? (
        <p className="fin-t-body text-[var(--fin-text-3)]">Escolha o que mudar para ver a prévia.</p>
      ) : null}
    </div>
  );
}
