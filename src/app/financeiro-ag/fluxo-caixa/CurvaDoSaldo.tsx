'use client';

import * as React from 'react';

import { comAlfa } from '@/lib/cor';
import { rotuloDoDia, type PontoDaCurva } from '@/lib/caderno-caixa';
import { dataLocal } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';

/** Coordenadas internas do SVG. A curva estica; os textos ficam em HTML por cima. */
const LARGURA = 1000;
const ALTURA = 200;

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export type CurvaDoSaldoProps = {
  curva: PontoDaCurva[];
  hoje: string;
  className?: string;
};

/** Marcas do eixo: dias 1, 8, 15, 22 e 29 num mês; o começo de cada mês em períodos maiores. */
function marcas(curva: PontoDaCurva[]): Array<{ indice: number; rotulo: string }> {
  const saida: Array<{ indice: number; rotulo: string }> = [];
  const umMes = curva.length <= 31;
  curva.forEach((p, i) => {
    const d = dataLocal(p.data);
    if (!d) return;
    if (umMes) {
      if ([1, 8, 15, 22, 29].includes(d.getDate())) {
        saida.push({ indice: i, rotulo: d.getDate() === 1 ? `1 ${MESES_CURTOS[d.getMonth()]}` : String(d.getDate()) });
      }
    } else if (d.getDate() === 1) {
      saida.push({ indice: i, rotulo: MESES_CURTOS[d.getMonth()] });
    }
  });
  return saida;
}

/**
 * A curva do saldo, dia a dia.
 *
 * Linha cheia até hoje (o que já aconteceu) e tracejada depois (previsão).
 * Abaixo de zero a área fica vermelha: é o dia em que falta dinheiro. Passar
 * o dedo ou o mouse mostra o saldo de cada dia; os mesmos números estão no
 * caderno logo abaixo, que é a leitura acessível.
 */
