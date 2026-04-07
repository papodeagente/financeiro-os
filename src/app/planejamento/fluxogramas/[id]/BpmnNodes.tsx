'use client';

/**
 * Custom BPMN node types for React Flow.
 * Cada nó renderiza no canvas com o formato BPMN correspondente
 * (círculos para eventos, retângulos arredondados para tarefas,
 * losangos para gateways, etc.) e expõe handles para conexão.
 */

import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  background: '#004aad',
  border: '2px solid #ffffff',
};

interface BpmnNodeData extends Record<string, unknown> {
  label?: string;
  description?: string;
  bgColor?: string;
  textColor?: string;
}

/**
 * Renderiza 4 handles bidirecionais (top/right/bottom/left).
 * Combinado com `connectionMode="loose"` no <ReactFlow>, qualquer um
 * dos 4 handles aceita iniciar OU receber uma conexão, permitindo
 * ligar nós por qualquer um dos lados em qualquer direção.
 *
 * Cada handle tem `id` único — sem isso, React Flow não consegue
 * distinguir handles do mesmo (type, position) e a conexão falha.
 *
 * Cada lado expõe DOIS handles sobrepostos (source + target) para que
 * a UI funcione tanto em loose mode quanto em strict mode, e para que
 * setas que terminam num lado apontem corretamente para o handle alvo.
 */
function withHandles(children: React.ReactNode) {
  return (
    <>
      <Handle id="t-top" type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-top" type="source" position={Position.Top} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="t-right" type="target" position={Position.Right} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-right" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="t-bottom" type="target" position={Position.Bottom} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="t-left" type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-left" type="source" position={Position.Left} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      {children}
    </>
  );
}

/* ---------- Start Event ---------- */
export const StartEventNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: `2px solid ${selected ? '#004aad' : '#16a34a'}`,
        background: d.bgColor || '#dcfce7',
        color: d.textColor || '#14532d',
        fontSize: 11,
        fontWeight: 600,
        textAlign: 'center',
        padding: 4,
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      {withHandles(<span className="px-1 leading-tight">{d.label || 'Início'}</span>)}
    </div>
  );
});
StartEventNode.displayName = 'StartEventNode';

/* ---------- End Event ---------- */
export const EndEventNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: `4px solid ${selected ? '#004aad' : '#dc2626'}`,
        background: d.bgColor || '#fee2e2',
        color: d.textColor || '#7f1d1d',
        fontSize: 11,
        fontWeight: 600,
        textAlign: 'center',
        padding: 4,
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      {withHandles(<span className="px-1 leading-tight">{d.label || 'Fim'}</span>)}
    </div>
  );
});
EndEventNode.displayName = 'EndEventNode';

/* ---------- Intermediate Event ---------- */
export const IntermediateEventNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: `2px solid ${selected ? '#004aad' : '#f59e0b'}`,
        background: d.bgColor || '#fef3c7',
        color: d.textColor || '#78350f',
        fontSize: 11,
        fontWeight: 600,
        textAlign: 'center',
        padding: 4,
        position: 'relative',
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 4,
          borderRadius: '50%',
          border: '2px solid #f59e0b',
          pointerEvents: 'none',
        }}
      />
      {withHandles(<span className="px-1 leading-tight">{d.label || 'Evento'}</span>)}
    </div>
  );
});
IntermediateEventNode.displayName = 'IntermediateEventNode';

/* ---------- Task ---------- */
export const TaskNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        minWidth: 140,
        minHeight: 70,
        padding: '10px 14px',
        borderRadius: 12,
        border: `2px solid ${selected ? '#004aad' : '#3b82f6'}`,
        background: d.bgColor || '#dbeafe',
        color: d.textColor || '#1e3a8a',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'center',
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      {withHandles(
        <div className="leading-tight">
          {d.label || 'Tarefa'}
          {d.description && (
            <div className="mt-1 text-[10px] font-normal opacity-80">{d.description}</div>
          )}
        </div>,
      )}
    </div>
  );
});
TaskNode.displayName = 'TaskNode';

/* ---------- User Task (com ícone de pessoa estilizado) ---------- */
export const UserTaskNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center"
      style={{
        minWidth: 150,
        minHeight: 70,
        padding: '10px 14px 10px 32px',
        borderRadius: 12,
        border: `2px solid ${selected ? '#004aad' : '#8b5cf6'}`,
        background: d.bgColor || '#ede9fe',
        color: d.textColor || '#4c1d95',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'left',
        position: 'relative',
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 8,
          top: 10,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#8b5cf6',
          color: '#fff',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ♟
      </span>
      {withHandles(
        <div className="leading-tight">
          {d.label || 'Tarefa de usuário'}
          {d.description && (
            <div className="mt-1 text-[10px] font-normal opacity-80">{d.description}</div>
          )}
        </div>,
      )}
    </div>
  );
});
UserTaskNode.displayName = 'UserTaskNode';

