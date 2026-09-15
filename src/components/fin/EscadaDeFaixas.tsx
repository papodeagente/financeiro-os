'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { num } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * A escada de comissão, em dois modos sobre o mesmo desenho.
 *
 * 'trilho' (Metas e Comissões): onde a pessoa está e o que falta para subir.
 * 'degraus' (Vendedores): a função do plano, para comparar planos entre si.
 *
 * A ESCADA É RETROATIVA e é isso que o desenho precisa deixar claro: cruzar a
 * próxima faixa não vale só para o excedente, vale para o acumulado inteiro.
 * Por isso a frase da promessa fica SEMPRE visível ao lado, nunca só no balão:
 * o número exato em texto é imbatível, e o desenho serve para localizar.
 *
 * Faixa é categoria ORDINAL, então rampa sequencial de um matiz — nunca
 * arco-íris e nunca cor de status: "faixa 1" não é um alarme.
 *
 * A última faixa não tem teto e termina em CHEVRON ABERTO. Borda reta ali
 * mentiria um limite que o plano não tem.
 */

export type FaixaDaEscada = { de: number; ate: number | null; percentual: number };

export type PosicaoDaEscada = {
  indice: number;
  total: number;
  atual: FaixaDaEscada | null;
  proxima: FaixaDaEscada | null;
  falta_para_proxima: number | null;
  ganho_na_proxima: number | null;
};

export type EscadaDeFaixasProps =
  | {
      modo: 'trilho';
      faixas: FaixaDaEscada[];
      baseAcumulada: number;
      posicao: PosicaoDaEscada;
      formatar: (v: number) => string;
      nome?: string;
      className?: string;
    }
  | {
      modo: 'degraus';
      faixas: FaixaDaEscada[];
      nomePlano: string;
      baseDoCalculo: string;
      escalaTravada: { maxBase: number; maxPct: number };
      formatar: (v: number) => string;
      className?: string;
    };

/** Acima disto um trilho vira régua de engenharia: a tabela lê melhor. */
const MAX_DEGRAUS_NO_TRILHO = 5;
/** A faixa sem teto ocupa esta fração do trilho e termina aberta. */
const FATIA_DO_TOPO = 0.22;

const ALTURA_TRILHO = 12;
const ALTURA_SVG_TRILHO = 28;

function normalizar(faixas: FaixaDaEscada[]): FaixaDaEscada[] {
  return [...(faixas ?? [])]
    .map(f => ({ de: num(f.de), ate: f.ate === null || num(f.ate) === 0 ? null : num(f.ate), percentual: num(f.percentual) }))
    .sort((a, b) => a.de - b.de);
}

