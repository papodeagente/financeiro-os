'use client';

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useId } from 'react';

// Edge premium pro simulador de funil:
//
//   - linha base com stroke gradient (azul -> emerald) que sugere
//     "atravessar o funil"
//   - linha overlay com stroke-dashoffset animado (tracinhos que correm
//     ao longo do caminho — sensacao de "dado passando")
//   - 2 particulas SVG (circulos) que percorrem o path via animateMotion
//     em loop continuo, com fade in/out — visualizando o fluxo
//   - taxa de conversao renderizada como label flutuante centralizada
//     (quando data.taxa_conversao_override existe)
//
// Tudo SVG puro + CSS — zero deps, render leve, nao impacta motor de
// simulacao do funil.

export interface AnimatedFlowEdgeData {
  taxa_conversao_override?: number | null;
}

export function AnimatedFlowEdge(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, selected, data,
  } = props;

  // Path geometrico — smoothstep com curvatura suave 8px (mesmo padrao
  // do reactflow nativo, garante visual consistente).
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 12,
  });

  // ID unico do gradient — react-flow pode ter varias edges, cada
  // <linearGradient> precisa de id distinto pra nao colidir.
  const reactKey = useId().replace(/:/g, '');
  const gradId = `flow-grad-${id}-${reactKey}`;
  const pathId = `flow-path-${id}-${reactKey}`;
  const markerId = `flow-marker-${id}-${reactKey}`;

  const taxa = (data as AnimatedFlowEdgeData | undefined)?.taxa_conversao_override;
  const hasOverride = typeof taxa === 'number' && taxa >= 0 && taxa <= 1;
  const stroke = selected ? '#0a84ff' : '#3b82f6';

  return (
    <>
      {/* Definicoes: gradient + marker da seta */}
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.95" />
        </linearGradient>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
        </marker>
      </defs>

      {/* Path INVISIVEL usado como referencia pelo animateMotion das
          particulas. Mantemos um id estavel pra mpath funcionar. */}
      <path id={pathId} d={edgePath} fill="none" stroke="none" />

      {/* Camada 1: linha base com gradient — visual principal da edge */}
      <BaseEdge
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: selected ? 3 : 2,
          fill: 'none',
          opacity: 0.85,
          transition: 'stroke-width 200ms ease',
        }}
      />

      {/* Camada 2: overlay com dash-offset animado — tracinhos correndo */}
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 1.5 : 1}
        strokeDasharray="6 8"
        opacity={0.6}
        className="funil-edge-flow"
        pointerEvents="none"
      />

      {/* Camada 3: 2 particulas SVG que correm o path (offset 50% pra
          fluxo continuo). Glow sutil em volta de cada uma. */}
      <circle r="3.5" fill={stroke} opacity="0.9" pointerEvents="none">
        <animateMotion dur="3.5s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <animate
          attributeName="opacity"
          values="0;0.95;0.95;0"
          keyTimes="0;0.15;0.85;1"
          dur="3.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle r="3" fill="#10b981" opacity="0" pointerEvents="none">
        <animateMotion dur="3.5s" begin="1.75s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <animate
          attributeName="opacity"
          values="0;0.85;0.85;0"
          keyTimes="0;0.15;0.85;1"
          dur="3.5s"
          begin="1.75s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Label de taxa de conversao override (quando setada manualmente) */}
      {hasOverride && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white border border-blue-200 text-blue-700 shadow-sm tabular-nums"
            title="Taxa de conversão definida manualmente nesta conexão"
          >
            {(taxa! * 100).toFixed(1)}%
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
