'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { AbaType } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, LayoutDashboard, Info, Plane, Hotel,
  MapPin, Car, UserCheck, Shield, Ship, Ticket, Gift, Megaphone,
  DollarSign, BarChart3, Check,
} from 'lucide-react';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/components/ui/tooltip';

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

  // Track previously-filled steps for pulse animation
  const prevFilledRef = useRef<Set<AbaType>>(new Set());
  const [pulsingSteps, setPulsingSteps] = useState<Set<AbaType>>(new Set());

  // Off-screen step counts for arrow badges
  const [offscreen, setOffscreen] = useState({ left: 0, right: 0 });

  // Auto-scroll active step into view
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const activeNode = track.querySelector(`[data-step="${activeStep}"]`) as HTMLElement | null;
    if (activeNode) {
      activeNode.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeStep]);

  // Detect newly-filled steps → trigger pulse
  useEffect(() => {
    const currentFilled = new Set(steps.filter(s => hasData(s)));
    const newlyFilled = steps.filter(s => currentFilled.has(s) && !prevFilledRef.current.has(s));
    if (newlyFilled.length > 0) {
      setPulsingSteps(new Set(newlyFilled));
      const timeout = setTimeout(() => setPulsingSteps(new Set()), 600);
      prevFilledRef.current = currentFilled;
      return () => clearTimeout(timeout);
    }
    prevFilledRef.current = currentFilled;
  }, [steps, hasData]);

  // Calculate off-screen counts
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let rafId: number;
    const calculate = () => {
      const trackRect = track.getBoundingClientRect();
      let left = 0;
      let right = 0;
      const stepEls = track.querySelectorAll<HTMLElement>('[data-step]');
      stepEls.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right < trackRect.left + 4) left++;
        else if (r.left > trackRect.right - 4) right++;
      });
      setOffscreen(prev => (prev.left === left && prev.right === right) ? prev : { left, right });
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(calculate);
    };

    calculate();
    track.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      track.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [steps]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const idx = steps.indexOf(activeStep);
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (idx < steps.length - 1) onStepClick(steps[idx + 1]);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (idx > 0) onStepClick(steps[idx - 1]);
        break;
      case 'Home':
        e.preventDefault();
        onStepClick(steps[0]);
        break;
      case 'End':
        e.preventDefault();
        onStepClick(steps[steps.length - 1]);
        break;
    }
  }, [steps, activeStep, onStepClick]);

  return (
    <div
      className="sticky top-0 z-10 bg-[var(--t-surface)] border-b border-[var(--t-border)] shrink-0"
      role="tablist"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Etapas do grupo"
    >
      <div className="flex items-center">
        {/* Left arrow */}
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="stepper-arrow relative w-12 self-stretch flex items-center justify-center text-[var(--t-text-muted)] shrink-0 border-r border-[var(--t-border)]"
          aria-label="Etapa anterior"
        >
          <ChevronLeft className="w-5 h-5 transition-transform duration-150 group-hover:-translate-x-0.5" />
          {offscreen.left > 0 && (
            <span className="stepper-arrow-badge left-1">{offscreen.left}</span>
          )}
        </button>

        {/* Scrollable track */}
        <TooltipProvider delay={400}>
          <div ref={trackRef} className="stepper-track flex-1 px-1">
            {steps.map((step, i) => {
              const isActive = step === activeStep;
              const filled = hasData(step);
              const IconComp = STEP_ICONS[step];
              const isPulsing = pulsingSteps.has(step);

              return (
                <Tooltip key={step}>
                  <TooltipTrigger
                    className={
                      'stepper-step group relative flex flex-col items-center gap-1.5 min-w-[92px] px-3 py-4 shrink-0 outline-none'
                    }
                    style={{ '--step-index': i } as React.CSSProperties}
                    data-step={step}
                    data-active={isActive || undefined}
                    data-filled={filled || undefined}
                    onClick={() => onStepClick(step)}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={labels[step]}
                    tabIndex={isActive ? 0 : -1}
                  >
                    {/* Icon container */}
                    <div className={`stepper-icon-box ${isActive ? 'stepper-icon-active' : ''}`}>
                      {IconComp && <IconComp />}

                      {/* Success badge */}
                      {filled && !isActive && (
                        <div
                          className={`stepper-badge absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-[var(--t-status-success)] flex items-center justify-center ${isPulsing ? 'stepper-badge-pulse' : ''}`}
                          style={{ boxShadow: '0 1px 4px rgba(34,197,94,0.35)' }}
                        >
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    {/* Label */}
                    <span className="stepper-label">{labels[step]}</span>

                    {/* Bottom indicator bar */}
                    {isActive ? (
                      <div
                        className="stepper-bar-active absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full"
                        style={{ background: 'var(--t-accent-gradient, var(--t-accent))', boxShadow: '0 -1px 6px rgba(0,74,173,0.15)' }}
                      />
                    ) : (
                      <div className="stepper-bar absolute bottom-0 left-3 right-3 rounded-t-full" />
                    )}
                  </TooltipTrigger>

                  <TooltipContent side="bottom" sideOffset={6}>
                    <div className="text-center">
                      <div className="font-semibold">{labels[step]}</div>
                      <div className="text-[11px] opacity-70">
                        {filled ? 'Dados cadastrados' : 'Sem dados ainda'}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {/* Price summary pill */}
            {priceSummary && priceSummary.dblAvista > 0 && (
              <div className="flex items-center px-3 shrink-0">
                <div
                  className="rounded-xl text-center transition-shadow duration-200 hover:shadow-md"
                  style={{
                    background: 'var(--t-header-bg)',
                    color: 'var(--t-header-text)',
                    padding: '8px 18px',
                    boxShadow: 'var(--elevation-1)',
                  }}
                >
                  <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t-text-secondary)' }}>
                    PAX (DBL)
                  </div>
                  <div className="text-sm font-bold mt-0.5">{formatBRL(priceSummary.dblAvista)}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: 'var(--t-text-secondary)' }}>
                    {priceSummary.parcelas}x {formatBRL(priceSummary.dblCartao)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </TooltipProvider>

        {/* Right arrow */}
        <button
          onClick={onNext}
          disabled={isLast}
          className="stepper-arrow relative w-12 self-stretch flex items-center justify-center text-[var(--t-text-muted)] shrink-0 border-l border-[var(--t-border)]"
          aria-label="Próxima etapa"
        >
          <ChevronRight className="w-5 h-5 transition-transform duration-150 group-hover:translate-x-0.5" />
          {offscreen.right > 0 && (
            <span className="stepper-arrow-badge right-1">{offscreen.right}</span>
          )}
        </button>
      </div>
    </div>
  );
}
