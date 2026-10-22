'use client';

import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

// Curva orgânica entre nodes — estilo MindMeister. Sai do handle do
// parent e chega no handle do filho com uma curva bezier horizontal.
// Funciona simetricamente nos dois lados via positions.
// `faded` esmaece a conexão do nó sendo arrastado.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data,
  } = props;

  const d = data as { color?: string; faded?: boolean; ortogonal?: boolean } | undefined;
  const color = d?.color || 'var(--fin-accent)';

  // Organograma liga em cotovelo, não em curva: a linha reta com dobra de
  // 90° é o que diz "hierarquia" em vez de "associação". É a diferença
  // visual inteira entre um org chart e um mapa mental.
  const [edgePath] = d?.ortogonal
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });

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