function pctTexto(v: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(num(v))}%`;
}

function Trilho({
  largura,
  faixas,
  baseAcumulada,
  posicao,
  formatar,
  nome,
}: {
  largura: number;
  faixas: FaixaDaEscada[];
  baseAcumulada: number;
  posicao: PosicaoDaEscada;
  formatar: (v: number) => string;
  nome?: string;
}) {
  const fechadas = faixas.filter(f => f.ate !== null);
  const aberta = faixas.find(f => f.ate === null) ?? null;

  const larguraAberta = aberta ? largura * FATIA_DO_TOPO : 0;
  const larguraFechadas = Math.max(1, largura - larguraAberta);
  const topoFechado = fechadas.length > 0 ? Math.max(...fechadas.map(f => f.ate ?? 0)) : 0;

  const emPx = (v: number) =>
    topoFechado <= 0 ? 0 : Math.min(larguraFechadas, (num(v) / topoFechado) * larguraFechadas);

  const segmentos = faixas.map((faixa, i) => {
    const x = faixa.ate === null ? larguraFechadas : emPx(faixa.de);
    const w = faixa.ate === null ? larguraAberta : Math.max(0, emPx(faixa.ate) - emPx(faixa.de));
    return { faixa, x, w, degrau: (Math.min(i, 3) + 1) as 1 | 2 | 3 | 4 };
  });

  const xMarcador =
    baseAcumulada > topoFechado && aberta
      ? larguraFechadas + larguraAberta / 2
      : emPx(baseAcumulada);

  const y = (ALTURA_SVG_TRILHO - ALTURA_TRILHO) / 2;

  const alvos: AlvoDeToque[] = [
    ...segmentos
      .filter(s => s.w > 0)
      .map(s => ({
        id: `faixa-${s.faixa.de}`,
        x: s.x,
        y,
        w: s.w,
        h: ALTURA_TRILHO,
        titulo: pctTexto(s.faixa.percentual),
        linhas: [
          s.faixa.ate === null
            ? `a partir de ${formatar(s.faixa.de)}`
            : `de ${formatar(s.faixa.de)} a ${formatar(s.faixa.ate)}`,
        ],
      })),
    {
      id: 'marcador',
      x: Math.max(0, xMarcador - 5),
      y: 0,
      w: 10,
      h: ALTURA_SVG_TRILHO,
      titulo: nome ?? 'Onde está hoje',
      linhas: [`acumulado ${formatar(baseAcumulada)}`, posicao.atual ? `na faixa de ${pctTexto(posicao.atual.percentual)}` : 'ainda antes da primeira faixa'],
    },
  ];

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={ALTURA_SVG_TRILHO}
      viewBox={`0 0 ${largura} ${ALTURA_SVG_TRILHO}`}
      role="img"
    >
      <desc>
        {posicao.total > 0 && posicao.indice > 0
          ? `Está na faixa ${posicao.indice} de ${posicao.total}${posicao.falta_para_proxima !== null ? `; faltam ${formatar(posicao.falta_para_proxima)} para a próxima` : ', que é a última'}.`
          : 'O acumulado ainda não alcançou a primeira faixa.'}
      </desc>

      <rect x={0} y={y} width={largura} height={ALTURA_TRILHO} rx={4} fill="var(--fin-surface-sunken)" />

      {segmentos.map(s => {
        if (s.w <= 0) return null;
        if (s.faixa.ate === null) {
          // Chevron aberto: o plano não tem teto, e borda reta diria que tem.
          const p = 6;
          const d = `M ${s.x} ${y} H ${s.x + s.w - p} L ${s.x + s.w} ${y + ALTURA_TRILHO / 2} L ${s.x + s.w - p} ${y + ALTURA_TRILHO} H ${s.x} Z`;
          return <path key={`f-${s.faixa.de}`} d={d} fill={`var(--fin-seq-${s.degrau})`} />;
        }
        return (
          <rect
            key={`f-${s.faixa.de}`}
            x={s.x}
            y={y}
            width={Math.max(0, s.w - 2)}
            height={ALTURA_TRILHO}
            fill={`var(--fin-seq-${s.degrau})`}
          />
        );
      })}

      {/* Marcador com anel da superfície: sem ele some sobre o degrau escuro. */}
      <circle
        cx={xMarcador}
        cy={ALTURA_SVG_TRILHO / 2}
        r={5}
        fill="var(--fin-serie-1)"
        stroke="var(--fin-surface)"
        strokeWidth={2}
      />

      <CamadaDeToque alvos={alvos} larguraSvg={largura} alturaSvg={ALTURA_SVG_TRILHO} />
    </svg>
  );
}

function Degraus({
  largura,
  faixas,
  escalaTravada,
  formatar,
}: {
  largura: number;
  faixas: FaixaDaEscada[];
  escalaTravada: { maxBase: number; maxPct: number };
  formatar: (v: number) => string;
}) {
  const altura = 120;
  const padEsq = 8;
  const padBaixo = 18;
  const larguraPlot = Math.max(1, largura - padEsq - 8);
  const alturaPlot = Math.max(1, altura - padBaixo - 8);

  const maxBase = Math.max(1, num(escalaTravada.maxBase));
  const maxPct = Math.max(1, num(escalaTravada.maxPct));

  const x = (v: number) => padEsq + Math.min(1, num(v) / maxBase) * larguraPlot;
  const y = (pct: number) => 8 + alturaPlot - Math.min(1, num(pct) / maxPct) * alturaPlot;

  const partes: string[] = [];
  faixas.forEach((faixa, i) => {
    const x0 = x(faixa.de);
    const x1 = x(faixa.ate === null ? maxBase : faixa.ate);
    const yy = y(faixa.percentual);
    partes.push(i === 0 ? `M ${x0} ${yy}` : `V ${yy}`);
    partes.push(`H ${x1}`);
  });

  const alvos: AlvoDeToque[] = faixas.map(faixa => ({
    id: `d-${faixa.de}`,
    x: x(faixa.de),
    y: 0,
    // O alvo pode crescer porque não carrega valor; a marca, não.
    w: Math.max(2, x(faixa.ate === null ? maxBase : faixa.ate) - x(faixa.de)), // piso-ok: alvo de toque, expandido a 44px pela CamadaDeToque
    h: altura,
    titulo: pctTexto(faixa.percentual),
    linhas: [
      faixa.ate === null ? `a partir de ${formatar(faixa.de)}` : `de ${formatar(faixa.de)} a ${formatar(faixa.ate)}`,
    ],
  }));

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
    >
      <desc>{`A comissão vai de ${pctTexto(faixas[0]?.percentual ?? 0)} a ${pctTexto(faixas[faixas.length - 1]?.percentual ?? 0)} conforme a base acumulada sobe.`}</desc>

      <path d={partes.join(' ')} fill="none" stroke="var(--fin-serie-1)" strokeWidth={2} strokeLinejoin="round" />
      {faixas.map(faixa => (
        <circle
          key={`p-${faixa.de}`}
          cx={x(faixa.de)}
          cy={y(faixa.percentual)}
          r={4.5}
          fill="var(--fin-serie-1)"
          stroke="var(--fin-surface)"
          strokeWidth={2}
        />
      ))}

      {/* O máximo de cada eixo é escrito: comparar duas funções em escalas
          diferentes é pior que não comparar, porque PARECE comparação. */}
      <text x={padEsq} y={altura - 4} className="fin-t-caption" fill="var(--fin-text-3)">
        {formatar(0)}
      </text>
      <text x={largura - 8} y={altura - 4} textAnchor="end" className="fin-t-caption" fill="var(--fin-text-3)">
        {`${formatar(maxBase)} · até ${pctTexto(maxPct)}`}
      </text>

      <CamadaDeToque alvos={alvos} larguraSvg={largura} alturaSvg={altura} />
    </svg>
  );
}

export function EscadaDeFaixas(props: EscadaDeFaixasProps) {
  const faixas = React.useMemo(() => normalizar(props.faixas), [props.faixas]);

  // Plano sem faixas NÃO é gráfico: é um número. Desenhar um trilho de um
  // degrau só sugeriria uma escada que não existe.
  if (faixas.length === 0) return null;

  if (props.modo === 'degraus') {
    return (
      <div className={cn('flex flex-col gap-1', props.className)}>
        <p className="fin-t-body-strong text-[var(--fin-text)]">{props.nomePlano}</p>
        <p className="fin-t-caption text-[var(--fin-text-3)]">{props.baseDoCalculo}</p>
        <AreaDeGrafico>
          {largura => (
            <Degraus
              largura={largura}
              faixas={faixas}
              escalaTravada={props.escalaTravada}
              formatar={props.formatar}
            />
          )}
        </AreaDeGrafico>
      </div>
    );
  }

  const { posicao, baseAcumulada, formatar, nome } = props;

  // Acima de cinco degraus o trilho vira régua de engenharia: a tabela lê
  // melhor, e é ela que responde.
  if (faixas.length > MAX_DEGRAUS_NO_TRILHO) {
    return (
      <table className={cn('w-full border-collapse', props.className)} data-fin-table>
        <caption className="fin-t-caption pb-2 text-left text-[var(--fin-text-3)]">
          {`Tabela de comissão · acumulado ${formatar(baseAcumulada)}`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="fin-t-caption border-b border-[var(--fin-border)] py-2 text-left text-[var(--fin-text-3)]">Faixa</th>
            <th scope="col" className="fin-t-caption border-b border-[var(--fin-border)] py-2 text-right text-[var(--fin-text-3)]">Paga</th>
          </tr>
        </thead>
        <tbody>
          {faixas.map((faixa, i) => (
            <tr key={faixa.de}>
              <td className="fin-t-body border-b border-[var(--fin-border)] py-2 text-[var(--fin-text)]">
                {faixa.ate === null ? `a partir de ${formatar(faixa.de)}` : `${formatar(faixa.de)} a ${formatar(faixa.ate)}`}
                {i + 1 === posicao.indice ? ' · aqui' : ''}
              </td>
              <td className="fin-t-body border-b border-[var(--fin-border)] py-2 text-right tabular-nums text-[var(--fin-text)]">
                {pctTexto(faixa.percentual)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', props.className)}>
      <AreaDeGrafico>
        {largura => (
          <Trilho
            largura={largura}
            faixas={faixas}
            baseAcumulada={num(baseAcumulada)}
            posicao={posicao}
            formatar={formatar}
            nome={nome}
          />
        )}
      </AreaDeGrafico>

      {/* Rótulo do degrau atual e do próximo, só. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {posicao.atual ? (
          <span className="fin-t-caption text-[var(--fin-text-2)]">
            {posicao.atual.ate === null
              ? `${pctTexto(posicao.atual.percentual)} a partir de ${formatar(posicao.atual.de)}`
              : `${pctTexto(posicao.atual.percentual)} até ${formatar(posicao.atual.ate)}`}
          </span>
        ) : null}
        {posicao.proxima ? (
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {`${pctTexto(posicao.proxima.percentual)} a partir daí`}
          </span>
        ) : null}
      </div>

      {/* A promessa em texto, sempre visível: é o que motiva, e esconder num
          balão a deixaria invisível justamente no celular. */}
      {posicao.proxima && posicao.falta_para_proxima !== null ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          {`Faltam ${formatar(posicao.falta_para_proxima)} para o mês inteiro valer ${pctTexto(posicao.proxima.percentual)}`}
          {posicao.ganho_na_proxima !== null && posicao.ganho_na_proxima > 0
            ? ` — ${formatar(posicao.ganho_na_proxima)} a mais.`
            : '.'}
        </p>
      ) : null}
    </div>
  );
}

export default EscadaDeFaixas;
