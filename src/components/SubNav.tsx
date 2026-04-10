'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, type Pillar } from '@/hooks/useActivePillar';
import { PILLAR_MENUS } from './PillarSidebar';

export function SubNav() {
  const pathname = usePathname();
  const activePillar = useActivePillar();

  if (!activePillar) return null;

  const sections = PILLAR_MENUS[activePillar];

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  const allItems = sections.flatMap((section, sIdx) => {
    const items = section.items.map(item => ({ ...item, sectionTitle: section.title }));
    if (sIdx > 0 && section.title) {
      return [{ key: `divider-${sIdx}`, divider: true, sectionTitle: section.title }, ...items] as const;
    }
    return items;
  });

  return (
    <div className="h-[40px] bg-[var(--t-surface)] border-b border-[var(--t-border)] flex items-center px-6 shrink-0 overflow-x-auto z-30">
      <nav className="subnav-content flex items-center gap-1" key={activePillar}>
        {allItems.map((item) => {
          if ('divider' in item && item.divider) {
            return (
              <span key={item.key} className="flex items-center gap-1 ml-1">
                <span className="w-px h-4 bg-[var(--t-border)]" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-1.5">
                  {item.sectionTitle}
                </span>
              </span>
            );
          }

          const navItem = item as { key: string; label: string; icon: React.ComponentType<{ className?: string }>; href: string };
          const Icon = navItem.icon;
          const active = isActive(navItem.href);

          return (
            <Link
              key={navItem.key}
              href={navItem.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-body-sm)] whitespace-nowrap transition-colors duration-150 ${
                active
                  ? 'bg-[var(--t-green)]/10 text-[var(--t-green)] font-medium'
                  : 'text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{navItem.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
