'use client';

import Link from 'next/link';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { Logo } from './Logo';

const PILLAR_ROUTES: Record<Pillar, string> = {
  planejamento: '/cac/dashboard',
  metas: '/dashboard',
  produtos: '/grupos',
  financeiro: '/financeiro-ag',
};

interface Props {
  onPillarClick?: (pillar: Pillar) => void;
}

export function PillarRail({ onPillarClick }: Props) {
  const activePillar = useActivePillar();

  return (
    <aside
      className="w-[72px] flex flex-col items-center shrink-0 border-r border-[var(--t-border)] z-40"
      style={{ background: 'var(--t-pillar-gradient)' }}
    >
      {/* Pillar icons */}
      <nav className="flex-1 flex flex-col items-center gap-2 pt-5">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={PILLAR_ROUTES[pillar.id]}
              onClick={() => onPillarClick?.(pillar.id)}
              title={pillar.label}
              className={`group relative flex flex-col items-center justify-center w-12 h-12 rounded-2xl transition-all duration-200 ${
                isActive
                  ? 'text-white'
                  : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
              }`}
              style={isActive ? {
                background: 'var(--t-accent-gradient)',
                boxShadow: '0 2px 12px var(--t-green-shadow), inset 0 1px 0 rgba(255,255,255,0.15)',
              } : undefined}
            >
              <Icon className="w-[22px] h-[22px]" />
              <span className={`text-[10px] mt-0.5 leading-none ${
                isActive ? 'font-semibold text-white/90' : 'font-medium text-[var(--t-text-muted)] group-hover:text-[var(--t-text-secondary)]'
              }`}>
                {pillar.label.slice(0, 4)}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom spacer */}
      <div className="pb-4" />
    </aside>
  );
}
