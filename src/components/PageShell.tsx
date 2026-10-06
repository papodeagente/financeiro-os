'use client';

import { cn } from '@/lib/utils';

type Width = 'narrow' | 'default' | 'wide' | 'full';
type Padding = 'none' | 'sm' | 'md' | 'lg';
type Gap = 'sm' | 'md' | 'lg';
type Background = 'default' | 'muted' | 'transparent';

interface PageShellProps {
  children: React.ReactNode;
  /** Slot rendered above the content (typically a <PageHeader />). */
  header?: React.ReactNode;
  /** Container max-width preset. */
  width?: Width;
  /** Outer padding preset. */
  padding?: Padding;
  /** Vertical gap between top-level children. */
  gap?: Gap;
  /** Background color. */
  background?: Background;
  className?: string;
  id?: string;
}

/**
 * Moldura das telas que ainda usam a API antiga. Mesmas decisões da
 * MolduraDaPagina: respiro lateral --fin-page-pad (16/24/32px conforme a
 * largura), leitura até --fin-page-max e ritmo vertical pelos tokens.
 * 'wide' e 'full' existem para tela operacional (tabela larga, quadro).
 */
const WIDTHS: Record<Width, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-[var(--fin-page-max)]',
  wide: 'max-w-[1600px]',
  full: '',
};

const PADS: Record<Padding, string> = {
  none: '',
  sm: 'px-[var(--fin-s-4)] py-[var(--fin-s-4)]',
  md: 'px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]',
  lg: 'px-[var(--fin-page-pad)] py-[var(--fin-s-6)]',
};

const GAPS: Record<Gap, string> = {
  sm: 'space-y-[var(--fin-s-4)]',
  md: 'space-y-[var(--fin-s-5)]',
  lg: 'space-y-[var(--fin-s-6)]',
};

const BGS: Record<Background, string> = {
  default: 'bg-[var(--fin-bg)]',
  muted: 'bg-[var(--fin-surface)]',
  transparent: '',
};

export function PageShell({
  children,
  header,
  width = 'default',
  padding = 'md',
  gap = 'md',
  background = 'transparent',
  className,
  id,
}: PageShellProps) {
  return (
    <div id={id} className={cn(BGS[background], PADS[padding], 'w-full text-[var(--fin-text)]')}>
      <div className={cn(WIDTHS[width], GAPS[gap], 'mx-auto w-full', className)}>
        {header}
        {children}
      </div>
    </div>
  );
}
