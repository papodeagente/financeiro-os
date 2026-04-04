'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { PILLAR_MENUS } from './PillarSidebar';
import { Logo } from './Logo';

const PILLAR_DESCRIPTIONS: Record<Pillar, string> = {
  planejamento: 'Custos, CAC e projetos',
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

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <aside className="w-[240px] bg-[var(--t-surface)] border-r border-[var(--t-border)] flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-[var(--t-border)]">
        <Logo variant="sidebar" href="/dashboard" className="mb-2" />
        <h2 className="text-[var(--text-body)] font-semibold text-[var(--t-text)] tracking-tight">
          {pillarConfig?.label}
        </h2>
        <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-0.5">
          {PILLAR_DESCRIPTIONS[activePillar]}
        </p>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="feature-panel-content" key={activePillar}>
          {sections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
              {section.title && (
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--t-text-muted)]">
                  {section.title}
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
                          ? 'bg-[var(--t-green)]/8 text-[var(--t-green)] font-medium'
                          : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--t-green)]" />
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
