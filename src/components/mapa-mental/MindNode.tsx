'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeToolbar, type NodeProps, type Node } from '@xyflow/react';
import {
  ChevronRight, ChevronLeft, Plus, StickyNote,
  Palette, Smile, MessageSquare, MoreHorizontal, Trash2,
  Link2, Paperclip, Image as ImageIcon,
} from 'lucide-react';

const QUICK_COLORS = ['#3B82F6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#475569'];
const QUICK_ICONS = ['💡', '⭐', '🎯', '🚀', '⚡', '🔥', '✅', '❓', '📌', '💰'];

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
  // Fase 2 — dados ricos
  image?: { url: string; alt?: string };
  links?: { label: string; url: string }[];
  attachments?: { name: string; url: string }[];
  shape?: 'rounded' | 'pill' | 'rect';
  bold?: boolean;
  // Callbacks
  onCommitEdit: (text: string) => void;
  onStartEdit: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
  onSetColor?: (c: string | undefined) => void;
  onSetIcon?: (i: string | undefined) => void;
  onOpenPanel?: (section?: 'image' | 'links' | 'attachments' | 'notes') => void;
  onDelete?: () => void;
  /** Adiciona irmão depois do commit (Enter num filho) */
  onAddSibling?: () => void;
}

type MindNodeType = Node<MindNodeData, 'mindNode'>;

