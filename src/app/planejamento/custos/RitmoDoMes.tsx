'use client';

import * as React from 'react';

import { comAlfa } from '@/lib/cor';
import { formatBRL } from '@/lib/utils';

/**
 * O ritmo do mês: a comissão acumulada dia a dia contra o que o plano pedia
 * acumulado até cada dia (os dias úteis andam, o fim de semana não). É o
 * gráfico "Negociações por período" das Análises do CRM, com a pergunta do
 * plano: estou na frente ou atrás da linha?
 */

function caminhoSuave(pts: Array<[number, number]>): string {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

function compacto(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function RitmoDoMes({ mes, comissaoPorDia, ritmo, diaDeHoje }: {
  mes: string;
  comissaoPorDia: number[];
  /** O plano acumulado até cada dia (mesmo tamanho da série). Vazio sem meta. */
  ritmo: number[];
  /** Até que dia a linha do realizado vai (o mês aberto para em hoje). */
  diaDeHoje: number;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [largura, setLargura] = React.useState(640);
  const [altura, setAltura] = React.useState(240);
  const [foco, setFoco] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, '');

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // O gráfico ocupa a altura que o bloco tiver (mínimo 240): ao lado de uma
    // lista longa ele cresce em vez de deixar um buraco embaixo.
    const obs = new ResizeObserver(([e]) => {
      setLargura(Math.max(240, e.contentRect.width));
      setAltura(Math.max(240, Math.min(480, e.contentRect.height)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const n = comissaoPorDia.length;
  const acumulado: number[] = [];
  comissaoPorDia.forEach((v, i) => acumulado.push((acumulado[i - 1] ?? 0) + v));
  const ate = Math.max(1, Math.min(n, diaDeHoje));
  const realizado = acumulado.slice(0, ate);

  const H = altura, esq = 44, baixo = 24, topo = 12;
  const iw = largura - esq - 8;
  const maior = Math.max(1, ...realizado, ...ritmo);
  const PASSOS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000];
  const passo = PASSOS.find(p => p * 4 >= maior) ?? Math.ceil(maior / 4);
  const teto = passo * 4;
  const X = (i: number) => esq + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const Y = (v: number) => topo + (H - baixo - topo) * (1 - v / teto);
  const ptsR = realizado.map((v, i) => [X(i), Y(v)] as [number, number]);
  const ptsP = ritmo.map((v, i) => [X(i), Y(v)] as [number, number]);
  const area = ptsR.length > 1
    ? `${caminhoSuave(ptsR)} L ${ptsR[ptsR.length - 1][0]} ${Y(0)} L ${ptsR[0][0]} ${Y(0)} Z`
    : '';
  const passoX = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
  const [, mm] = mes.split('-');

  const mover = (clientX: number) => {
    const el = ref.current;
    if (!el || n === 0) return;
    const x = clientX - el.getBoundingClientRect().left;
    const i = Math.round(((x - esq) / iw) * (n - 1));
    setFoco(Math.max(0, Math.min(n - 1, i)));
  };

  const descricao = `Comissão acumulada no mês: ${formatBRL(realizado[realizado.length - 1] ?? 0)} até o dia ${ate}.`
    + (ritmo.length ? ` O plano pedia ${formatBRL(ritmo[ate - 1] ?? 0)} até esse dia e ${formatBRL(ritmo[n - 1] ?? 0)} no mês.` : '');

  return (
    <div ref={ref} className="relative min-h-[240px] w-full flex-1" onMouseMove={e => mover(e.clientX)} onMouseLeave={() => setFoco(null)}>
      {/* Absoluto: a altura vem do bloco, nunca do próprio desenho (sem laço de crescimento). */}
      <svg width={largura} height={H} role="img" aria-label={descricao} className="absolute left-0 top-0 block">
        <defs>
          <linearGradient id={`area-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: comAlfa('var(--fin-accent)', 22) }} />
            <stop offset="1" style={{ stopColor: comAlfa('var(--fin-accent)', 0) }} />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map(k => (
          <g key={k}>
            <line x1={esq} x2={largura - 8} y1={Y(passo * k)} y2={Y(passo * k)} style={{ stroke: 'var(--fin-border)' }} strokeDasharray={k === 0 ? undefined : '3 4'} />
            <text x={esq - 8} y={Y(passo * k) + 4} textAnchor="end" className="fill-[var(--fin-text-3)] text-[11px] tabular-nums">{compacto(passo * k)}</text>
          </g>
        ))}
        {comissaoPorDia.map((_, i) => (i % passoX === 0 || i === n - 1 ? (
          <text key={i} x={X(i)} y={H - 6} textAnchor="middle" className="fill-[var(--fin-text-3)] text-[11px] tabular-nums">
            {String(i + 1).padStart(2, '0')}/{mm}
          </text>
        ) : null))}
        {ptsP.length > 1 ? (
          <path d={caminhoSuave(ptsP)} fill="none" style={{ stroke: 'var(--fin-text-3)' }} strokeWidth={1.5} strokeDasharray="5 5" />
        ) : null}
        {area ? <path d={area} fill={`url(#area-${id})`} /> : null}
        {ptsR.length > 1 ? <path d={caminhoSuave(ptsR)} fill="none" style={{ stroke: 'var(--fin-accent)' }} strokeWidth={2.5} strokeLinecap="round" /> : null}
        {ptsR.length > 0 ? (
          <circle cx={ptsR[ptsR.length - 1][0]} cy={ptsR[ptsR.length - 1][1]} r={4.5} style={{ fill: 'var(--fin-surface)', stroke: 'var(--fin-accent)' }} strokeWidth={2.5} />
        ) : null}
        {foco !== null ? (
          <line x1={X(foco)} x2={X(foco)} y1={topo} y2={H - baixo} style={{ stroke: 'var(--fin-border-strong)' }} />
        ) : null}
      </svg>
      {foco !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-[var(--fin-z-popover)] min-w-[168px] rounded-[12px] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 shadow-[var(--fin-e1)]"
          style={{ left: Math.min(Math.max(0, X(foco) + 10), largura - 180) }}
        >
          <p className="fin-t-caption font-medium text-[var(--fin-text)]">Dia {String(foco + 1).padStart(2, '0')}/{mm}</p>
          <p className="fin-t-caption flex items-center justify-between gap-3 text-[var(--fin-text-2)]">
            <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)]" />Realizado</span>
            <b className="font-medium tabular-nums text-[var(--fin-text)]">{foco < ate ? formatBRL(acumulado[foco]) : '—'}</b>
          </p>
          {ritmo.length ? (
            <p className="fin-t-caption flex items-center justify-between gap-3 text-[var(--fin-text-2)]">
              <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-0.5 w-3 bg-[var(--fin-text-3)]" />Plano</span>
              <b className="font-medium tabular-nums text-[var(--fin-text)]">{formatBRL(ritmo[foco])}</b>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
