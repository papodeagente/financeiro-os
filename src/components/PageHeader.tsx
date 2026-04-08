'use client';

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
  /** Stick to top with translucent backdrop. */
  sticky?: boolean;
  /** Bottom border (default true). */
  bordered?: boolean;
  /** Title size — md uses --text-display (default). */
  size?: Size;
  className?: string;
}

const TITLE_SIZE: Record<Size, string> = {
  sm: 'text-[var(--text-h2)]',
  md: 'text-[var(--text-display)]',
  lg: 'text-[var(--text-display-lg,var(--text-display))]',
};

export function PageHeader({
  title,
  subtitle,
  actions,
  crmBadge,
  breadcrumb,
  badge,
  icon,
  sticky = false,
  bordered = true,
  size = 'md',
  className,
}: PageHeaderProps) {
  const wrapperClasses = [
    'flex items-center justify-between pb-6 mb-6',
    bordered ? 'border-b border-[var(--t-border)]' : '',
    sticky ? 'sticky top-0 z-20 bg-[var(--t-surface)]/85 backdrop-blur-md -mx-6 px-6 pt-4' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-[var(--t-accent)]/10 flex items-center justify-center text-[var(--t-accent)] shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className={`${TITLE_SIZE[size]} font-semibold text-[var(--t-text)] tracking-tight truncate`}>
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="text-[var(--text-body)] text-[var(--t-text-muted)] mt-1">{subtitle}</p>
          )}
        </div>
        {crmBadge && <CrmStatusBadge variant="completo" />}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
