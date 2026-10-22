'use client';

import { BaseEdge, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { Costela } from '@/lib/mapa-mental';

// Curva orgânica entre nodes — estilo MindMeister. Sai do handle do
// parent e chega no handle do filho com uma curva bezier horizontal.
// Funciona simetricamente nos dois lados via positions.
// `faded` esmaece a conexão do nó sendo arrastado.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data,
  } = props;

  const d = data as { color?: string; faded?: boolean; estilo?: 'curva' | 'cotovelo' | 'espinha'; nivel?: number; costela?: Costela } | undefined;
  const color = d?.color || 'var(--fin-accent)';
  const traco = {
    stroke: color,
    strokeWidth: 1.5,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity: d?.faded ? 0.25 : 0.85,
  };
  const geom = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };

  // Espinha de peixe: a ligação não vai de caixa a caixa, vai pela costela.
  // Da cabeça para a família: a espinha dorsal (cinza, opaca — todas as
  // famílias desenham a mesma linha no mesmo lugar, e opaca ela não escurece
  // onde se sobrepõe) mais a costela, na cor da família, do encaixe ao
  // rótulo. Da família para a causa: uma linha deitada da causa até a costela.
  // Mais fundo que isso, uma reta.
  if (d?.estilo === 'espinha') {
    const c = d.costela;
    if (c && d.nivel === 1) {
      return (
        <>
          <BaseEdge
            path={`M ${sourceX} ${c.encaixeY} H ${c.caudaX}`}
            style={{ stroke: 'var(--fin-border-strong)', strokeWidth: 2.5, fill: 'none', strokeLinecap: 'round', opacity: 1 }}
          />
          <BaseEdge path={`M ${c.encaixeX} ${c.encaixeY} L ${targetX} ${targetY}`} style={traco} />
        </>
      );
    }
    if (c && d.nivel === 2) {
      const t = (targetY - c.encaixeY) / ((c.pontaY - c.encaixeY) || 1);
      const naCostela = c.encaixeX + (c.pontaX - c.encaixeX) * t;
      return <BaseEdge path={`M ${targetX} ${targetY} H ${naCostela}`} style={traco} />;
    }
    const [reta] = getStraightPath(geom);
    return <BaseEdge path={reta} style={traco} />;
  }

  // Dois traços, dois significados. Cotovelo (dobra de 90°) diz hierarquia:
  // organograma, matriz, linha do tempo. Curva diz associação: o mapa mental.
  // Quem escolhe é estiloDaLigacao, no modelo.
  const [edgePath] = d?.estilo === 'cotovelo'
    ? getSmoothStepPath({ ...geom, borderRadius: 8 })
    : getBezierPath({ ...geom, curvature: 0.35 });

  return <BaseEdge path={edgePath} style={traco} />;
}
