'use client';

import Link from 'next/link';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { usePillarProgress } from '@/hooks/usePillarProgress';
import { Logo } from './Logo';
import { Check } from 'lucide-react';

const PILLAR_ROUTES: Record<Pillar, string> = {
  planejamento: '/cac/dashboard',
  metas: '/dashboard',
  produtos: '/grupos',
  financeiro: '/financeiro-ag',
};

const SHORT_LABELS: Record<Pillar, string> = {
  planejamento: 'Planejar',
  metas: 'Metas',
  produtos: 'Produtos',
  financeiro: 'Financ.',
};

interface Props {
  onPillarClick?: (pillar: Pillar) => void;
}

export function PillarRail({ onPillarClick }: Props) {
  const activePillar = useActivePillar();
  const { visited } = usePillarProgress();

  return (
    <aside
      className="w-[80px] flex flex-col items-center shrink-0 z-40"
      style={{ background: 'var(--t-pillar-gradient)' }}
    >
      {/* Logo */}
      <div className="pt-4 pb-2">
        <Logo variant="icon" href="/dashboard" className="opacity-90 hover:opacity-100 transition-opacity" />
      </div>

      {/* Separator */}
      <div className="w-8 h-px bg-white/10 mb-3" />

      {/* Journey steps */}
      <nav className="flex-1 flex flex-col items-center pt-1">
        {PILLARS.map((pillar, index) => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;
          const isVisited = visited.has(pillar.id);
          const stepNum = index + 1;

          return (
            <div key={pillar.id} className="flex flex-col items-center">
              {/* Connector line (not before first) */}
              {index > 0 && (
                <div className={`pillar-connector ${isVisited || visited.has(PILLARS[index - 1].id) ? 'visited' : ''}`} />
              )}

              {/* Step button */}
              <Link
                href={PILLAR_ROUTES[pillar.id]}
                onClick={() => onPillarClick?.(pillar.id)}
                title={pillar.label}
                className={`group relative flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all duration-200 ${
                  isActive
                    ? 'pillar-current'
                    : 'hover:bg-white/8'
                }`}
                style={isActive ? {
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.15)',
                } : undefined}
              >
                {/* Step number badge */}
                <span className={`absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                  isActive
                    ? 'bg-white text-[#004aad]'
                    : isVisited
                      ? 'bg-white/25 text-white'
                      : 'bg-white/10 text-white/50'
                }`}>
                  {isVisited && !isActive ? (
                    <Check className="w-2.5 h-2.5" />
                  ) : (
                    stepNum
                  )}
                </span>

                {/* Icon */}
                <Icon className={`w-[22px] h-[22px] transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-[var(--t-pillar-rail-text)] group-hover:text-[var(--t-pillar-rail-text-active)]'
                }`} />

                {/* Label */}
                <span className={`text-[9px] mt-1 leading-none tracking-wide uppercase transition-colors ${
                  isActive
                    ? 'font-bold text-white'
                    : 'font-medium text-[var(--t-pillar-rail-text)] group-hover:text-[var(--t-pillar-rail-text-active)]'
                }`}>
                  {SHORT_LABELS[pillar.id]}
                </span>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Bottom spacer */}
      <div className="pb-4" />
    </aside>
  );
}
