'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { RAIO_PONTA, TRACEJADO_AUSENCIA, larguraDaMarca } from '@/lib/escala';
import { num } from '@/lib/money';
import { AreaDeGrafico, useMolduraDoGrafico } from '@/components/fin/GraficoMoldura';
import { Balao, useBalao } from '@/components/fin/Balao';

/**
 * Lista de pessoas (ou rubricas) com uma barra cada, TODAS na mesma escala.
 *
 * POR QUE EXISTE. No ranking de hoje cada linha usa um Meter em percentual da
 * própria meta: quem tem meta de R$ 10 mil e vendeu R$ 9 mil desenha uma barra
 * MAIOR que quem tem meta de R$ 200 mil e vendeu R$ 150 mil. A comparação
 * entre pessoas, que é a única razão de existir de um ranking, só acontece na
 * cabeça de quem lê. Aqui a largura é medida uma vez e o máximo é comum:
 * max(valores, alvos, referência).
 *
 * NÃO EXISTE PISO DE MARCA. Zero desenha zero; ausência desenha tracejado com
 * o motivo ao lado. "Meta zero" e "meta não definida" são estados diferentes e
 * hoje têm exatamente a mesma aparência.
 *
 * COR ÚNICA em todas as barras: a identidade está no rótulo. É essa decisão
 * que impede a mesma pessoa de trocar de cor entre o Painel e Metas.
 */

export type LinhaBarra = {
  id: string;
  nome: string;
  /** null = AUSÊNCIA declarada, jamais 0. */
  valor: number | null;
  /** 'ainda sem venda em setembro · faltam R$ 75.000,00' */
  rotuloAusencia?: string;
  /** Entalhe de meta. */
  alvo?: number | null;
  /** '26,5% da meta · 2 vendas · 64% do mês' */
  secundario?: string;
  /** Linhas extras do balão: a decomposição completa. */
  detalhes?: string[];
  chip?: React.ReactNode;
};

export type BarrasNomeadasProps = {
  linhas: LinhaBarra[];
  /** A ordem é DITA na sublinha da moldura, nunca deixada implícita. */
  ordenacao?: 'valor-desc' | 'dada';
  /** Linha vertical atravessando todas — a média da folha, por exemplo. */
  referencia?: { valor: number; rotulo: string } | null;
  formatar: (v: number) => string;
  /** Acima disto, 'ver todas (n)'. NUNCA 'Outros' para pessoas. */
  maximoVisivel?: number;
  alturaBarra?: 10 | 16;
  onAtivar?: (id: string) => void;
  /** Frase usada quando só há uma linha: barra de um item é um número com tinta em volta. */
  fraseDeLinhaUnica?: (linha: LinhaBarra) => string;
};

function Barra({
  linha,
  largura,
  maximo,
  altura,
  formatar,
}: {
  linha: LinhaBarra;
  largura: number;
  maximo: number;
  altura: number;
  formatar: (v: number) => string;
}) {
  const alturaSvg = altura + 8; // o entalhe do alvo passa 4px acima e abaixo
  const y = 4;

  if (linha.valor === null) {
    // Ausência: traço tracejado na linha de base, visivelmente diferente de
    // uma barra de R$ 0 — que é um fato, não uma lacuna.
    return (
      <svg
        className="fin-grafico-svg block"
        width={largura}
        height={alturaSvg}
        viewBox={`0 0 ${largura} ${alturaSvg}`}
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={10}
          y1={y + altura / 2}
          y2={y + altura / 2}
          stroke="var(--fin-eixo)"
          strokeWidth={2}
          strokeDasharray={TRACEJADO_AUSENCIA}
        />
      </svg>
    );
  }

  const { px, minuscula } = larguraDaMarca(num(linha.valor), maximo, largura);
  const r = Math.min(RAIO_PONTA, px / 2, altura / 2);
  const caminho =
    px <= 0
      ? ''
      : `M 0 ${y} H ${px - r} A ${r} ${r} 0 0 1 ${px} ${y + r} V ${y + altura - r} A ${r} ${r} 0 0 1 ${px - r} ${y + altura} H 0 Z`;

  const xAlvo =
    linha.alvo !== null && linha.alvo !== undefined && maximo > 0
      ? Math.min(largura, (num(linha.alvo) / maximo) * largura)
      : null;

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={alturaSvg}
      viewBox={`0 0 ${largura} ${alturaSvg}`}
      aria-hidden="true"
    >
      {caminho ? <path d={caminho} fill="var(--fin-serie-1)" /> : null}
      {/* Marca minúscula ganha linha-guia, NÃO ganha pixels: aumentar a barra
          para caber o dedo seria distorcer o valor que ela representa. */}
      {minuscula ? (
        <line x1={px} x2={px} y1={0} y2={alturaSvg} stroke="var(--fin-eixo)" strokeWidth={1} />
      ) : null}
      {xAlvo !== null ? (
        <line x1={xAlvo} x2={xAlvo} y1={0} y2={alturaSvg} stroke="var(--fin-eixo)" strokeWidth={2} />
      ) : null}
    </svg>
  );
}

