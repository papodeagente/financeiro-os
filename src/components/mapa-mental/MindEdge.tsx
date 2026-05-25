'use client';

import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

// Edge em L (smoothstep) entre nodes — estilo XMind/Whimsical clean.
// Sai do handle do parent, faz um canto arredondado e chega no handle
// do filho. Funciona simetricamente nos dois lados via positions.
export function MindEdge(props: EdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data,
  } = props;

  const color = (data as { color?: string } | undefined)?.color || '#3B82F6';

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 16,
    offset: 20,
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
        opacity: 0.85,
      }}
    />
  );
}