export function CurvaDoSaldo({ curva, hoje, className }: CurvaDoSaldoProps) {
  const id = React.useId().replace(/:/g, '');
  const [foco, setFoco] = React.useState<number | null>(null);
  const n = curva.length;
  if (n === 0) return null;

  const valores = curva.map(p => p.saldo);
  let min = Math.min(...valores);
  let max = Math.max(...valores);
  const temNegativo = min < 0;
  if (temNegativo) max = Math.max(max, 0);
  if (min === max) {
    const folga = Math.abs(min) * 0.1 || 1;
    min -= folga;
    max += folga;
  }
  const margem = (max - min) * 0.14;
  const yMin = min - margem;
  const yMax = max + margem;

  const x = (i: number) => (n === 1 ? LARGURA / 2 : (i / (n - 1)) * LARGURA);
  const y = (v: number) => ALTURA - ((v - yMin) / (yMax - yMin)) * ALTURA;
  const pontos = curva.map((p, i) => [x(i), y(p.saldo)] as const);
  // Em degraus: o saldo não escorrega entre um dia e outro, ele muda no dia
  // do lançamento. Uma rampa sugeriria um gasto que acontece aos poucos.
  const trecho = (ini: number, fim: number) =>
    pontos.slice(ini, fim + 1).map(([a, b], k) =>
      (k === 0 ? `M${a.toFixed(1)},${b.toFixed(1)}` : `H${a.toFixed(1)} V${b.toFixed(1)}`)).join(' ');

  // Último índice do que já aconteceu. Período todo no futuro: -1.
  const iHoje = curva.findIndex(p => p.data === hoje);
  const corte = iHoje >= 0 ? iHoje : curva[0].data > hoje ? -1 : n - 1;
  const passado = corte >= 0 ? trecho(0, corte) : '';
  const futuro = corte < n - 1 ? trecho(Math.max(0, corte), n - 1) : '';

  // A área desce até o zero quando há saldo negativo (para pintar o buraco)
  // e até o pé do gráfico quando não há.
  const base = temNegativo ? y(0) : ALTURA;
  const area = `${trecho(0, n - 1)} L${x(n - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const caixa = e.currentTarget.getBoundingClientRect();
    if (caixa.width <= 0) return;
    const razao = Math.min(1, Math.max(0, (e.clientX - caixa.left) / caixa.width));
    setFoco(Math.round(razao * (n - 1)));
  }

  const inicio = curva[0];
  const fim = curva[n - 1];
  const menor = curva.reduce((a, b) => (b.saldo < a.saldo ? b : a));
  const descricao =
    `Curva do saldo: ${formatBRL(inicio.saldo)} em ${rotuloDoDia(inicio.data)}, ` +
    `${formatBRL(fim.saldo)} em ${rotuloDoDia(fim.data)}. ` +
    `Menor saldo: ${formatBRL(menor.saldo)} em ${rotuloDoDia(menor.data)}.`;

  const emFoco = foco !== null ? curva[foco] : null;

  return (
    <div className={cn('flex flex-col gap-[var(--fin-s-2)]', className)}>
      <div
        role="img"
        aria-label={descricao}
        className="relative h-40 touch-pan-y select-none sm:h-48"
        onPointerMove={aoMover}
        onPointerDown={aoMover}
        onPointerLeave={() => setFoco(null)}
      >
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-acima`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: comAlfa('var(--fin-accent)', 22) }} />
              <stop offset="100%" style={{ stopColor: comAlfa('var(--fin-accent)', 0) }} />
            </linearGradient>
            <clipPath id={`${id}-sobre-zero`}>
              <rect x="0" y="0" width={LARGURA} height={temNegativo ? y(0) : ALTURA} />
            </clipPath>
            <clipPath id={`${id}-sob-zero`}>
              <rect x="0" y={temNegativo ? y(0) : ALTURA} width={LARGURA} height={ALTURA} />
            </clipPath>
          </defs>

          <path d={area} fill={`url(#${id}-acima)`} clipPath={`url(#${id}-sobre-zero)`} />
          {temNegativo ? (
            <path d={area} style={{ fill: comAlfa('var(--fin-negative)', 18) }} clipPath={`url(#${id}-sob-zero)`} />
          ) : null}

          {temNegativo ? (
            <line
              x1="0" x2={LARGURA} y1={y(0)} y2={y(0)}
              stroke="var(--fin-border-strong)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {passado ? (
            <path
              d={passado} fill="none" stroke="var(--fin-accent)" strokeWidth={2.25}
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {futuro ? (
            <path
              d={futuro} fill="none" stroke="var(--fin-accent)" strokeWidth={2}
              strokeDasharray="5 5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
              opacity={0.75}
            />
          ) : null}
        </svg>

        {temNegativo ? (
          <span
            className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 fin-t-caption text-[var(--fin-text-3)]"
            style={{ top: pct(y(0), ALTURA) }}
          >
            R$ 0
          </span>
        ) : null}

        {/* Hoje: um ponto na curva, como o "agora" de um app de ações. */}
        {iHoje >= 0 ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 top-0 w-px -translate-x-1/2 bg-[var(--fin-border-strong)]"
              style={{ left: pct(x(iHoje), LARGURA) }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--fin-surface)] bg-[var(--fin-accent)] shadow-[var(--fin-e1)]"
              style={{ left: pct(x(iHoje), LARGURA), top: pct(y(curva[iHoje].saldo), ALTURA) }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full pb-1 fin-t-caption font-medium text-[var(--fin-accent)]"
              style={{ left: pct(x(iHoje), LARGURA) }}
            >
              Hoje
            </span>
          </>
        ) : null}

        {emFoco && foco !== null ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 top-0 w-px -translate-x-1/2 bg-[var(--fin-text-3)]"
              style={{ left: pct(x(foco), LARGURA) }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--fin-text)]"
              style={{ left: pct(x(foco), LARGURA), top: pct(y(emFoco.saldo), ALTURA) }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-2 z-[var(--fin-z-conteudo)] flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-2.5 py-1.5 shadow-[var(--fin-e1)]"
              style={{ left: `clamp(64px, ${pct(x(foco), LARGURA)}, calc(100% - 64px))` }}
            >
              <span className="fin-t-caption text-[var(--fin-text-3)]">{rotuloDoDia(emFoco.data)}</span>
              <span
                className={cn(
                  'fin-t-body-strong tabular-nums',
                  emFoco.saldo < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
                )}
              >
                {formatBRL(emFoco.saldo)}
              </span>
            </span>
          </>
        ) : null}
      </div>

      <div aria-hidden="true" className="relative h-4">
        {marcas(curva).map(m => (
          <span
            key={m.indice}
            className="absolute -translate-x-1/2 fin-t-caption tabular-nums text-[var(--fin-text-3)] first:translate-x-0"
            style={{ left: pct(x(m.indice), LARGURA) }}
          >
            {m.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

export default CurvaDoSaldo;
