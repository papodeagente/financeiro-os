'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { PILLAR_MENUS } from './PillarSidebar';

const PILLAR_DESCRIPTIONS: Record<Pillar, string> = {
  planejamento: 'Custos, CAC e cenários',
  metas: 'KPIs, metas e comissões',
  produtos: 'Grupos, propostas e vendas',
  financeiro: 'Contas, relatórios e CRM',
};

export function FeaturePanel() {
  const pathname = usePathname();
  const activePillar = useActivePillar();

  if (!activePillar) return null;

  const sections = PILLAR_MENUS[activePillar];
  const pillarConfig = PILLARS.find(p => p.id === activePillar);
  const PillarIcon = pillarConfig?.icon;

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <aside className="w-[240px] bg-[var(--t-surface)] border-r border-[var(--t-border)] flex flex-col shrink-0 overflow-hidden">
      {/* Header with pillar context */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--t-border)]">
        <div className="flex items-center gap-3">
          {/* Pillar icon badge */}
          {PillarIcon && (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--t-primary-bg)' }}>
              <PillarIcon className="w-[18px] h-[18px] text-[var(--t-green)]" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-[var(--text-body)] font-semibold text-[var(--t-text)] tracking-tight leading-tight">
              {pillarConfig?.label}
            </h2>
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-0.5 leading-tight">
              {PILLAR_DESCRIPTIONS[activePillar]}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="feature-panel-content" key={activePillar}>
          {sections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? 'mt-4' : 'mt-2'}>
              {section.title && (
                <div className="flex items-center gap-2 px-3 mb-1.5">
                  <span className="flex-1 h-px bg-[var(--t-border)]" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--t-text-muted)]">
                    {section.title}
                  </span>
                  <span className="flex-1 h-px bg-[var(--t-border)]" />
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 text-[var(--text-body-sm)] rounded-xl transition-all duration-150 relative group ${
                        active
                          ? 'bg-gradient-to-r from-[var(--t-green)]/8 to-transparent text-[var(--t-green)] font-medium'
                          : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] hover:translate-x-0.5'
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                          style={{ background: 'var(--t-accent-gradient)' }}
                        />
                      )}
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                        active ? '' : 'text-[var(--t-text-muted)] group-hover:text-[var(--t-text-secondary)]'
                      }`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}
