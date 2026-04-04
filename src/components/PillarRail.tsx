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
    <aside className="w-[72px] bg-[var(--t-pillar-bg)] flex flex-col items-center shrink-0 border-r border-[var(--t-border)] z-40">
      {/* Logo */}
      <div className="pt-5 pb-4">
        <Link href="/dashboard" className="block">
          <div className="w-10 h-10 rounded-2xl bg-[var(--t-green)] flex items-center justify-center shadow-md shadow-[var(--t-green-shadow)]">
            <Logo variant="icon" className="text-[13px]" />
          </div>
        </Link>
      </div>

      {/* Pillar icons */}
      <nav className="flex-1 flex flex-col items-center gap-1 pt-2">
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
                  ? 'bg-[var(--t-green)] text-white shadow-md shadow-[var(--t-green-shadow)]'
                  : 'text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className={`text-[9px] font-medium mt-0.5 leading-none ${
                isActive ? 'text-white/90' : 'text-[var(--t-text-muted)] group-hover:text-[var(--t-text-secondary)]'
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
