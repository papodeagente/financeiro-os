'use client';

import { cn } from '@/lib/utils';
import { CrmStatusBadge } from './CrmStatusBadge';

type Size = 'sm' | 'md' | 'lg';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  crmBadge?: boolean;
  /** Slot rendered above the title (e.g. <Breadcrumbs />). */
  breadcrumb?: React.ReactNode;
  /** Slot rendered inline next to the title (e.g. status badge). */
  badge?: React.ReactNode;
  /** Optional 40x40 leading icon. */
  icon?: React.ReactNode;
  /** Stick to top. */
  sticky?: boolean;
  /** Mantido por compatibilidade: o cabeçalho do sistema não tem borda. */
  bordered?: boolean;
  /** Mantido por compatibilidade: título de página tem um tamanho só. */
  size?: Size;
  className?: string;
}

/**
 * Cabeçalho das telas que ainda usam a API antiga (title/actions).
 *
 * Desenha EXATAMENTE como o fin/PageHeader: título fin-t-title (24px),
 * subtítulo em caption, ações à direita no desktop e numa faixa abaixo no
 * celular. Antes ele usava --text-display, uma variável que não existia
 * mais, e o título saía do tamanho do texto comum.
 *
 * Tela nova usa @/components/fin/PageHeader (ação primária explícita).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  crmBadge,
  breadcrumb,
  badge,
  icon,
  sticky = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="fin-page-header"
      className={cn(
        'mb-[var(--fin-s-5)] flex flex-col gap-[var(--fin-s-3)] lg:min-h-14 lg:flex-row lg:items-start lg:justify-between',
        sticky && 'sticky top-0 z-[var(--fin-z-cabecalho)] -mx-[var(--fin-page-pad)] bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-s-3)]',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-[var(--fin-s-3)]">
        {icon && (
          <div aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
            {icon}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
          {breadcrumb && <div>{breadcrumb}</div>}
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--fin-s-2)]">
            <h1 className="fin-t-title min-w-0 truncate text-[var(--fin-text)]">{title}</h1>
            {badge}
            {crmBadge && <CrmStatusBadge variant="completo" />}
          </div>
          {subtitle && <p className="fin-t-caption text-[var(--fin-text-3)]">{subtitle}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)] lg:shrink-0 lg:justify-end">{actions}</div>
      )}
    </header>
  );
}