function MindNodeInner({ data, selected }: NodeProps<MindNodeType>) {
  const {
    text, color, isRoot, collapsed, childCount, editing, side,
    icon, hasNotes, image, links, attachments, shape, bold,
  } = data;
  const hasLinks = !!(links && links.length);
  const hasAttachments = !!(attachments && attachments.length);
  const hasImage = !!(image && image.url);
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

  const [openPicker, setOpenPicker] = useState<null | 'color' | 'icon'>(null);

  // Toolbar contextual flutuante (renderizada acima do nó via NodeToolbar)
  const contextualToolbar = !editing && selected ? (
    <NodeToolbar position={Position.Top} offset={10} isVisible>
      <div
        className="bg-white rounded-xl border border-slate-200 px-1.5 py-1.5 flex items-center gap-0.5"
        style={{ boxShadow: '0 6px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)' }}
      >
        {/* Cor */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setOpenPicker(p => p === 'color' ? null : 'color'); }}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 inline-flex items-center"
            title="Cor"
          >
            <Palette className="w-3.5 h-3.5" />
            <span className="ml-1 w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          </button>
          {openPicker === 'color' && (
            <div
              className="absolute top-full mt-2 left-0 bg-white rounded-lg border border-slate-200 p-2 flex flex-wrap gap-1 w-[160px] z-50"
              style={{ boxShadow: '0 10px 32px rgba(15,23,42,0.18)' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => { data.onSetColor?.(undefined); setOpenPicker(null); }}
                className="w-6 h-6 rounded-full border-2 border-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-500 hover:scale-110 transition-transform"
                title="Auto"
              >
                A
              </button>
              {QUICK_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { data.onSetColor?.(c); setOpenPicker(null); }}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                  style={{ background: c, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Ícone */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setOpenPicker(p => p === 'icon' ? null : 'icon'); }}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
            title="Ícone"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          {openPicker === 'icon' && (
            <div
              className="absolute top-full mt-2 left-0 bg-white rounded-lg border border-slate-200 p-2 flex flex-wrap gap-1 w-[180px] z-50"
              style={{ boxShadow: '0 10px 32px rgba(15,23,42,0.18)' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => { data.onSetIcon?.(undefined); setOpenPicker(null); }}
                className="w-7 h-7 rounded text-[10px] text-slate-500 border border-slate-200 hover:bg-slate-50"
              >∅</button>
              {QUICK_ICONS.map(ic => (
                <button
                  key={ic}
                  onClick={() => { data.onSetIcon?.(ic); setOpenPicker(null); }}
                  className="w-7 h-7 rounded text-base hover:bg-slate-100 transition-colors"
                >
                  {ic}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        {/* Imagem */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onOpenPanel?.('image'); }}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasImage ? 'text-blue-600' : 'text-slate-600'}`}
          title="Imagem"
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>

        {/* Anexo */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onOpenPanel?.('attachments'); }}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasAttachments ? 'text-blue-600' : 'text-slate-600'}`}
          title="Anexo"
        >
          <Paperclip className="w-3.5 h-3.5" />
        </button>

        {/* Link */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onOpenPanel?.('links'); }}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasLinks ? 'text-blue-600' : 'text-slate-600'}`}
          title="Link"
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        {/* Nota */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onOpenPanel?.('notes'); }}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasNotes ? 'text-amber-500' : 'text-slate-600'}`}
          title="Nota"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>

        {/* Mais */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onOpenPanel?.(); }}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
          title="Mais opções"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Apagar (só filhos) */}
        {!isRoot && (
          <>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelete?.(); }}
              className="p-1.5 rounded-md hover:bg-red-50 text-slate-500 hover:text-red-600"
              title="Apagar (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </NodeToolbar>
  ) : null;

  // Mapeia shape → border-radius
  const shapeRadius = shape === 'pill' ? 9999 : shape === 'rect' ? 4 : 12;
  const textBold = bold !== false;  // raiz: bold default = true se não definido

  // ============ RAIZ ============
  if (isRoot) {
    const rootRadius = shape === 'pill' ? 9999 : shape === 'rect' ? 8 : 12;
    return (
      <div className="relative group" onDoubleClick={() => data.onStartEdit()}>
        {contextualToolbar}
        <Handle type="source" position={Position.Right} id="r" style={bulletHandle(color)} />
        <Handle type="source" position={Position.Left}  id="l" style={bulletHandle(color)} />
        <div
          className="bg-white transition-all overflow-hidden"
          style={{
            border: `2px solid ${color}`,
            borderRadius: rootRadius,
            boxShadow: selected
              ? `0 0 0 4px ${color}22, 0 6px 18px ${color}25`
              : `0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)`,
            minWidth: 180,
          }}
        >
          {hasImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image!.url}
              alt={image!.alt || ''}
              className="w-full h-24 object-cover"
              draggable={false}
            />
          )}
          <div className="flex items-center gap-2 px-5 py-3">
            {icon && <span className="text-lg leading-none shrink-0">{icon}</span>}
            {editing ? (
              <input
                ref={inputRef}
                value={local}
                onChange={e => setLocal(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const v = local.trim();
                    data.onCommitEdit(v === '' ? text : v);
                    setTimeout(() => data.onAddChild(), 0);
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const v = local.trim();
                    data.onCommitEdit(v === '' ? text : v);
                    setTimeout(() => data.onAddChild(), 0);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setLocal(text);
                    data.onCommitEdit(text);
                  }
                }}
                className={`flex-1 bg-transparent outline-none text-slate-900 text-center text-[15px] ${textBold ? 'font-bold' : 'font-normal'}`}
                placeholder="Ideia central"
                size={Math.max(local.length, 12)}
                style={{ fieldSizing: 'content', maxWidth: 600 } as React.CSSProperties}
              />
            ) : (
              <span
                className={`flex-1 text-center text-slate-900 text-[15px] leading-snug break-words ${textBold ? 'font-bold' : 'font-normal'}`}
                style={{ whiteSpace: 'pre-wrap', maxWidth: 600 }}
              >
                {text || 'Ideia central'}
              </span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {hasNotes && <StickyNote className="w-3.5 h-3.5 text-amber-500" />}
              {hasLinks && <Link2 className="w-3.5 h-3.5 text-blue-500" />}
              {hasAttachments && <Paperclip className="w-3.5 h-3.5 text-slate-500" />}
            </div>
          </div>
        </div>
        {/* Botão "+" flutuante */}
        {selected && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
            className="absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-white flex items-center justify-center transition-all"
            style={{
              background: color,
              right: -38,
              boxShadow: `0 4px 12px ${color}55`,
            }}
            title="Adicionar filho (Tab)"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // ============ FILHO — apenas texto, sem caixa ============
  const isLeft = side === 'left';
  // Convenção: handle id corresponde à posição lateral ('l' ou 'r').
  // Source fica no lado de crescimento, target no lado oposto.
  const sourceSide: 'l' | 'r' = isLeft ? 'l' : 'r';
  const targetSide: 'l' | 'r' = isLeft ? 'r' : 'l';
  const handleSource = isLeft ? Position.Left : Position.Right;
  const handleTarget = isLeft ? Position.Right : Position.Left;

  // Se shape definida → caixa branca com borda colorida. Caso contrário,
  // texto puro (estilo XMind/Whimsical default).
  const hasShape = !!shape;
  const childBoxStyle: React.CSSProperties = hasShape
    ? {
        background: '#ffffff',
        border: `1.5px solid ${color}`,
        borderRadius: shapeRadius,
        boxShadow: selected
          ? `0 0 0 3px ${color}33, 0 4px 12px ${color}20`
          : `0 1px 3px rgba(15,23,42,0.06)`,
        padding: '6px 12px',
        minWidth: 60,
      }
    : {
        background: selected ? `${color}10` : 'transparent',
        outline: selected ? `2px solid ${color}` : 'none',
        borderRadius: 6,
        padding: '4px 8px',
        minWidth: 60,
      };

  return (
    <div className={`relative group ${isLeft ? 'text-right' : 'text-left'}`} onDoubleClick={() => data.onStartEdit()}>
      {contextualToolbar}
      <Handle type="target" position={handleTarget} id={targetSide} style={bulletHandle(color)} />
      <Handle type="source" position={handleSource} id={sourceSide} style={bulletHandle(color)} />
      {hasImage && (
        <div className={`mb-1.5 ${isLeft ? 'flex justify-end' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image!.url}
            alt={image!.alt || ''}
            className="rounded-md border border-slate-200 max-w-[180px] max-h-[100px] object-cover"
            draggable={false}
          />
        </div>
      )}
      <div
        className={`inline-flex items-center gap-1.5 transition-all ${isLeft ? 'flex-row-reverse' : ''}`}
        style={childBoxStyle}
      >
        {/* Toggle collapse */}
        {childCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center hover:bg-slate-200 transition-colors"
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
          // Input cresce com o conteúdo via field-sizing (Chrome 123+/
          // Safari 18+/Firefox 124+); browsers antigos usam o atributo
          // HTML `size` (chars). max-width evita explodir o canvas.
          <input
            ref={inputRef}
            value={local}
            onChange={e => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const v = local.trim();
                data.onCommitEdit(v === '' ? text : v);
                setTimeout(() => data.onAddSibling?.(), 0);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                const v = local.trim();
                data.onCommitEdit(v === '' ? text : v);
                setTimeout(() => data.onAddChild(), 0);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setLocal(text);
                data.onCommitEdit(text);
              }
            }}
            className={`bg-transparent text-slate-800 placeholder-slate-400 outline-none text-[13.5px] ${bold ? 'font-semibold' : 'font-normal'}`}
            placeholder="Novo tópico"
            size={Math.max(local.length, 6)}
            style={{
              fieldSizing: 'content',
              minWidth: 60,
              maxWidth: 600,
            } as React.CSSProperties}
          />
        ) : (
          <span
            className={`text-[13.5px] text-slate-800 leading-snug break-words ${bold ? 'font-semibold' : 'font-normal'}`}
            style={{ maxWidth: 600, display: 'inline-block', whiteSpace: 'pre-wrap' }}
          >
            {text || 'Novo tópico'}
          </span>
        )}
        <div className="inline-flex items-center gap-0.5 shrink-0">
          {hasNotes && <StickyNote className="w-3 h-3 text-amber-500" />}
          {hasLinks && <Link2 className="w-3 h-3 text-blue-500" />}
          {hasAttachments && <Paperclip className="w-3 h-3 text-slate-500" />}
        </div>
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

      {/* Botão "+" inline flutuante */}
      {selected && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
          className="absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-white flex items-center justify-center transition-all z-10"
          style={{
            background: color,
            [isLeft ? 'left' : 'right']: -30,
            boxShadow: `0 3px 10px ${color}55`,
          }}
          title="Adicionar filho (Tab)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// Bullet visível no handle (círculo branco com borda colorida)
function bulletHandle(color: string): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    background: '#fff',
    border: `2px solid ${color}`,
    opacity: 1,
  };
}

export const MindNode = memo(MindNodeInner);
