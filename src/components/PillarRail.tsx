'use client';

import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { usePillarProgress } from '@/hooks/usePillarProgress';
import { Check } from 'lucide-react';

const SHORT_LABELS: Record<Pillar, string> = {
  planejamento: 'Planejar',
  metas: 'Metas',
  produtos: 'Produtos',
  financeiro: 'Financ.',
};

interface Props {
  /** Pilar com drawer aberto agora (independente da rota atual). `null` = nenhum. */
  openPillar: Pillar | null;
  /** Toggle: abre o drawer do pilar, ou fecha se já estava aberto. */
  onPillarToggle: (pillar: Pillar) => void;
}

export function PillarRail({ openPillar, onPillarToggle }: Props) {
  const activePillar = useActivePillar();
  const { visited } = usePillarProgress();

  return (
    <aside
      data-pillar-rail
      className="w-[80px] flex flex-col items-center shrink-0 z-40"
      style={{ background: 'var(--t-pillar-gradient)' }}
    >
      {/* Top spacer */}
      <div className="pt-6" />

      {/* Journey steps */}
      <nav className="flex-1 flex flex-col items-center justify-center gap-[50px]">
        {PILLARS.map((pillar, index) => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;
          const isOpen = openPillar === pillar.id;
          const isVisited = visited.has(pillar.id);
          const stepNum = index + 1;

          return (
            <div key={pillar.id} className="flex flex-col items-center relative">
              {/* Connector line (não antes do primeiro) */}
              {index > 0 && (
                <div
                  className={`absolute -top-[30px] left-1/2 -translate-x-1/2 w-[2px] h-[12px] rounded-full ${
                    isVisited || visited.has(PILLARS[index - 1].id) ? 'bg-white/35' : 'bg-white/12'
                  }`}
                />
              )}

              <button
                type="button"
                onClick={() => onPillarToggle(pillar.id)}
                aria-expanded={isOpen}
                aria-controls="pillar-drawer"
                aria-label={`${pillar.label} – ${isOpen ? 'fechar' : 'abrir'} menu`}
                title={pillar.label}
                className={`group relative flex flex-col items-center justify-center w-16 h-16 rounded-2xl transition-all duration-200 ${
                  isActive || isOpen
                    ? 'pillar-current'
                    : 'hover:bg-white/8'
                } ${isOpen ? 'ring-2 ring-white/60 ring-offset-0' : ''}`}
                style={isActive || isOpen ? {
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.15)',
                } : undefined}
              >
                {/* Step number badge */}
                <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                  isActive || isOpen
                    ? 'bg-white text-[#004aad]'
                    : isVisited
                      ? 'bg-white/25 text-white'
                      : 'bg-white/10 text-white/50'
                }`}>
                  {isVisited && !isActive && !isOpen ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    stepNum
                  )}
                </span>

                {/* Icon */}
                <Icon className={`w-6 h-6 transition-colors ${
                  isActive || isOpen
                    ? 'text-white'
                    : 'text-[var(--t-pillar-rail-text)] group-hover:text-[var(--t-pillar-rail-text-active)]'
                }`} />

                {/* Label */}
                <span className={`text-[9px] mt-1.5 leading-none tracking-wide uppercase transition-colors ${
                  isActive || isOpen
                    ? 'font-bold text-white'
                    : 'font-medium text-[var(--t-pillar-rail-text)] group-hover:text-[var(--t-pillar-rail-text-active)]'
                }`}>
                  {SHORT_LABELS[pillar.id]}
                </span>
              </button>
            </div>
          );
        })}
      </nav>

      {/* Bottom spacer */}
      <div className="pb-6" />
    </aside>
  );
}
