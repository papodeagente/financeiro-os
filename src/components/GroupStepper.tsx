'use client';

import { useEffect, useRef, useState } from 'react';
import { AbaType } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, LayoutDashboard, Info, Plane, Hotel,
  MapPin, Car, UserCheck, Shield, Ship, Ticket, Gift, Megaphone,
  DollarSign, BarChart3, Check,
} from 'lucide-react';

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
  const [hoveredStep, setHoveredStep] = useState<AbaType | null>(null);
  const [pressedStep, setPressedStep] = useState<AbaType | null>(null);
  const activeIdx = steps.indexOf(activeStep);
  const isFirst = activeIdx === 0;
  const isLast = activeIdx === steps.length - 1;

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
        {/* Prev arrow */}
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="group w-11 self-stretch flex items-center justify-center text-[var(--t-text-muted)] transition-all duration-200 disabled:opacity-15 disabled:pointer-events-none shrink-0 border-r border-[var(--t-border)] hover:bg-[var(--t-accent-muted)] hover:text-[var(--t-accent)] active:scale-90"
        >
          <ChevronLeft className="w-5 h-5 transition-transform duration-200 group-hover:-translate-x-0.5" />
        </button>

        {/* Scrollable track */}
        <div
          ref={trackRef}
          className="stepper-track flex-1 px-1"
        >
          {steps.map((step, i) => {
            const isActive = step === activeStep;
            const filled = hasData(step);
            const isHovered = hoveredStep === step;
            const isPressed = pressedStep === step;
            const IconComp = STEP_ICONS[step];

            return (
              <button
                key={step}
                data-step={step}
                onClick={() => onStepClick(step)}
                onMouseEnter={() => setHoveredStep(step)}
                onMouseLeave={() => { setHoveredStep(null); setPressedStep(null); }}
                onMouseDown={() => setPressedStep(step)}
                onMouseUp={() => setPressedStep(null)}
                className="group relative flex flex-col items-center gap-1.5 min-w-[80px] px-3 py-3 shrink-0 outline-none"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {/* Icon container */}
                <div
                  className="relative flex items-center justify-center rounded-xl transition-all duration-200 ease-out"
                  style={{
                    width: isActive ? 44 : isHovered ? 42 : 38,
                    height: isActive ? 44 : isHovered ? 42 : 38,
                    background: isActive
                      ? 'var(--t-accent-gradient, var(--t-accent))'
                      : filled
                        ? isHovered ? 'var(--t-accent-muted)' : 'var(--t-status-success-bg, rgba(34,197,94,0.08))'
                        : isHovered ? 'var(--t-accent-muted)' : 'transparent',
                    boxShadow: isActive
                      ? '0 4px 14px rgba(0,74,173,0.25), 0 1px 3px rgba(0,74,173,0.15)'
                      : isHovered && !isActive
                        ? 'var(--elevation-1)'
                        : 'none',
                    border: isActive
                      ? 'none'
                      : filled
                        ? '1.5px solid var(--t-status-success)'
                        : isHovered
                          ? '1.5px solid var(--t-accent)'
                          : '1.5px solid var(--t-border)',
                    transform: isPressed
                      ? 'scale(0.92)'
                      : isActive
                        ? 'scale(1)'
                        : isHovered
                          ? 'translateY(-2px)'
                          : 'scale(1)',
                  }}
                >
                  {IconComp && (
                    <IconComp
                      className="transition-all duration-200"
                      style={{
                        width: isActive ? 22 : isHovered ? 21 : 20,
                        height: isActive ? 22 : isHovered ? 21 : 20,
                        color: isActive
                          ? '#fff'
                          : filled
                            ? 'var(--t-status-success)'
                            : isHovered
                              ? 'var(--t-accent)'
                              : 'var(--t-text-muted)',
                        filter: isActive ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))' : 'none',
                      }}
                    />
                  )}

                  {/* Success badge */}
                  {filled && !isActive && (
                    <div
                      className="absolute flex items-center justify-center rounded-full bg-[var(--t-status-success)] transition-transform duration-200"
                      style={{
                        width: 16,
                        height: 16,
                        top: -4,
                        right: -4,
                        boxShadow: '0 1px 4px rgba(34,197,94,0.35)',
                        transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                      }}
                    >
                      <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>

                {/* Label */}
                <span
                  className="text-[11px] leading-tight whitespace-nowrap transition-all duration-200"
                  style={{
                    fontWeight: isActive ? 700 : filled ? 600 : 400,
                    color: isActive
                      ? 'var(--t-accent)'
                      : filled
                        ? 'var(--t-text)'
                        : isHovered
                          ? 'var(--t-text)'
                          : 'var(--t-text-muted)',
                    transform: isHovered && !isActive ? 'translateY(-1px)' : 'none',
                    letterSpacing: isActive ? '0.01em' : '0',
                  }}
                >
                  {labels[step]}
                </span>

                {/* Active indicator bar */}
                <div
                  className="absolute bottom-0 rounded-t-full transition-all duration-300 ease-out"
                  style={{
                    left: 12,
                    right: 12,
                    height: isActive ? 3 : isHovered ? 2 : 0,
                    background: isActive
                      ? 'var(--t-accent-gradient, var(--t-accent))'
                      : 'var(--t-accent)',
                    opacity: isActive ? 1 : isHovered ? 0.4 : 0,
                    boxShadow: isActive ? '0 -1px 6px rgba(0,74,173,0.2)' : 'none',
                  }}
                />

                {/* Hover ripple background */}
                <div
                  className="absolute inset-1 rounded-xl transition-all duration-200 pointer-events-none -z-10"
                  style={{
                    background: isHovered && !isActive ? 'var(--t-surface-hover)' : 'transparent',
                    opacity: isPressed ? 0.7 : 1,
                  }}
                />
              </button>
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

        {/* Next arrow */}
        <button
          onClick={onNext}
          disabled={isLast}
          className="group w-11 self-stretch flex items-center justify-center text-[var(--t-text-muted)] transition-all duration-200 disabled:opacity-15 disabled:pointer-events-none shrink-0 border-l border-[var(--t-border)] hover:bg-[var(--t-accent-muted)] hover:text-[var(--t-accent)] active:scale-90"
        >
          <ChevronRight className="w-5 h-5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
