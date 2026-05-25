'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { ChevronRight, Plus } from 'lucide-react';

export interface MindNodeData extends Record<string, unknown> {
  text: string;
  depth: number;
  color: string;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
  editing: boolean;
  onCommitEdit: (text: string) => void;
  onStartEdit: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
}

type MindNodeType = Node<MindNodeData, 'mindNode'>;

function MindNodeInner({ data, selected }: NodeProps<MindNodeType>) {
  const { text, depth, color, isRoot, collapsed, childCount, editing } = data;
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

  // Visual diferenciado pra raiz (pill grande colorido) vs filhos
  // (pill menor com sombra colorida sutil)
  if (isRoot) {
    return (
      <div className="relative" onDoubleClick={() => data.onStartEdit()}>
        <Handle type="source" position={Position.Right} style={handleStyle(color)} />
        <div
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-bold text-base transition-all ${
            selected ? 'ring-4 ring-offset-2' : ''
          }`}
          style={{
            background: `linear-gradient(135deg, ${color} 0%, ${shade(color, -12)} 100%)`,
            boxShadow: `0 8px 24px ${color}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
            minWidth: 200,
            // @ts-expect-error css var
            '--tw-ring-color': `${color}55`,
          }}
        >
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
            />
          ) : (
            <span className="flex-1 truncate">{text || 'Ideia central'}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative group" onDoubleClick={() => data.onStartEdit()}>
      <Handle type="target" position={Position.Left} style={handleStyle(color)} />
      <Handle type="source" position={Position.Right} style={handleStyle(color)} />
      <div
        className={`flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-xl bg-white border-2 transition-all ${
          selected ? 'shadow-lg' : 'hover:shadow-md'
        }`}
        style={{
          borderColor: color,
          boxShadow: selected ? `0 0 0 3px ${color}25, 0 4px 14px ${color}30` : `0 2px 8px rgba(15,23,42,0.06)`,
          minWidth: 160,
        }}
      >
        {/* Toggle collapse */}
        {childCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors"
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            <ChevronRight
              className="w-3 h-3 text-slate-500 transition-transform"
              style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
            />
          </button>
        )}
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
          />
        ) : (
          <span className="flex-1 truncate text-sm font-medium text-slate-800">{text || '...'}</span>
        )}
        {/* Botao add child no hover */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: color }}
          title="Adicionar filho (Tab)"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {collapsed && childCount > 0 && (
        <span
          className="absolute -right-7 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
          style={{ background: color }}
          title={`${childCount} ${childCount === 1 ? 'filho recolhido' : 'filhos recolhidos'}`}
        >
          {childCount}
        </span>
      )}
    </div>
  );
}

function handleStyle(color: string): React.CSSProperties {
  return {
    width: 8, height: 8,
    background: color, border: '2px solid white',
    opacity: 0.6,
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
