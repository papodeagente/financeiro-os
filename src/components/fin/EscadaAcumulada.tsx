'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  TRACEJADO_AUSENCIA,
  agruparPorDia,
  formatarEixoBRL,
  ticksArredondados,
} from '@/lib/escala';
import { num, round2 } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * Como o mês foi se formando, em DEGRAUS.
 *
 * POR QUE DEGRAU E NÃO CURVA. Entre duas vendas não acontece nada. Interpolar
 * em curva desenharia movimento onde houve silêncio, e a leitura ("estamos
 * subindo") passaria a vir do traço, não do fato.
 *
 * NÃO HÁ PORTÃO DE TRÊS PERÍODOS AQUI, porque o eixo são os DIAS do mês: cinco
 * vendas em quatorze dias já contam uma história. O portão existe para série
 * mês a mês, onde cinco meses vazios viravam cinco tocos de 3px.
 *
 * `topoDoEixo` é prop explícita. No Painel o topo vem do DADO: escalar pela
 * meta colaria a linha no chão e desenharia fracasso num mês honesto. Em Metas
 * o topo é a meta, e aí a linha colada no chão É a resposta — e a sublinha do
 * gráfico diz isso em palavras.
 */

export type EventoAcum = {
  /** ISO, YYYY-MM-DD. */
  data: string;
  rotulo: string;
  valor: number;
  detalhe?: string;
};

export type EscadaAcumuladaProps = {
  eventos: EventoAcum[];
  diasDoMes: number;
  diaDeHoje: number;
  /** A reta de ritmo. Só existe em Metas. */
  referencia?: { rotulo: string; ate: number } | null;
  topoDoEixo: 'dado' | 'referencia';
  formatar: (v: number) => string;
  altura?: 160 | 220;
  /** Frase do vazio, quando não houve um único evento no mês. */
  vazio?: React.ReactNode;
  className?: string;
};

const PADDING_ESQ = 56; // espaço dos rótulos do eixo y
const PADDING_DIR = 12;
const PADDING_BAIXO = 20; // faixa do eixo x
const PADDING_TOPO = 10;

function diaDoISO(iso: string): number {
  return Number(iso.slice(8, 10)) || 1;
}

function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function Desenho({
  largura,
  altura,
  eventos,
  diasDoMes,
  diaDeHoje,
  referencia,
  topoDoEixo,
  formatar,
}: {
  largura: number;
  altura: number;
  eventos: EventoAcum[];
  diasDoMes: number;
  diaDeHoje: number;
  referencia: { rotulo: string; ate: number } | null;
  topoDoEixo: 'dado' | 'referencia';
  formatar: (v: number) => string;
}) {
  const larguraPlot = Math.max(1, largura - PADDING_ESQ - PADDING_DIR);
  const alturaPlot = Math.max(1, altura - PADDING_TOPO - PADDING_BAIXO);
  const dias = Math.max(1, Math.floor(num(diasDoMes)));

  // Duas vendas no mesmo dia são UM degrau, UM alvo e um balão que lista as
  // duas. Colisão de dia é comum com poucas vendas no mês.
  const porDia = React.useMemo(() => {
    let acumulado = 0;
    return agruparPorDia(eventos).map(({ dia, itens }) => {
      const doDia = round2(itens.reduce((s, i) => s + num(i.valor), 0));
      acumulado = round2(acumulado + doDia);
      return { dia, itens, doDia, acumulado };
    });
  }, [eventos]);

  const totalAcumulado = porDia.length > 0 ? porDia[porDia.length - 1].acumulado : 0;
  const teto =
    topoDoEixo === 'referencia' && referencia
      ? Math.max(num(referencia.ate), totalAcumulado)
      : totalAcumulado;

  const ticks = ticksArredondados(teto, 3);
  const maxEixo = ticks.length > 0 ? ticks[ticks.length - 1] : 0;

  const x = (dia: number) => PADDING_ESQ + ((Math.min(Math.max(dia, 1), dias) - 1) / Math.max(1, dias - 1)) * larguraPlot;
  const y = (v: number) => PADDING_TOPO + alturaPlot - (maxEixo <= 0 ? 0 : (num(v) / maxEixo) * alturaPlot);

  const base = PADDING_TOPO + alturaPlot;

  // M x0,base H x1 V y1 H x2 V y2 … — o degrau nasce na linha de base do dia 1.
  const partes: string[] = [`M ${x(1)} ${base}`];
  for (const ponto of porDia) {
    const px = x(diaDoISO(ponto.dia));
    partes.push(`H ${px}`, `V ${y(ponto.acumulado)}`);
  }
  // A linha segue reta até hoje: dia sem venda não vira marca, e parar no
  // último evento sugeriria que o mês acabou ali.
  partes.push(`H ${x(Math.min(diaDeHoje, dias))}`);
  const caminho = partes.join(' ');
  const areaFechada = `${caminho} V ${base} Z`;

  const alvos: AlvoDeToque[] = porDia.map(ponto => {
    const px = x(diaDoISO(ponto.dia));
    return {
      id: ponto.dia,
      x: px - 6,
      y: PADDING_TOPO,
      w: 12,
      h: alturaPlot,
      titulo: dataCurta(ponto.dia),
      linhas: [
        ...ponto.itens.map(i => `${i.rotulo} · ${formatar(i.valor)}${i.detalhe ? ` · ${i.detalhe}` : ''}`),
        `acumulado ${formatar(ponto.acumulado)}`,
      ],
    };
  });

  const ultimo = porDia[porDia.length - 1] ?? null;
  const rotulosDoEixoX = [...new Set([1, Math.min(diaDeHoje, dias), dias])].sort((a, b) => a - b);

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
    >
      <desc>
        {porDia.length === 0
          ? 'Nenhum movimento no período.'
          : `O mês subiu em ${porDia.length} ${porDia.length === 1 ? 'salto' : 'saltos'}; o último foi em ${dataCurta(ultimo!.dia)}, chegando a ${formatar(totalAcumulado)}.`}
      </desc>

      {/* Grade: no máximo três fios SÓLIDOS, recuados. */}
      {ticks.map(t => (
        <g key={t}>
          <line
            x1={PADDING_ESQ}
            x2={largura - PADDING_DIR}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--fin-grade)"
            strokeWidth={1}
          />
          <text
            x={PADDING_ESQ - 8}
            y={y(t) + 4}
            textAnchor="end"
            className="fin-t-caption"
            fill="var(--fin-text-3)"
          >
            {formatarEixoBRL(t)}
          </text>
        </g>
      ))}

      {/* A reta de ritmo é SÓLIDA: tracejado significa ausência de dado. */}
      {referencia ? (
        <line
          x1={x(1)}
          x2={x(dias)}
          y1={y(0)}
          y2={y(referencia.ate)}
          stroke="var(--fin-eixo)"
          strokeWidth={1}
        />
      ) : null}

      <path d={areaFechada} fill="var(--fin-serie-1)" fillOpacity={0.1} />
      <path
        d={caminho}
        fill="none"
        stroke="var(--fin-serie-1)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Marcador por dia com venda, com anel da superfície para não sumir. */}
      {porDia.map(ponto => (
        <circle
          key={ponto.dia}
          cx={x(diaDoISO(ponto.dia))}
          cy={y(ponto.acumulado)}
          r={4.5}
          fill="var(--fin-serie-1)"
          stroke="var(--fin-surface)"
          strokeWidth={2}
        />
      ))}

      {/* Rótulo direto SÓ no último ponto: um número em cada ponto vira ruído. */}
      {ultimo ? (
        <text
          x={Math.min(x(diaDoISO(ultimo.dia)) + 8, largura - PADDING_DIR)}
          y={Math.max(12, y(ultimo.acumulado) - 8)}
          textAnchor={x(diaDoISO(ultimo.dia)) > largura * 0.7 ? 'end' : 'start'}
          className="fin-t-caption"
          fill="var(--fin-text-2)"
        >
          {formatar(ultimo.acumulado)}
        </text>
      ) : null}

      {/* Eixo x: começo, hoje e fim. */}
      {rotulosDoEixoX.map(dia => (
        <text
          key={dia}
          x={x(dia)}
          y={altura - 6}
          textAnchor={dia === 1 ? 'start' : dia === dias ? 'end' : 'middle'}
          className="fin-t-caption"
          fill="var(--fin-text-3)"
        >
          {dia === diaDeHoje && dia !== 1 && dia !== dias ? `hoje (${dia})` : dia}
        </text>
      ))}

      {/* O trecho do mês que ainda não aconteceu: ausência, logo tracejado. */}
      {diaDeHoje < dias ? (
        <line
          x1={x(diaDeHoje)}
          x2={x(dias)}
          y1={base}
          y2={base}
          stroke="var(--fin-eixo)"
          strokeWidth={1}
          strokeDasharray={TRACEJADO_AUSENCIA}
        />
      ) : null}

      <CamadaDeToque
        alvos={alvos}
        larguraSvg={largura}
        alturaSvg={altura}
        crosshair={{ x: id => x(diaDoISO(id)), altura }}
      />
    </svg>
  );
}

export function EscadaAcumulada({
  eventos,
  diasDoMes,
  diaDeHoje,
  referencia = null,
  topoDoEixo,
  formatar,
  altura = 160,
  vazio,
  className,
}: EscadaAcumuladaProps) {
  const comData = React.useMemo(
    () => [...eventos].filter(e => !!e.data).sort((a, b) => a.data.localeCompare(b.data)),
    [eventos],
  );

  // Zero eventos não desenha. UM evento DESENHA: um degrau e um ponto é
  // verdade, não ruído.
  if (comData.length === 0 && !referencia) {
    return <div className={className}>{vazio ?? null}</div>;
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AreaDeGrafico>
        {largura => (
          <Desenho
            largura={largura}
            altura={altura}
            eventos={comData}
            diasDoMes={diasDoMes}
            diaDeHoje={diaDeHoje}
            referencia={referencia}
            topoDoEixo={topoDoEixo}
            formatar={formatar}
          />
        )}
      </AreaDeGrafico>
      {comData.length === 0 && vazio ? <div>{vazio}</div> : null}
    </div>
  );
}

export default EscadaAcumulada;