function Lista({
  largura,
  linhas,
  maximo,
  referencia,
  formatar,
  alturaBarra,
  onAtivar,
}: {
  largura: number;
  linhas: LinhaBarra[];
  maximo: number;
  referencia: { valor: number; rotulo: string } | null;
  formatar: (v: number) => string;
  alturaBarra: number;
  onAtivar?: (id: string) => void;
}) {
  const { container } = useMolduraDoGrafico();
  const balao = useBalao(container);

  const xReferencia =
    referencia && maximo > 0 ? Math.min(largura, (num(referencia.valor) / maximo) * largura) : null;

  const conteudoDe = (linha: LinhaBarra) => ({
    id: linha.id,
    titulo: linha.nome,
    linhas: [
      linha.valor === null ? (linha.rotuloAusencia ?? 'sem dado no período') : formatar(linha.valor),
      ...(linha.alvo !== null && linha.alvo !== undefined ? [`meta ${formatar(linha.alvo)}`] : []),
      ...(linha.secundario ? [linha.secundario] : []),
      ...(linha.detalhes ?? []),
    ],
  });

  return (
    <div className="relative">
      {/* Referência: uma linha só, rotulada uma vez no topo. */}
      {xReferencia !== null ? (
        <>
          <div
            aria-hidden="true"
            style={{ left: xReferencia }}
            className="pointer-events-none absolute top-5 bottom-0 w-px bg-[var(--fin-eixo)]"
          />
          <p
            style={{ left: Math.min(Math.max(0, xReferencia), Math.max(0, largura - 4)) }}
            className="fin-t-caption absolute top-0 -translate-x-1/2 whitespace-nowrap text-[var(--fin-text-3)]"
          >
            {referencia!.rotulo}
          </p>
        </>
      ) : null}

      <ul className={cn('flex flex-col gap-2', xReferencia !== null && 'pt-5')}>
        {linhas.map(linha => {
          const dados = conteudoDe(linha);
          const rotulo = [dados.titulo, ...dados.linhas].join(' · ');
          const interativa = typeof onAtivar === 'function';
          return (
            <li key={linha.id}>
              {/* A LINHA INTEIRA é o alvo, com 44px de altura mínima: a barra
                  de 10px nunca seria alcançável com o dedo. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={rotulo}
                onMouseEnter={e => balao.abrir(e.currentTarget, dados, false)}
                onMouseLeave={() => {
                  if (!balao.porTeclado) balao.fechar();
                }}
                onFocus={e => balao.abrir(e.currentTarget, dados, true)}
                onBlur={() => balao.fechar()}
                onTouchStart={e => balao.abrir(e.currentTarget, dados, false)}
                onTouchEnd={() => balao.fecharDepoisDoToque()}
                onClick={() => onAtivar?.(linha.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onAtivar?.(linha.id);
                  }
                }}
                className={cn(
                  'flex min-h-[44px] flex-col justify-center gap-1 rounded-[var(--fin-r-sm)] py-1 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                  interativa && 'cursor-pointer hover:bg-[var(--fin-surface-2)]',
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="fin-t-body min-w-0 truncate text-[var(--fin-text)]">{linha.nome}</span>
                  <span className="fin-t-body-strong shrink-0 tabular-nums text-[var(--fin-text)]">
                    {linha.valor === null ? '—' : formatar(linha.valor)}
                  </span>
                </div>

                <Barra
                  linha={linha}
                  largura={largura}
                  maximo={maximo}
                  altura={alturaBarra}
                  formatar={formatar}
                />

                {linha.valor === null && linha.rotuloAusencia ? (
                  <span className="fin-t-caption text-[var(--fin-text-3)]">{linha.rotuloAusencia}</span>
                ) : linha.secundario ? (
                  <span className="fin-t-caption text-[var(--fin-text-3)]">{linha.secundario}</span>
                ) : null}

                {linha.chip ? <div className="flex">{linha.chip}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Balao
        container={container}
        conteudo={balao.conteudo}
        posicao={balao.posicao}
        porTeclado={balao.porTeclado}
      />
    </div>
  );
}

export function BarrasNomeadas({
  linhas,
  ordenacao = 'valor-desc',
  referencia = null,
  formatar,
  maximoVisivel = 8,
  alturaBarra = 10,
  onAtivar,
  fraseDeLinhaUnica,
}: BarrasNomeadasProps) {
  const [verTodas, setVerTodas] = React.useState(false);

  const ordenadas = React.useMemo(() => {
    if (ordenacao === 'dada') return linhas;
    // Ausência vai para o fim: ela não compete por posição, ela informa.
    return [...linhas].sort((a, b) => {
      if (a.valor === null && b.valor === null) return a.nome.localeCompare(b.nome, 'pt-BR');
      if (a.valor === null) return 1;
      if (b.valor === null) return -1;
      return num(b.valor) - num(a.valor);
    });
  }, [linhas, ordenacao]);

  // Escala comum: o máximo considera valores, alvos E a referência, senão o
  // entalhe de meta sai do quadro em quem ainda não chegou perto dela.
  const maximo = React.useMemo(() => {
    const candidatos = [
      ...ordenadas.map(l => (l.valor === null ? 0 : num(l.valor))),
      ...ordenadas.map(l => (l.alvo === null || l.alvo === undefined ? 0 : num(l.alvo))),
      referencia ? num(referencia.valor) : 0,
    ];
    return Math.max(0, ...candidatos);
  }, [ordenadas, referencia]);

  if (ordenadas.length === 0) return null;

  // Uma linha só: a barra sai. Barra de um item é um número com tinta em
  // volta, e a média de um é o próprio valor — a referência também não vai.
  if (ordenadas.length === 1) {
    const unica = ordenadas[0];
    return (
      <p className="fin-t-body text-[var(--fin-text-2)]">
        {fraseDeLinhaUnica?.(unica) ??
          `${unica.nome}: ${unica.valor === null ? (unica.rotuloAusencia ?? 'sem dado no período') : formatar(unica.valor)}`}
      </p>
    );
  }

  const visiveis = verTodas ? ordenadas : ordenadas.slice(0, maximoVisivel);
  const escondidas = ordenadas.length - visiveis.length;

  return (
    <div className="flex flex-col gap-3">
      <AreaDeGrafico>
        {largura => (
          <Lista
            largura={largura}
            linhas={visiveis}
            maximo={maximo}
            referencia={ordenadas.length > 1 ? referencia : null}
            formatar={formatar}
            alturaBarra={alturaBarra}
            onAtivar={onAtivar}
          />
        )}
      </AreaDeGrafico>

      {/* Contagem explícita: 'Outros' esconderia PESSOAS dentro de um rótulo. */}
      {escondidas > 0 || verTodas ? (
        <button
          type="button"
          onClick={() => setVerTodas(v => !v)}
          className="fin-no-print fin-t-body inline-flex h-11 items-center self-start rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]"
        >
          {verTodas ? 'Ver menos' : `Ver todas (${ordenadas.length})`}
        </button>
      ) : null}
    </div>
  );
}

export default BarrasNomeadas;
