'use client';

import { useEffect, useRef } from 'react';
import { AbaType } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, LayoutDashboard, Info, Plane, Hotel,
  MapPin, Car, UserCheck, Shield, Ship, Ticket, Gift, Megaphone,
  DollarSign, BarChart3, Check,
} from 'lucide-react';

// Map each tab to a Lucide icon
const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pipeline: LayoutDashboard,
  inf: Info,
  tkt: Plane,
  htl: Hotel,
  rec: MapPin,
  car: Car,
  guia: UserCheck,
  seg: Shield,
  navio: Ship,
  ing: Ticket,
  brinde: Gift,
  divulgacao: Megaphone,
  proposta: DollarSign,
  htl_seg: BarChart3,
};

interface GroupStepperProps {
  steps: AbaType[];
  activeStep: AbaType;
  onStepClick: (aba: AbaType) => void;
  onNext: () => void;
  onPrev: () => void;
  hasData: (aba: AbaType) => boolean;
  icons: Record<string, string>;
  labels: Record<string, string>;
  priceSummary: { dblAvista: number; dblCartao: number; parcelas: number } | null;
}

export function GroupStepper({ steps, activeStep, onStepClick, onNext, onPrev, hasData, icons, labels, priceSummary }: GroupStepperProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activeIdx = steps.indexOf(activeStep);
  const isFirst = activeIdx === 0;
  const isLast = activeIdx === steps.length - 1;

  // Auto-scroll to active step
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const activeNode = track.querySelector(`[data-step="${activeStep}"]`) as HTMLElement | null;
    if (activeNode) {
      activeNode.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeStep]);

  return (
    <div className="sticky top-0 z-10 bg-[var(--t-surface)] border-b border-[var(--t-border)] shrink-0">
      <div className="flex items-center">
        {/* Prev button */}
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="w-10 h-full flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors disabled:opacity-20 disabled:pointer-events-none shrink-0 border-r border-[var(--t-border)]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Navigation track */}
        <div
          ref={trackRef}
          className="flex-1 flex items-stretch overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {steps.map((step) => {
            const isActive = step === activeStep;
            const filled = hasData(step);
            const IconComp = STEP_ICONS[step];

            return (
              <button
                key={step}
                data-step={step}
                onClick={() => onStepClick(step)}
                className={`relative flex flex-col items-center gap-1 min-w-[72px] px-3 py-2.5 transition-all duration-150 shrink-0 ${
                  isActive
                    ? 'text-[var(--t-accent)]'
                    : filled
                      ? 'text-[var(--t-text)] hover:bg-[var(--t-surface-hover)]'
                      : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)]'
                }`}
              >
                {/* Icon */}
                <div className="relative">
                  {IconComp && (
                    <IconComp className={`w-5 h-5 transition-colors duration-150 ${
                      isActive
                        ? 'text-[var(--t-accent)]'
                        : filled
                          ? 'text-[var(--t-text)]'
                          : 'text-[var(--t-text-muted)]'
                    }`} />
                  )}
                  {/* Filled indicator dot */}
                  {filled && !isActive && (
                    <div className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-[var(--t-status-success)] flex items-center justify-center">
                      <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>

                {/* Label */}
                <span className={`text-[10px] leading-tight whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? 'font-bold'
                    : filled
                      ? 'font-medium'
                      : 'font-normal'
                }`}>
                  {labels[step]}
                </span>

                {/* Active underline */}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-[var(--t-accent)]" />
                )}
              </button>
            );
          })}

          {/* Price summary pill */}
          {priceSummary && priceSummary.dblAvista > 0 && (
            <div className="flex items-center px-3 shrink-0">
              <div className="rounded-lg bg-[var(--t-header-bg)] text-[var(--t-header-text)] px-4 py-1.5 text-center">
                <div className="text-[9px] font-medium text-[var(--t-text-secondary)] uppercase tracking-wide">PAX (DBL)</div>
                <div className="text-sm font-bold">{formatBRL(priceSummary.dblAvista)}</div>
                <div className="text-[9px] text-[var(--t-text-secondary)]">
                  {priceSummary.parcelas}x {formatBRL(priceSummary.dblCartao)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Next button */}
        <button
          onClick={onNext}
          disabled={isLast}
          className="w-10 h-full flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors disabled:opacity-20 disabled:pointer-events-none shrink-0 border-l border-[var(--t-border)]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
