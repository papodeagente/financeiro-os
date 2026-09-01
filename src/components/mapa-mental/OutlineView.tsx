'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, StickyNote, Link2, Paperclip, Image as ImageIcon } from 'lucide-react';
import {
  type MapaMentalData,
  getChildren,
} from '@/lib/mapa-mental';

interface Props {
  data: MapaMentalData;
  selectedId: string | null;
  editingId: string | null;
  /** texto inicial ao entrar em edição digitando (digitar-pra-substituir) */
  editSeed?: string;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string) => void;
  onCancelEdit: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddSibling: (refId: string) => void;
  onOutdent: (id: string) => void;
  onToggleCollapse: (id: string) => void;
}

/**
 * Outline (modo "Esboço") — visualização hierárquica indentada da
 * mesma árvore renderizada no canvas. Compartilha selectedId/editingId
 * com o editor pra sincronia perfeita.
 *
 * Atalhos suportados dentro do input editando:
 *   Enter → commit + addSibling
 *   Tab   → commit + addChild
 *   Shift+Tab → commit + outdent (sobe um nível)
 *   Esc   → cancela edição (nó novo vazio é descartado)
 */
export function OutlineView(props: Props) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <OutlineNode {...props} nodeId={props.data.rootId} depth={0} />
      </div>
    </div>
  );
}

function OutlineNode({
  data, nodeId, depth,
  selectedId, editingId, editSeed,
  onSelect, onStartEdit, onCommitEdit, onCancelEdit, onAddChild, onAddSibling, onOutdent, onToggleCollapse,
}: Props & { nodeId: string; depth: number }) {
  const node = data.nodes[nodeId];
  if (!node) return null;

  const children = getChildren(data, nodeId);
  const isCollapsed = !!node.collapsed && children.length > 0;
  const selected = selectedId === nodeId;
  const editing = editingId === nodeId;
  const isRoot = nodeId === data.rootId;

  return (
    <div>
      <Row
        node={node}
        depth={depth}
        childCount={children.length}
        isRoot={isRoot}
        isCollapsed={isCollapsed}
        selected={selected}
        editing={editing}
        editSeed={editing ? editSeed : undefined}
        onSelect={() => onSelect(nodeId)}
        onStartEdit={() => onStartEdit(nodeId)}
        onCommitEdit={(text) => onCommitEdit(nodeId, text)}
        onCancelEdit={() => onCancelEdit(nodeId)}
        onAddChild={() => onAddChild(nodeId)}
        onAddSibling={() => onAddSibling(nodeId)}
        onOutdent={() => onOutdent(nodeId)}
        onToggleCollapse={() => onToggleCollapse(nodeId)}
      />
      {!isCollapsed && children.map(c => (
        <OutlineNode
          key={c.id}
          data={data}
          nodeId={c.id}
          depth={depth + 1}
          selectedId={selectedId}
          editingId={editingId}
          editSeed={editSeed}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onAddChild={onAddChild}
          onAddSibling={onAddSibling}
          onOutdent={onOutdent}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  );
}

function Row({
  node, depth, childCount, isRoot, isCollapsed, selected, editing, editSeed,
  onSelect, onStartEdit, onCommitEdit, onCancelEdit, onAddChild, onAddSibling, onOutdent, onToggleCollapse,
}: {
  node: MapaMentalData['nodes'][string];
  depth: number;
  childCount: number;
  isRoot: boolean;
  isCollapsed: boolean;
  selected: boolean;
  editing: boolean;
  editSeed?: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onOutdent: () => void;
  onToggleCollapse: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(node.text);
  const [lastText, setLastText] = useState(node.text);

  // texto mudou por fora (undo, outra view) → re-sincroniza o rascunho
  if (node.text !== lastText) {
    setLastText(node.text);
    setLocal(node.text);
  }

  useEffect(() => {
    if (editing && inputRef.current && typeof editSeed !== 'string') {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Edição iniciada digitando: reflete o seed com o caret no fim
  useEffect(() => {
    if (editing && typeof editSeed === 'string' && inputRef.current) {
      const el = inputRef.current;
      setLocal(editSeed);
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
     
  }, [editing, editSeed]);

  const commit = (then?: 'sibling' | 'child' | 'outdent') => {
    const v = local.trim();
    onCommitEdit(v);
    // nó esvaziado é descartado pelo editor — não encadeia ação
    if (v === '') return;
    if (then === 'sibling') setTimeout(onAddSibling, 0);
    if (then === 'child') setTimeout(onAddChild, 0);
    if (then === 'outdent') setTimeout(onOutdent, 0);
  };

  const indent = depth * 20;
  const hasNotes = !!(node.notes && node.notes.trim());
  const hasLinks = !!(node.links && node.links.length);
  const hasAttachments = !!(node.attachments && node.attachments.length);
  const hasImage = !!(node.image && node.image.url);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onStartEdit}
      className={`group flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
        selected ? 'bg-blue-50' : 'hover:bg-slate-50'
      }`}
      style={{ paddingLeft: 8 + indent }}
    >
      {/* Chevron / placeholder */}
      {childCount > 0 ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          className="shrink-0 w-4 h-4 rounded hover:bg-slate-200 flex items-center justify-center"
          title={isCollapsed ? 'Expandir' : 'Recolher'}
        >
          <ChevronRight
            className="w-3 h-3 text-slate-500 transition-transform"
            style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
          />
        </button>
      ) : (
        <span className="shrink-0 w-4 h-4 inline-flex items-center justify-center">
          <span className="w-1 h-1 rounded-full bg-slate-300" />
        </span>
      )}

      {/* Ícone do nó */}
      {node.icon && <span className="text-base leading-none shrink-0">{node.icon}</span>}

      {/* Texto editável */}
      {editing ? (
        <input
          ref={inputRef}
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => commit()}
          onClick={e => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (isRoot) commit('child');
              else commit('sibling');
            } else if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              if (!isRoot) commit('outdent');
            } else if (e.key === 'Tab') {
              e.preventDefault();
              commit('child');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setLocal(node.text);
              onCancelEdit();
            }
          }}
          className={`flex-1 bg-transparent outline-none text-[14px] ${
            isRoot ? 'font-bold text-slate-900' : 'font-normal text-slate-800'
          }`}
          placeholder={isRoot ? 'Ideia central' : 'Novo tópico'}
        />
      ) : (
        <span
          className={`flex-1 text-[14px] leading-snug ${
            isRoot ? 'font-bold text-slate-900' : node.style?.bold ? 'font-semibold text-slate-800' : 'font-normal text-slate-800'
          }`}
        >
          {node.text || (isRoot ? 'Ideia central' : 'Novo tópico')}
        </span>
      )}

      {/* Indicadores */}
      <div className="inline-flex items-center gap-1 shrink-0 text-slate-400">
        {hasImage && <ImageIcon className="w-3 h-3" />}
        {hasLinks && <Link2 className="w-3 h-3 text-blue-500" />}
        {hasAttachments && <Paperclip className="w-3 h-3" />}
        {hasNotes && <StickyNote className="w-3 h-3 text-amber-500" />}
      </div>

      {/* Ação inline: add child no hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onAddChild(); }}
        className="shrink-0 w-5 h-5 rounded text-slate-400 hover:bg-blue-100 hover:text-blue-600 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
        title="Adicionar filho (Tab)"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
