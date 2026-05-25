'use client';

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

// Edge curva suave entre nodes do mapa mental. Sem seta (visual organico),
// stroke colorido com base na cor do node alvo (passado via data.color).
// Tapered: comeca finino na origem (parent), engrossa no alvo (child) —
// MindMeister style.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data, id,
  } = props;

  const color = (data as { color?: string } | undefined)?.color || '#94a3b8';

  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.5,
  });

  const gradId = `mind-edge-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: 3,
          fill: 'none',
          strokeLinecap: 'round',
        }}
      />
    </>
  );
}
