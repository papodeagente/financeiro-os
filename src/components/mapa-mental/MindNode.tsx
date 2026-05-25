'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { ChevronRight, ChevronLeft, Plus, StickyNote } from 'lucide-react';

export interface MindNodeData extends Record<string, unknown> {
  text: string;
  depth: number;
  color: string;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
  editing: boolean;
  side: 'left' | 'right';
  icon?: string;
  hasNotes?: boolean;
  onCommitEdit: (text: string) => void;
  onStartEdit: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
}

type MindNodeType = Node<MindNodeData, 'mindNode'>;

function MindNodeInner({ data, selected }: NodeProps<MindNodeType>) {
  const { text, color, isRoot, collapsed, childCount, editing, side, icon, hasNotes } = data;
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(text);

  useEffect(() => { setLocal(text); }, [text]);

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      el.select();
    }
  }, [editing]);

  const commit = () => {
    const v = local.trim();
    data.onCommitEdit(v === '' ? text : v);
  };

  // ============ RAIZ ============
  if (isRoot) {
    return (
      <div className="relative group" onDoubleClick={() => data.onStartEdit()}>
        <Handle type="source" position={Position.Right} id="r" style={handleStyle(color)} />
        <Handle type="source" position={Position.Left} id="l" style={handleStyle(color)} />
        <div
          className={`flex items-center gap-2 px-6 py-3.5 rounded-[18px] text-white font-bold text-[15px] transition-all ${
            selected ? 'ring-4' : ''
          }`}
          style={{
            background: `linear-gradient(135deg, ${color} 0%, ${shade(color, -18)} 100%)`,
            boxShadow: selected
              ? `0 12px 36px ${color}66, 0 0 0 4px ${color}33, inset 0 1px 0 rgba(255,255,255,0.35)`
              : `0 10px 28px ${color}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
            minWidth: 200,
            // @ts-expect-error css var
            '--tw-ring-color': `${color}33`,
          }}
        >
          {icon && <span className="text-lg leading-none shrink-0">{icon}</span>}
          {editing ? (
            <input
              ref={inputRef}
              value={local}
              onChange={e => setLocal(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { setLocal(text); data.onCommitEdit(text); }
              }}
              className="flex-1 bg-transparent text-white placeholder-white/60 outline-none font-bold"
              placeholder="Ideia central"
            />
          ) : (
            <span className="flex-1 truncate">{text || 'Ideia central'}</span>
          )}
          {hasNotes && <StickyNote className="w-3.5 h-3.5 text-white/80 shrink-0" />}
        </div>
        {/* Botão "+" inline aparece no hover/selected */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
          className={`absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-white shadow-lg flex items-center justify-center transition-all ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          style={{
            background: color,
            right: -38,
            boxShadow: `0 4px 12px ${color}55`,
          }}
          title="Adicionar filho (Tab)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ============ FILHO ============
  const isLeft = side === 'left';
  const handleSource = isLeft ? Position.Left : Position.Right;
  const handleTarget = isLeft ? Position.Right : Position.Left;

  return (
    <div className="relative group" onDoubleClick={() => data.onStartEdit()}>
      <Handle type="target" position={handleTarget} id="t" style={handleStyle(color)} />
      <Handle type="source" position={handleSource} id="s" style={handleStyle(color)} />
      <div
        className={`flex items-center gap-1.5 rounded-[12px] bg-white transition-all ${
          isLeft ? 'flex-row-reverse pr-3 pl-2' : 'pl-3 pr-2'
        } py-2`}
        style={{
          borderBottom: `3px solid ${color}`,
          boxShadow: selected
            ? `0 0 0 2px ${color}, 0 8px 20px ${color}30`
            : `0 2px 8px rgba(15,23,42,0.08), 0 1px 0 rgba(15,23,42,0.04)`,
          minWidth: 140,
        }}
      >
        {/* Toggle collapse — fica do lado oposto ao crescimento */}
        {childCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors"
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {isLeft ? (
              <ChevronLeft
                className="w-3 h-3 text-slate-500 transition-transform"
                style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(-90deg)' }}
              />
            ) : (
              <ChevronRight
                className="w-3 h-3 text-slate-500 transition-transform"
                style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
              />
            )}
          </button>
        )}
        {icon && <span className="text-sm leading-none shrink-0">{icon}</span>}
        {editing ? (
          <input
            ref={inputRef}
            value={local}
            onChange={e => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setLocal(text); data.onCommitEdit(text); }
            }}
            className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 outline-none text-sm font-medium"
            placeholder="Novo tópico"
          />
        ) : (
          <span className="flex-1 truncate text-sm font-medium text-slate-800">{text || 'Novo tópico'}</span>
        )}
        {hasNotes && <StickyNote className="w-3 h-3 text-amber-500 shrink-0" />}
      </div>

      {/* Indicador de filhos recolhidos */}
      {collapsed && childCount > 0 && (
        <span
          className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
          style={{
            background: color,
            [isLeft ? 'left' : 'right']: -28,
          }}
          title={`${childCount} ${childCount === 1 ? 'filho recolhido' : 'filhos recolhidos'}`}
        >
          {childCount}
        </span>
      )}

      {/* Botão "+" inline (aparece selected/hover) */}
      <button
        onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
        className={`absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-white shadow flex items-center justify-center transition-all ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{
          background: color,
          [isLeft ? 'left' : 'right']: -32,
          boxShadow: `0 2px 8px ${color}55`,
        }}
        title="Adicionar filho (Tab)"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function handleStyle(color: string): React.CSSProperties {
  return {
    width: 6, height: 6,
    background: color,
    border: 'none',
    opacity: 0,
  };
}

function shade(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round((percent / 100) * 255)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round((percent / 100) * 255)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round((percent / 100) * 255)));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export const MindNode = memo(MindNodeInner);
