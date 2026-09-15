'use client';

import * as React from 'react';

import { ALVO_MIN, alvosSemColisao } from '@/lib/escala';
import { useMolduraDoGrafico } from '@/components/fin/GraficoMoldura';
import { Balao, useBalao } from '@/components/fin/Balao';

/**
 * A camada que torna uma marca de SVG consultável — no ponteiro, no dedo e no
 * teclado.
 *
 * O ALVO CRESCE, A MARCA NÃO. Doze barras em 343px dão 28px cada, menor que o
 * dedo; aumentar a barra resolveria o toque mentindo sobre o valor. O que
 * cresce aqui é um retângulo invisível, que divide o vão com o vizinho em vez
 * de invadi-lo. A marca sob o ponteiro também não cresce nem se move: crescer
 * mudaria o comprimento, que é o próprio dado.
 */

export type AlvoDeToque = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 'Receita da agência' */
  titulo: string;
  /** ['R$ 15.910,00', '51,6% de R$ 30.818,00'] — valores CHEIOS. */
  linhas: string[];
  onAtivar?: () => void;
};

export type CamadaDeToqueProps = {
  alvos: AlvoDeToque[];
  larguraSvg: number;
  alturaSvg: number;
  /** Só para gráfico com eixo x contínuo. Barra e pastilha não têm crosshair. */
  crosshair?: { x: (id: string) => number; altura: number } | null;
  onAtivar?: (id: string) => void;
};

function textoDoAlvo(alvo: AlvoDeToque): string {
  return [alvo.titulo, ...alvo.linhas].join(' · ');
}

export function CamadaDeToque({
  alvos,
  larguraSvg,
  alturaSvg,
  crosshair = null,
  onAtivar,
}: CamadaDeToqueProps) {
  const { container } = useMolduraDoGrafico();
  const balao = useBalao(container);

  // Alvos expandidos até 44px sem invadir o vizinho.
  const expandidos = React.useMemo(() => {
    const bandas = alvosSemColisao(
      alvos.map(a => ({ id: a.id, x: a.x, w: a.w })),
      larguraSvg,
    );
    const porId = new Map(bandas.map(b => [b.id, b]));
    return alvos.map(a => {
      const banda = porId.get(a.id) ?? { x: a.x, w: a.w };
      const altura = Math.min(alturaSvg, Math.max(ALVO_MIN, a.h));
      const meio = a.y + a.h / 2;
      const y = Math.min(Math.max(0, meio - altura / 2), Math.max(0, alturaSvg - altura));
      return { ...a, x: banda.x, w: banda.w, y, h: altura };
    });
  }, [alvos, larguraSvg, alturaSvg]);

  const ativar = (alvo: AlvoDeToque) => {
    alvo.onAtivar?.();
    onAtivar?.(alvo.id);
  };

  const andarNoFoco = (indice: number, passo: number, e: React.KeyboardEvent<SVGRectElement>) => {
    const proximo = expandidos[indice + passo];
    if (!proximo) return;
    e.preventDefault();
    const el = e.currentTarget.parentElement?.querySelector<SVGRectElement>(
      `[data-alvo="${CSS.escape(proximo.id)}"]`,
    );
    el?.focus();
  };

  if (expandidos.length === 0) return null;

  const idAtivo = balao.conteudo?.id ?? null;
  const xDoCrosshair = crosshair && idAtivo ? crosshair.x(idAtivo) : null;

  return (
    <>
      <g data-fin-camada-toque="">
        {/* Crosshair SÓLIDO: tracejado, neste sistema, significa ausência. */}
        {xDoCrosshair !== null && Number.isFinite(xDoCrosshair) ? (
          <line
            x1={xDoCrosshair}
            x2={xDoCrosshair}
            y1={0}
            y2={crosshair!.altura}
            stroke="var(--fin-eixo)"
            strokeWidth={1}
            pointerEvents="none"
          />
        ) : null}

        {expandidos.map((alvo, i) => (
          <rect
            key={alvo.id}
            data-alvo={alvo.id}
            x={alvo.x}
            y={alvo.y}
            width={Math.max(0, alvo.w)}
            height={Math.max(0, alvo.h)}
            fill="transparent"
            pointerEvents="all"
            tabIndex={0}
            role="button"
            aria-label={textoDoAlvo(alvo)}
            className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--fin-accent)]"
            onMouseEnter={e => balao.abrir(e.currentTarget, alvo, false)}
            onMouseLeave={() => {
              if (!balao.porTeclado) balao.fechar();
            }}
            onFocus={e => balao.abrir(e.currentTarget, alvo, true)}
            onBlur={() => balao.fechar()}
            onTouchStart={e => balao.abrir(e.currentTarget, alvo, false)}
            onTouchEnd={() => balao.fecharDepoisDoToque()}
            onClick={() => ativar(alvo)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                ativar(alvo);
                return;
              }
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') andarNoFoco(i, 1, e);
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') andarNoFoco(i, -1, e);
            }}
          />
        ))}
      </g>

      <Balao
        container={container}
        conteudo={balao.conteudo}
        posicao={balao.posicao}
        porTeclado={balao.porTeclado}
      />
    </>
  );
}

export default CamadaDeToque;