/* ---------- Service Task (sistema/automação) ---------- */
export const ServiceTaskNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center"
      style={{
        minWidth: 150,
        minHeight: 70,
        padding: '10px 14px 10px 32px',
        borderRadius: 12,
        border: `2px solid ${selected ? '#004aad' : '#0891b2'}`,
        background: d.bgColor || '#cffafe',
        color: d.textColor || '#164e63',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'left',
        position: 'relative',
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 8,
          top: 10,
          width: 18,
          height: 18,
          borderRadius: 4,
          background: '#0891b2',
          color: '#fff',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ⚙
      </span>
      {withHandles(
        <div className="leading-tight">
          {d.label || 'Serviço'}
          {d.description && (
            <div className="mt-1 text-[10px] font-normal opacity-80">{d.description}</div>
          )}
        </div>,
      )}
    </div>
  );
});
ServiceTaskNode.displayName = 'ServiceTaskNode';

/* ---------- Gateway (Decisão / Diamond) ---------- */
export const GatewayNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      style={{
        width: 80,
        height: 80,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 70,
          height: 70,
          background: d.bgColor || '#fef3c7',
          border: `2px solid ${selected ? '#004aad' : '#f59e0b'}`,
          transform: 'rotate(45deg)',
          position: 'absolute',
          boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
        }}
      />
      <div
        style={{
          position: 'relative',
          fontSize: 18,
          color: d.textColor || '#78350f',
          fontWeight: 700,
        }}
      >
        ×
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: -18,
          fontSize: 11,
          fontWeight: 600,
          color: '#1A1A1A',
          whiteSpace: 'nowrap',
        }}
      >
        {d.label || 'Decisão'}
      </div>
      {withHandles(<></>)}
    </div>
  );
});
GatewayNode.displayName = 'GatewayNode';

/* ---------- Subprocess ---------- */
export const SubprocessNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        minWidth: 160,
        minHeight: 80,
        padding: '10px 14px',
        borderRadius: 12,
        border: `2px solid ${selected ? '#004aad' : '#475569'}`,
        background: d.bgColor || '#f1f5f9',
        color: d.textColor || '#0f172a',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'center',
        position: 'relative',
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          bottom: 4,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 16,
          height: 16,
          border: '1.5px solid #475569',
          borderRadius: 3,
          fontSize: 12,
          lineHeight: '13px',
          textAlign: 'center',
          background: '#fff',
        }}
      >
        +
      </span>
      {withHandles(<span className="leading-tight">{d.label || 'Subprocesso'}</span>)}
    </div>
  );
});
SubprocessNode.displayName = 'SubprocessNode';

/* ---------- Annotation / Sticky note ---------- */
export const AnnotationNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <div
      style={{
        minWidth: 140,
        minHeight: 60,
        padding: 10,
        background: d.bgColor || '#fef9c3',
        border: `1px dashed ${selected ? '#004aad' : '#eab308'}`,
        color: d.textColor || '#713f12',
        fontSize: 12,
        borderRadius: 6,
        boxShadow: selected ? '0 0 0 3px rgba(0,74,173,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      {withHandles(<>{d.label || 'Anotação...'}</>)}
    </div>
  );
});
AnnotationNode.displayName = 'AnnotationNode';

/* ---------- Pool / Lane ---------- */
export const PoolNode = memo(({ data, selected }: NodeProps) => {
  const d = data as BpmnNodeData;
  return (
    <>
      <NodeResizer minWidth={300} minHeight={140} isVisible={selected} lineClassName="!border-[#004aad]" handleClassName="!bg-[#004aad]" />
      <div
        style={{
          width: '100%',
          height: '100%',
          background: d.bgColor || 'rgba(241, 245, 249, 0.4)',
          border: `2px solid ${selected ? '#004aad' : '#94a3b8'}`,
          borderRadius: 8,
          display: 'flex',
        }}
      >
        <div
          style={{
            width: 28,
            background: d.textColor || '#94a3b8',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            borderRadius: '6px 0 0 6px',
            letterSpacing: 1,
          }}
        >
          {d.label || 'Pool'}
        </div>
        {withHandles(<></>)}
      </div>
    </>
  );
});
PoolNode.displayName = 'PoolNode';

export const NODE_TYPES = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  intermediateEvent: IntermediateEventNode,
  task: TaskNode,
  userTask: UserTaskNode,
  serviceTask: ServiceTaskNode,
  gateway: GatewayNode,
  subprocess: SubprocessNode,
  annotation: AnnotationNode,
  pool: PoolNode,
};
