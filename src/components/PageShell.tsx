'use client';

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

const WIDTHS: Record<Width, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-[1400px]',
  wide: 'max-w-[1600px]',
  full: '',
};

const PADS: Record<Padding, string> = {
  none: '',
  sm: 'px-4 py-4',
  md: 'px-6 py-6',
  lg: 'px-8 py-8',
};

const GAPS: Record<Gap, string> = {
  sm: 'space-y-4',
  md: 'space-y-6',
  lg: 'space-y-8',
};

const BGS: Record<Background, string> = {
  default: 'bg-[var(--t-bg)]',
  muted: 'bg-[var(--t-surface)]',
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
  const outerClasses = [BGS[background], PADS[padding], 'w-full'].filter(Boolean).join(' ');
  const innerClasses = [WIDTHS[width], GAPS[gap], 'mx-auto', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div id={id} className={outerClasses}>
      <div className={innerClasses}>
        {header}
        {children}
      </div>
    </div>
  );
}
