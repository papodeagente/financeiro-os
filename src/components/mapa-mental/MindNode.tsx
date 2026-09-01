'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  ChevronRight, ChevronLeft, Plus, StickyNote,
  Link2, Paperclip,
} from 'lucide-react';

export type DropHint = 'child' | 'before' | 'after';

export interface MindNodeData extends Record<string, unknown> {
  text: string;
  depth: number;
  color: string;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
  editing: boolean;
  /** texto inicial do input ao entrar em edição (digitar-pra-substituir) */
  editSeed?: string;
  side: 'left' | 'right';
  icon?: string;
  hasNotes?: boolean;
  /** indicador visual de alvo durante drag & drop */
  dropHint?: DropHint;
  /** este nó está sendo arrastado agora */
  dragging?: boolean;
  // Fase 2 — dados ricos
  image?: { url: string; alt?: string };
  links?: { label: string; url: string }[];
  attachments?: { name: string; url: string }[];
  shape?: 'rounded' | 'pill' | 'rect';
  bold?: boolean;
  // Callbacks
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
  /** Adiciona irmão depois do commit (Enter num filho) */
  onAddSibling?: () => void;
  /** Sobe um nível depois do commit (Shift+Tab num filho) */
  onOutdent?: () => void;
}

type MindNodeType = Node<MindNodeData, 'mindNode'>;

