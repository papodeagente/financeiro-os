'use client';

import { CrmStatusBadge } from './CrmStatusBadge';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  crmBadge?: boolean;
}

export function PageHeader({ title, subtitle, actions, crmBadge }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between pb-6 mb-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-[var(--text-display)] font-semibold text-[var(--t-text)] tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-[var(--text-body)] text-[var(--t-text-muted)] mt-1">{subtitle}</p>
          )}
        </div>
        {crmBadge && <CrmStatusBadge variant="completo" />}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
