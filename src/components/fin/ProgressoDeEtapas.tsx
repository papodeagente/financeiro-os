'use client';

/**
 * Onde a pessoa está num caminho de poucas etapas.
 *
 * Existe porque configurar nota fiscal deixou de ser um formulário e virou um
 * caminho: quem está no meio precisa saber quanto falta e que já passou pelo
 * começo. Três ou quatro etapas no máximo — acima disso a barra vira decoração.
 */

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProgressoDeEtapasProps {
  /** Rótulos curtos, na ordem. Duas palavras cada, no máximo. */
  etapas: string[];
  /** Índice da etapa atual, a partir de 0. */
  atual: number;
}

export function ProgressoDeEtapas({ etapas, atual }: ProgressoDeEtapasProps) {
  return (
    <ol
      className="flex w-full items-start gap-1"
      aria-label={`Etapa ${Math.min(atual + 1, etapas.length)} de ${etapas.length}`}
    >
      {etapas.map((etapa, i) => {
        const feita = i < atual;
        const agora = i === atual;
        return (
          <li
            key={etapa}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            aria-current={agora ? 'step' : undefined}
          >
            <div className="flex w-full items-center gap-1">
              {/* A linha à esquerda só existe do segundo item em diante, e é
                  ela que dá a sensação de trilha em vez de três bolinhas. */}
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1',
                  i === 0 ? 'opacity-0' : feita || agora ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-border)]',
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                  feita && 'border-[var(--fin-accent)] bg-[var(--fin-accent)] text-white',
                  agora && 'border-[var(--fin-accent)] text-[var(--fin-accent)]',
                  !feita && !agora && 'border-[var(--fin-border-strong)] text-[var(--fin-text-3)]',
                )}
              >
                {feita ? <Check className="size-3" /> : i + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1',
                  i === etapas.length - 1 ? 'opacity-0' : feita ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-border)]',
                )}
              />
            </div>
            <span
              className={cn(
                'fin-t-caption w-full truncate text-center',
                agora ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]',
              )}
            >
              {etapa}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