function MindNodeInner({ data, selected }: NodeProps<MindNodeType>) {
  const {
    text, color, isRoot, collapsed, childCount, editing, editSeed, side,
    icon, hasNotes, image, links, attachments, shape, bold,
    dropHint, dragging,
  } = data;
  const hasLinks = !!(links && links.length);
  const hasAttachments = !!(attachments && attachments.length);
  const hasImage = !!(image && image.url);
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(text);

  useEffect(() => { setLocal(text); }, [text]);

  // O React Flow monta nós novos com visibility:hidden até medir — e
  // focus() em elemento oculto falha em silêncio. Insistimos por alguns
  // frames até o foco pegar de verdade.
  const focusInput = (selectAll: boolean) => {
    let tries = 0;
    const attempt = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) {
        if (selectAll) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
        return;
      }
      if (tries++ < 20) requestAnimationFrame(attempt);
    };
    attempt();
  };

  useEffect(() => {
    if (editing && typeof editSeed !== 'string') focusInput(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Edição iniciada digitando: o seed acumula teclas até o input ganhar
  // foco — refletimos cada atualização com o caret no fim.
  useEffect(() => {
    if (editing && typeof editSeed === 'string') {
      setLocal(editSeed);
      focusInput(false);
    }
     
  }, [editing, editSeed]);

  const commit = () => {
    data.onCommitEdit(local.trim());
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = local.trim();
      data.onCommitEdit(v);
      // Enter num nó vazio só fecha (e o editor descarta o nó) — não encadeia
      if (v !== '') {
        if (isRoot) return;  // Enter na raiz apenas confirma (MindMeister)
        setTimeout(() => data.onAddSibling?.(), 0);
      }
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const v = local.trim();
      data.onCommitEdit(v);
      if (v !== '' && !isRoot) setTimeout(() => data.onOutdent?.(), 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = local.trim();
      data.onCommitEdit(v);
      if (v !== '') setTimeout(() => data.onAddChild(), 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setLocal(text);
      data.onCancelEdit();
    }
  };

  // Indicadores de drop (drag & drop de reorganização)
  const dropAsChild = dropHint === 'child';
  const dropBar = dropHint === 'before' || dropHint === 'after' ? (
    <div
      className="absolute left-0 right-0 rounded-full pointer-events-none"
      style={{
        height: 3,
        background: color,
        [dropHint === 'before' ? 'top' : 'bottom']: -9,
        boxShadow: `0 0 0 1px ${color}55`,
      }}
    />
  ) : null;

  // Mapeia shape → border-radius
  const shapeRadius = shape === 'pill' ? 9999 : shape === 'rect' ? 4 : 12;
  const textBold = bold !== false;  // raiz: bold default = true se não definido

  // ============ RAIZ ============
  if (isRoot) {
    const rootRadius = shape === 'pill' ? 9999 : shape === 'rect' ? 8 : 12;
    return (
      <div className="relative group" onDoubleClick={() => data.onStartEdit()}>
        <Handle type="source" position={Position.Right} id="r" style={bulletHandle(color)} />
        <Handle type="source" position={Position.Left}  id="l" style={bulletHandle(color)} />
        <div
          className="bg-white transition-all overflow-hidden"
          style={{
            border: `2px solid ${color}`,
            borderRadius: rootRadius,
            boxShadow: dropAsChild
              ? `0 0 0 4px ${color}44, 0 6px 18px ${color}30`
              : selected
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
                onKeyDown={onInputKeyDown}
                className={`nodrag nopan flex-1 bg-transparent outline-none text-slate-900 text-center text-[15px] ${textBold ? 'font-bold' : 'font-normal'}`}
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
        {/* Contador quando a raiz está recolhida */}
        {collapsed && childCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
            style={{ background: color, right: -30 }}
            title={`Expandir ${childCount} ${childCount === 1 ? 'ramo' : 'ramos'}`}
          >
            {childCount}
          </button>
        )}
        {/* Botão "+" flutuante */}
        {selected && !collapsed && !dragging && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
          onDoubleClick={(e) => e.stopPropagation()}
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
        position: 'relative',
        background: '#ffffff',
        border: `1.5px solid ${color}`,
        borderRadius: shapeRadius,
        boxShadow: dropAsChild
          ? `0 0 0 3px ${color}55, 0 4px 12px ${color}30`
          : selected
            ? `0 0 0 3px ${color}33, 0 4px 12px ${color}20`
            : `0 1px 3px rgba(15,23,42,0.06)`,
        padding: '6px 12px',
        minWidth: 60,
      }
    : {
        position: 'relative',
        background: dropAsChild ? `${color}18` : selected ? `${color}10` : 'transparent',
        outline: dropAsChild ? `2px dashed ${color}` : selected ? `2px solid ${color}` : 'none',
        borderRadius: 6,
        padding: '4px 8px',
        minWidth: 60,
      };

  // Badge de recolhido e botão "+" não podem se sobrepor: quando os
  // dois estão visíveis, o badge fica mais pra fora.
  const badgeOffset = selected && !dragging ? -56 : -28;

  return (
    <div
      className={`relative group ${isLeft ? 'text-right' : 'text-left'}`}
      style={dragging ? { opacity: 0.8, cursor: 'grabbing' } : undefined}
      onDoubleClick={() => data.onStartEdit()}
    >
      {dropBar}
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
        {/* Handles ancorados na LINHA DE TEXTO (não no bloco todo) — com
            imagem acima, a conexão continua chegando no texto. */}
        <Handle type="target" position={handleTarget} id={targetSide} style={bulletHandle(color)} />
        <Handle type="source" position={handleSource} id={sourceSide} style={bulletHandle(color)} />
        {/* Toggle collapse */}
        {childCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            onDoubleClick={(e) => e.stopPropagation()}
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
            onKeyDown={onInputKeyDown}
            className={`nodrag nopan bg-transparent text-slate-800 placeholder-slate-400 outline-none text-[13.5px] ${bold ? 'font-semibold' : 'font-normal'}`}
            placeholder="Novo tópico"
            size={Math.max(local.length, 6)}
            style={{
              fieldSizing: 'content',
              minWidth: 60,
              maxWidth: 420,
            } as React.CSSProperties}
          />
        ) : (
          <span
            className={`text-[13.5px] text-slate-800 leading-snug break-words ${bold ? 'font-semibold' : 'font-normal'}`}
            style={{ maxWidth: 420, display: 'inline-block', whiteSpace: 'pre-wrap' }}
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

      {/* Indicador de filhos recolhidos — clicável pra expandir */}
      {collapsed && childCount > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(); }}
            onDoubleClick={(e) => e.stopPropagation()}
          className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
          style={{
            background: color,
            [isLeft ? 'left' : 'right']: badgeOffset,
          }}
          title={`Expandir ${childCount} ${childCount === 1 ? 'filho' : 'filhos'}`}
        >
          {childCount}
        </button>
      )}

      {/* Botão "+" inline flutuante */}
      {selected && !dragging && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onAddChild(); }}
          onDoubleClick={(e) => e.stopPropagation()}
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
