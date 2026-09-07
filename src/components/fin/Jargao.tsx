'use client';

import { CircleHelp } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type JargaoProps = {
  /** "Resultado do mês" */
  comum: string;
  /** "DRE" */
  tecnico: string;
  explicacao: string;
  comoCalcula?: string;
  /** 'inline' põe o técnico entre parênteses; 'subtitulo' põe embaixo. */
  formato?: 'inline' | 'subtitulo';
  className?: string;
};

export function Jargao({ comum, tecnico, explicacao, comoCalcula, formato = 'inline', className }: JargaoProps) {
  const gatilho = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          aria-label={`O que é ${comum}`}
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-[var(--fin-r-dot)]',
            'h-4 w-4 align-middle text-[var(--fin-text-3)] transition-colors',
            'hover:text-[var(--fin-accent)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
            // Alvo de toque de 44px abaixo de 1024px, sem alterar o desenho.
            "before:absolute before:top-1/2 before:left-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] lg:before:h-6 lg:before:w-6"
          )}
        >
          <CircleHelp aria-hidden="true" className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className={cn(
            'max-w-xs flex-col items-start gap-2 rounded-[var(--fin-r-md)] p-3',
            'bg-[var(--fin-surface)] text-[var(--fin-text)] shadow-[var(--fin-e2)] ring-1 ring-[var(--fin-border)]',
            // A seta é o único filho <div> do balão; segue a mesma superfície.
            '[&>div]:bg-[var(--fin-surface)] [&>div]:fill-[var(--fin-surface)]'
          )}
        >
          <span className="fin-t-overline text-[var(--fin-text-3)]">{tecnico}</span>
          <span className="fin-t-caption text-[var(--fin-text-2)]">{explicacao}</span>
          {comoCalcula ? (
            <span className="fin-t-caption text-[var(--fin-text-3)]">Como calcula: {comoCalcula}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (formato === 'subtitulo') {
    return (
      <span className={cn('inline-flex flex-col gap-1', className)} data-slot="fin-jargao">
        <span className="inline-flex items-center gap-2">
          <span>{comum}</span>
          {gatilho}
        </span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{tecnico}</span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-slot="fin-jargao">
      <span>
        {comum} <span className="fin-t-caption text-[var(--fin-text-3)]">({tecnico})</span>
      </span>
      {gatilho}
    </span>
  );
}

export default Jargao;
