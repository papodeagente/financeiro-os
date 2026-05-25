'use client';

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

// Edge curva entre nodes do mapa mental — funciona simétrica nos dois
// lados (left/right) porque getBezierPath usa source/target positions.
// Traço sólido com gradiente sutil pra dar profundidade.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data, id,
  } = props;

  const color = (data as { color?: string } | undefined)?.color || '#94a3b8';

  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.45,
  });

  const gradId = `mind-edge-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: 2.5,
          fill: 'none',
          strokeLinecap: 'round',
        }}
      />
    </>
  );
}
