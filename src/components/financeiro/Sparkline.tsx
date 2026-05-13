'use client';

// Mini linha (sparkline) SVG — 1.2px stroke, sem dependências externas.
// Usada nos KPIs do tema minimal. Aceita lista de números (positivos ou
// negativos) e renderiza uma polyline normalizada.

interface Props {
  data: number[];
  color?: string;
  /** Largura em px (default 220, responsive via parent). */
  width?: number;
  /** Altura em px (default 28). */
  height?: number;
}

export function Sparkline({ data, color = 'currentColor', width = 220, height = 28 }: Props) {
  if (!data || data.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}>
        <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
      </svg>
    );
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(0.0001, max - min);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Linha base sutil para dar o piso visual */}
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
    </svg>
  );
}
