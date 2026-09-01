'use client';

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

// Curva orgânica entre nodes — estilo MindMeister. Sai do handle do
// parent e chega no handle do filho com uma curva bezier horizontal.
// Funciona simetricamente nos dois lados via positions.
// `faded` esmaece a conexão do nó sendo arrastado.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data,
  } = props;

  const d = data as { color?: string; faded?: boolean } | undefined;
  const color = d?.color || '#3B82F6';

  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.35,
  });

  return (
    <BaseEdge
      path={edgePath}
      style={{
        stroke: color,
        strokeWidth: 1.5,
        fill: 'none',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: d?.faded ? 0.25 : 0.85,
      }}
    />
  );
}
