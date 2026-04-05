'use client';

import { useEffect, useRef } from 'react';
import { AbaType } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';

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
    <div className="sticky top-0 z-10 bg-[var(--t-surface)] border-b border-[var(--t-border)] shrink-0" style={{ boxShadow: 'var(--elevation-1)' }}>
      <div className="flex items-center gap-1 px-2 py-2.5">
        {/* Prev button */}
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Stepper track */}
        <div ref={trackRef} className="stepper-track flex-1 py-1 px-1">
          {steps.map((step, i) => {
            const isActive = step === activeStep;
            const filled = hasData(step);

            // Connector before this node (except first)
            const connector = i > 0 ? (() => {
              const prevFilled = hasData(steps[i - 1]);
              const bothFilled = prevFilled && filled;
              const oneFilled = prevFilled || filled;
              return (
                <div
                  className={`h-[2px] min-w-[12px] flex-1 transition-colors duration-200 ${
                    bothFilled ? 'bg-[var(--t-status-success)]'
                    : oneFilled ? 'bg-[var(--t-status-success)]/30'
                    : 'bg-[var(--t-border)]'
                  }`}
                />
              );
            })() : null;

            return (
              <div key={step} className="contents">
                {connector}
                <button
                  data-step={step}
                  onClick={() => onStepClick(step)}
                  className={`flex flex-col items-center gap-0.5 min-w-[58px] px-1 py-1 rounded-lg transition-all duration-150 ${
                    isActive ? 'scale-105' : 'hover:bg-[var(--t-surface-hover)]'
                  }`}
                >
                  {/* Circle */}
                  <div className={`relative w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all duration-150 ${
                    isActive
                      ? 'bg-[var(--t-accent)] ring-2 ring-[var(--t-accent)]/25 shadow-sm'
                      : filled
                        ? 'bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/30'
                        : 'bg-[var(--t-surface)] border border-[var(--t-border)]'
                  }`}>
                    <span className={`text-xs leading-none ${
                      isActive ? 'brightness-0 invert' : filled ? '' : 'opacity-40'
                    }`}>
                      {icons[step]}
                    </span>
                    {/* Check badge for filled */}
                    {filled && !isActive && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--t-status-success)] flex items-center justify-center">
                        <Check className="w-2 h-2 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  {/* Label */}
                  <span className={`text-[9px] leading-tight whitespace-nowrap transition-colors duration-150 ${
                    isActive
                      ? 'text-[var(--t-accent)] font-semibold'
                      : filled
                        ? 'text-[var(--t-text)] font-medium'
                        : 'text-[var(--t-text-muted)]'
                  }`}>
                    {labels[step]}
                  </span>
                </button>
              </div>
            );
          })}

          {/* Price summary at the end */}
          {priceSummary && priceSummary.dblAvista > 0 && (
            <>
              <div className="h-[2px] min-w-[12px] flex-1 bg-[var(--t-border)]" />
              <div className="rounded-lg bg-[var(--t-header-bg)] text-[var(--t-header-text)] px-3 py-1.5 min-w-[130px] shrink-0 text-center">
                <div className="text-[9px] font-medium text-[var(--t-text-secondary)] uppercase tracking-wide">PAX (DBL)</div>
                <div className="text-sm font-bold">{formatBRL(priceSummary.dblAvista)}</div>
                <div className="text-[9px] text-[var(--t-text-secondary)]">
                  {priceSummary.parcelas}x {formatBRL(priceSummary.dblCartao)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Next button */}
        <button
          onClick={onNext}
          disabled={isLast}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
