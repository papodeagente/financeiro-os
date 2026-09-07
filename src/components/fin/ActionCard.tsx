'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export type ActionCardProps = {
  rotulo: string;
  descricao?: string;
  icone: LucideIcon;
  variante?: 'primaria' | 'secundaria';
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

const actionCardVariants = cva(
  cn(
    'group flex min-h-11 w-full items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border bg-[var(--fin-surface)] p-[var(--fin-s-4)] text-left no-underline shadow-[var(--fin-e0)] transition-colors duration-150',
    'hover:bg-[var(--fin-surface-2)]',
    'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
  ),
  {
    variants: {
      variante: {
        primaria: 'border-[var(--fin-accent)]',
        secundaria: 'border-[var(--fin-border)]',
      },
    },
    defaultVariants: {
      variante: 'secundaria',
    },
  },
);

const chipVariants = cva(
  'flex size-8 shrink-0 items-center justify-center rounded-[var(--fin-r-sm)]',
  {
    variants: {
      variante: {
        primaria: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
        secundaria: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]',
      },
    },
    defaultVariants: {
      variante: 'secundaria',
    },
  },
);

/**
 * Atalho de tela. Renderiza <a> sempre que recebe href, para que abrir em
 * nova aba, copiar o endereço e o leitor de tela funcionem.
 */
export function ActionCard(props: ActionCardProps) {
  const { rotulo, descricao, icone: Icone, variante = 'secundaria' } = props;
  const classe = cn(actionCardVariants({ variante }));

  const conteudo = (
    <>
      <span aria-hidden="true" className={cn(chipVariants({ variante }))}>
        <Icone className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{rotulo}</span>
        {descricao ? (
          <span className="fin-t-caption text-[var(--fin-text-3)]">{descricao}</span>
        ) : null}
      </span>
    </>
  );

  if (props.href) {
    return (
      <Link data-slot="fin-action-card" href={props.href} className={classe}>
        {conteudo}
      </Link>
    );
  }

  return (
    <button
      data-slot="fin-action-card"
      type="button"
      onClick={props.onClick}
      className={classe}
    >
      {conteudo}
    </button>
  );
}

export default ActionCard;
