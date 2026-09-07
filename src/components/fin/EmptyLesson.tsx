'use client';

import Link from 'next/link';
import { FileQuestion, Inbox, SearchX, TriangleAlert, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EmptyLessonMotivo = 'sem-dado' | 'sem-resultado' | 'erro';

export type EmptyLessonProps = {
  motivo: EmptyLessonMotivo;
  titulo: string;
  /** "Aqui aparecem as contas que a agência precisa pagar." */
  oQueE: string;
  /** 1 a 3 passos curtos. Só quando motivo === 'sem-dado'. */
  comoComeca?: string[];
  acao?: { rotulo: string; href?: string; onClick?: () => void };
  acaoSecundaria?: { rotulo: string; onClick: () => void };
  /** Amostra esmaecida do que vai aparecer. aria-hidden. */
  exemplo?: React.ReactNode;
  className?: string;
};

const ICONE: Record<EmptyLessonMotivo, LucideIcon> = {
  'sem-dado': Inbox,
  'sem-resultado': SearchX,
  erro: TriangleAlert,
};

const MOLDURA_ICONE: Record<EmptyLessonMotivo, string> = {
  'sem-dado': 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
  'sem-resultado': 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]',
  erro: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
};

const BOTAO_PRIMARIO = [
  'h-11 lg:h-10 rounded-[var(--fin-r-md)] px-4 fin-t-body-strong',
  'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] shadow-none',
  'hover:bg-[var(--fin-accent-hover)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
].join(' ');

const BOTAO_SECUNDARIO = [
  'h-11 lg:h-10 rounded-[var(--fin-r-md)] px-4 fin-t-body',
  'border border-[var(--fin-border)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] shadow-none',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
].join(' ');

export function EmptyLesson({
  motivo,
  titulo,
  oQueE,
  comoComeca,
  acao,
  acaoSecundaria,
  exemplo,
  className,
}: EmptyLessonProps) {
  const Icone = ICONE[motivo] ?? FileQuestion;
  // A lição de primeiros passos só faz sentido quando ainda não existe nada cadastrado.
  const passos = motivo === 'sem-dado' ? (comoComeca ?? []).slice(0, 3) : [];

  return (
    <div
      data-slot="fin-empty-lesson"
      data-motivo={motivo}
      role={motivo === 'erro' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]',
        'bg-[var(--fin-surface)] px-6 py-10 text-center',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--fin-r-md)]',
          MOLDURA_ICONE[motivo]
        )}
      >
        <Icone className="h-5 w-5" />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <h3 className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h3>
        <p className="fin-t-body text-[var(--fin-text-2)]">{oQueE}</p>
      </div>

      {passos.length > 0 && (
        <ol className="flex max-w-md flex-col gap-2 text-left">
          {passos.map((passo, i) => (
            <li key={passo} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--fin-r-dot)] bg-[var(--fin-surface-2)] fin-t-overline text-[var(--fin-text-3)]"
              >
                {i + 1}
              </span>
              <span className="fin-t-caption text-[var(--fin-text-2)]">{passo}</span>
            </li>
          ))}
        </ol>
      )}

      {(acao || acaoSecundaria) && (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
          {acao?.href ? (
            <Button className={BOTAO_PRIMARIO} render={<Link href={acao.href} />}>
              {acao.rotulo}
            </Button>
          ) : acao?.onClick ? (
            <Button className={BOTAO_PRIMARIO} onClick={acao.onClick}>
              {acao.rotulo}
            </Button>
          ) : null}
          {acaoSecundaria && (
            <Button className={BOTAO_SECUNDARIO} onClick={acaoSecundaria.onClick}>
              {acaoSecundaria.rotulo}
            </Button>
          )}
        </div>
      )}

      {exemplo && (
        <div aria-hidden="true" className="pointer-events-none w-full max-w-lg select-none opacity-40">
          {exemplo}
        </div>
      )}
    </div>
  );
}

export default EmptyLesson;
