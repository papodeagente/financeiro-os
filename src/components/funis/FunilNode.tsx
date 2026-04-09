'use client';

/**
 * Custom React Flow node para o simulador de funis.
 *
 * Renderiza qualquer tipo de node (28 tipos em 8 categorias) com header
 * colorido por categoria, body que muda se já foi simulado, e badge de
 * "Gargalo" quando este for o node com maior perda relativa.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import type { CategoriaNode, NodeConfig, NodeResultado, TipoNode } from '@/lib/funil-types';
import { formatBRL } from '@/lib/utils';
import { CATEGORIA_INFO } from './categorias';

interface FunilNodeData extends Record<string, unknown> {
  tipo: TipoNode;
  categoria: CategoriaNode;
  label: string;
  config: NodeConfig;
  resultado?: NodeResultado;
}

type FunilNodeType = Node<FunilNodeData, 'funilNode'>;

const HANDLE_STYLE: React.CSSProperties = {
  width: 9,
  height: 9,
  background: '#004aad',
  border: '2px solid #ffffff',
};

function FunilNodeInner({ data, selected }: NodeProps<FunilNodeType>) {
  const info = CATEGORIA_INFO[data.categoria];
  const r = data.resultado;
  const hasResult = !!r && r.entrantes > 0;
  const gargalo = r?.is_gargalo;

  return (
    <div
      className={`rounded-xl overflow-hidden shadow-lg transition-all ${selected ? 'ring-2 ring-[var(--t-green)]' : ''} ${gargalo ? 'ring-2 ring-red-500' : ''}`}
      style={{
        minWidth: 180,
        maxWidth: 220,
        background: '#ffffff',
        border: `1px solid ${info.color}22`,
      }}
    >
      <Handle id="t-top" type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-top" type="source" position={Position.Top} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="t-left" type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable />
      <Handle id="s-left" type="source" position={Position.Left} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="t-right" type="target" position={Position.Right} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="s-right" type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable />
      <Handle id="t-bottom" type="target" position={Position.Bottom} style={{ ...HANDLE_STYLE, opacity: 0 }} isConnectable />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable />

      {/* Header colorido pela categoria */}
      <div
        className="px-3 py-1.5 flex items-center gap-1.5"
        style={{ background: info.color, color: '#ffffff' }}
      >
        <span className="text-[9px] uppercase tracking-wider font-semibold opacity-90">
          {info.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 bg-white">
        <p className="text-[12px] font-semibold text-gray-900 leading-tight mb-1.5">{data.label}</p>

        {!hasResult && (
          <div className="text-[10px] text-gray-500 space-y-0.5">
            {typeof data.config.visitantes === 'number' && (
              <p>Visitantes: <span className="font-medium text-gray-700">{data.config.visitantes.toLocaleString('pt-BR')}</span></p>
            )}
            {typeof data.config.taxa_conversao === 'number' && (
              <p>Taxa: <span className="font-medium text-gray-700">{data.config.taxa_conversao.toFixed(0)}%</span></p>
            )}
            {typeof data.config.investimento === 'number' && data.config.investimento > 0 && (
              <p>Invest.: <span className="font-medium text-gray-700">{formatBRL(data.config.investimento)}</span></p>
            )}
            {typeof data.config.valor_produto === 'number' && data.config.valor_produto > 0 && (
              <p>Ticket: <span className="font-medium text-gray-700">{formatBRL(data.config.valor_produto)}</span></p>
            )}
          </div>
        )}

        {hasResult && (
          <div className="text-[10px] space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Entra:</span>
              <span className="font-medium text-gray-900">{r.entrantes.toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Converte:</span>
              <span className="font-semibold text-green-600">{r.convertidos.toLocaleString('pt-BR')}</span>
            </div>
            {r.perdidos > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Perde:</span>
                <span className="font-medium text-red-600">{r.perdidos.toLocaleString('pt-BR')}</span>
              </div>
            )}
            {r.receita > 0 && (
              <div className="flex items-center justify-between pt-1 mt-1 border-t border-gray-100">
                <span className="text-gray-500">Receita:</span>
                <span className="font-semibold text-green-700">{formatBRL(r.receita)}</span>
              </div>
            )}
            {r.custo > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Custo:</span>
                <span className="font-medium text-red-700">{formatBRL(r.custo)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer badge de gargalo */}
      {gargalo && (
        <div className="px-3 py-1 bg-red-50 text-red-600 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 border-t border-red-100">
          <AlertTriangle className="w-2.5 h-2.5" /> Gargalo do funil
        </div>
      )}

      {hasResult && !gargalo && r.convertidos > 0 && (
        <div className="px-3 py-1 bg-green-50 text-green-700 text-[9px] font-medium flex items-center gap-1 border-t border-green-100">
          <TrendingUp className="w-2.5 h-2.5" />
          {((r.convertidos / Math.max(1, r.entrantes)) * 100).toFixed(0)}% convertido
        </div>
      )}
    </div>
  );
}

export const FunilNode = memo(FunilNodeInner);
