'use client';

// Card de KPI no padrão da home financeira:
// - Borda colorida no topo (3px)
// - Header com ícone + label + opcional botão (i) de info
// - Valor grande em destaque
// - Delta % com cor (verde sobe / vermelho desce) + comparativo
// - Sparkline opcional embaixo (SVG inline, leve)
//
// Visual controlado por data-accent na div externa, definida em
// globals.css (.kpi-card[data-accent="..."]).

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

export type KpiAccent = 'blue' | 'green' | 'red' | 'violet' | 'amber' | 'cyan' | 'pink';

interface Props {
  /** Cor da borda superior */
  accent?: KpiAccent;
  /** Ícone à esquerda do label (ex.: Wallet, Receipt) */
  icon?: ReactNode;
  /** Label superior (ex.: "Saldo bancário") */
  label: string;
  /** Valor principal já formatado (ex.: "R$ 248.750,00") */
  value: string | number;
  /** Delta percentual (ex.: 12.4 para +12,4%) */
  delta?: number;
  /** Texto após o delta (ex.: "vs período anterior") */
  deltaLabel?: string;
  /** Linha auxiliar abaixo (ex.: "34 parcelas pendentes neste período") */
  hint?: ReactNode;
  /** Série numérica pra sparkline opcional (8-30 valores) */
  sparkline?: number[];
  /** Cor da sparkline (default = accent) */
  sparklineColor?: string;
  /** Conteúdo do tooltip de info (mostra ícone (i)) */
  info?: ReactNode;
  /** Click no card (opcional) */
  onClick?: () => void;
  /** Class extra */
  className?: string;
}

const ACCENT_HEX: Record<KpiAccent, string> = {
  blue:   '#4F46E5',
  green:  '#10B981',
  red:    '#EF4444',
  violet: '#8B5CF6',
  amber:  '#F59E0B',
  cyan:   '#06B6D4',
  pink:   '#EC4899',
};

export function KpiCard({
  accent = 'blue',
  icon,
  label,
  value,
  delta,
  deltaLabel = 'vs período anterior',
  hint,
  sparkline,
  sparklineColor,
  info,
  onClick,
  className = '',
}: Props) {
  const deltaPositive = typeof delta === 'number' && delta > 0;
  const deltaNegative = typeof delta === 'number' && delta < 0;
  const sparkColor = sparklineColor || ACCENT_HEX[accent];

  return (
    <div
      className={`kpi-card ${onClick ? 'cursor-pointer' : ''} ${className}`}
      data-accent={accent}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{ background: `${ACCENT_HEX[accent]}14`, color: ACCENT_HEX[accent] }}
            >
              {icon}
            </span>
          )}
          <span className="text-[13px] font-medium text-[var(--lg-text-2)] truncate">
            {label}
          </span>
        </div>
        {info && (
          <button
            type="button"
            className="text-[var(--lg-text-4)] hover:text-[var(--lg-text-2)] transition-colors"
            title={typeof info === 'string' ? info : undefined}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[26px] font-bold leading-tight text-[var(--lg-text)] tracking-tight tabular-nums">
          {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
        </span>
      </div>

      {typeof delta === 'number' && (
        <div className="flex items-center gap-1.5 text-[12px] mb-1">
          <span
            className={
              deltaPositive ? 'text-emerald-600 inline-flex items-center gap-0.5 font-semibold'
              : deltaNegative ? 'text-red-500 inline-flex items-center gap-0.5 font-semibold'
              : 'text-[var(--lg-text-3)]'
            }
          >
            {deltaPositive && '↗ '}
            {deltaNegative && '↘ '}
            {deltaPositive ? '+' : ''}{delta.toFixed(1).replace('.', ',')}%
          </span>
          <span className="text-[var(--lg-text-3)]">{deltaLabel}</span>
        </div>
      )}

      {hint && (
        <p className="text-[11.5px] text-[var(--lg-text-3)] leading-snug">{hint}</p>
      )}

      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={sparkColor} />
      )}
    </div>
  );
}

// Sparkline minimalista — SVG sem libs. Suporta área preenchida (gradient)
// + linha. Auto-escala pra ocupar 100% da largura disponível.
function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const width = 100; // viewBox, escala via preserveAspectRatio="none"
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const gradId = `spark-${color.replace('#', '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full mt-2"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
