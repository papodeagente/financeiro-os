'use client';

/**
 * Editor de mapa mental — UX inspirada no XMind.
 *
 * Atalhos:
 *   Tab            adiciona filho do selecionado
 *   Enter          adiciona irmao do selecionado (se nao for raiz)
 *   F2 / dbl-click edita texto do selecionado
 *   Delete / Bkspc remove selecionado (e descendentes)
 *   Escape         sai do modo edicao / desseleciona
 *   ↑↓             navega entre siblings
 *   ←              vai pro pai
 *   →              vai pro 1o filho (expande se collapsed)
 *   Space          toggle collapse
 *
 * Auto-save: PUT /api/mapas-mentais/[id] a cada 1.5s de inatividade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Controls,
  useReactFlow,
  type Node, type Edge,
  type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, Check, Loader2, Sparkles, Trash2, Save,
  Plus, GitBranch, Palette, StickyNote, Smile, Keyboard, X,
  ChevronRight as ChevR,
} from 'lucide-react';
import { MindNode, type MindNodeData } from '@/components/mapa-mental/MindNode';
import { MindEdge } from '@/components/mapa-mental/MindEdge';
import {
  type MapaMentalData, type Theme,
  layoutMindMap, colorForDepth, addChild, addSibling, updateNode, removeNode,
  getChildren, createMindMap, newId, THEMES, NODE_COLORS,
} from '@/lib/mapa-mental';

const nodeTypes: NodeTypes = { mindNode: MindNode };
const edgeTypes: EdgeTypes = { mind: MindEdge };

const ICONS = ['💡', '⭐', '🎯', '🚀', '⚡', '🔥', '✅', '❌', '❓', '📌', '🏆', '💰', '📊', '🧠', '🎨', '🛠️'];

interface Props { id: string }

export function MapaMentalEditor({ id }: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner id={id} />
    </ReactFlowProvider>
  );
}

function EditorInner({ id }: Props) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [data, setData] = useState<MapaMentalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showProperties, setShowProperties] = useState(true);

  // ============ LOAD ============
  useEffect(() => {
    let cancel = false;
    const cacheKey = `mapa-mental:${id}`;
    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
      if (cached) {
        const md = JSON.parse(cached) as MapaMentalData;
        setData(md);
        setSelectedId(md.rootId);
        setLoading(false);
        sessionStorage.removeItem(cacheKey);
        return;
      }
    } catch { /* ignore */ }

    fetch(`/api/mapas-mentais/${id}`).then(async r => {
      if (cancel) return;
      if (r.status === 404) {
        const fresh = createMindMap('Novo mapa mental');
        fresh.id = id;
        try {
          await fetch('/api/mapas-mentais', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fresh),
          });
        } catch { /* ignore */ }
        if (cancel) return;
        setData(fresh);
        setSelectedId(fresh.rootId);
        setLoading(false);
        return;
      }
      if (!r.ok) {
        setError('Falha ao carregar mapa.');
        setLoading(false);
        return;
      }
      const d = await r.json();
      if (cancel) return;
      if (!d || d.error) {
        setError(d?.error || 'Mapa não encontrado.');
        setLoading(false);
        return;
      }
      const md: MapaMentalData = {
        id: d.id || id,
        nome: d.nome || 'Sem título',
        rootId: d.rootId,
        nodes: d.nodes || {},
        theme: d.theme || 'rainbow',
        layout: d.layout || 'map',
        view: d.view || {},
      };
      if (!md.rootId || !md.nodes[md.rootId]) {
        const fresh = createMindMap(md.nome);
        md.rootId = fresh.rootId;
        md.nodes = fresh.nodes;
      }
      setData(md);
      setSelectedId(md.rootId);
      setLoading(false);
    }).catch(() => {
      if (!cancel) { setError('Falha ao carregar.'); setLoading(false); }
    });
    return () => { cancel = true; };
  }, [id]);

  // ============ AUTO-SAVE ============
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const dataRef = useRef<MapaMentalData | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  const flushSave = useCallback(async () => {
    if (!dataRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      await fetch(`/api/mapas-mentais/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataRef.current),
      });
      setSavedAt(new Date());
    } catch { /* ignore */ }
    setSaving(false);
  }, [id]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSave(); }, 1500);
  }, [flushSave]);

  useEffect(() => {
    const onBeforeUnload = () => { if (dirtyRef.current) flushSave(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushSave]);

  // ============ Mutações ============
  const mutate = useCallback((fn: (d: MapaMentalData) => MapaMentalData) => {
    setData(d => {
      if (!d) return d;
      const next = fn(d);
      scheduleSave();
      return next;
    });
  }, [scheduleSave]);

  const handleAddChild = useCallback((parentId: string) => {
    setData(d => {
      if (!d) return d;
      const { data: next, newId } = addChild(d, parentId, '');
      setSelectedId(newId);
      setEditingId(newId);
      scheduleSave();
      return next;
    });
  }, [scheduleSave]);

  const handleAddSibling = useCallback((refId: string) => {
    setData(d => {
      if (!d) return d;
      const result = addSibling(d, refId);
      if (!result) {
        const c = addChild(d, refId, '');
        setSelectedId(c.newId);
        setEditingId(c.newId);
        scheduleSave();
        return c.data;
      }
      setSelectedId(result.newId);
      setEditingId(result.newId);
      scheduleSave();
      return result.data;
    });
  }, [scheduleSave]);

  const handleDelete = useCallback((nodeId: string) => {
    setData(d => {
      if (!d || nodeId === d.rootId) return d;
      const parent = d.nodes[nodeId]?.parentId;
      const next = removeNode(d, nodeId);
      setSelectedId(parent);
      scheduleSave();
      return next;
    });
  }, [scheduleSave]);

  const handleEditCommit = useCallback((nodeId: string, text: string) => {
    setData(d => {
      if (!d) return d;
      scheduleSave();
      return updateNode(d, nodeId, { text });
    });
    setEditingId(null);
  }, [scheduleSave]);

  const handleToggleCollapse = useCallback((nodeId: string) => {
    setData(d => {
      if (!d) return d;
      const node = d.nodes[nodeId];
      if (!node) return d;
      scheduleSave();
      return updateNode(d, nodeId, { collapsed: !node.collapsed });
    });
  }, [scheduleSave]);

  const handleSetColor = useCallback((nodeId: string, color: string | undefined) => {
    mutate(d => updateNode(d, nodeId, { color }));
  }, [mutate]);

  const handleSetIcon = useCallback((nodeId: string, icon: string | undefined) => {
    mutate(d => updateNode(d, nodeId, { icon }));
  }, [mutate]);

  const handleSetNotes = useCallback((nodeId: string, notes: string) => {
    mutate(d => updateNode(d, nodeId, { notes }));
  }, [mutate]);

  // ============ Atalhos ============
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!data || !selectedId) return;

      const sel = data.nodes[selectedId];
      if (!sel) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        handleAddChild(selectedId);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleAddSibling(selectedId);
      } else if (e.key === 'F2') {
        e.preventDefault();
        setEditingId(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId === data.rootId) return;
        e.preventDefault();
        if (confirm('Remover este nó e seus filhos?')) {
          handleDelete(selectedId);
        }
      } else if (e.key === 'Escape') {
        setEditingId(null);
      } else if (e.key === ' ') {
        const children = getChildren(data, selectedId);
        if (children.length > 0) {
          e.preventDefault();
          handleToggleCollapse(selectedId);
        }
      } else if (e.key === 'ArrowLeft' && sel.parentId) {
        e.preventDefault();
        setSelectedId(sel.parentId);
      } else if (e.key === 'ArrowRight') {
        const children = getChildren(data, selectedId);
        if (children.length > 0) {
          if (sel.collapsed) handleToggleCollapse(selectedId);
          e.preventDefault();
          setSelectedId(children[0].id);
        }
      } else if (e.key === 'ArrowUp' && sel.parentId) {
        const siblings = getChildren(data, sel.parentId);
        const idx = siblings.findIndex(s => s.id === selectedId);
        if (idx > 0) {
          e.preventDefault();
          setSelectedId(siblings[idx - 1].id);
        }
      } else if (e.key === 'ArrowDown' && sel.parentId) {
        const siblings = getChildren(data, sel.parentId);
        const idx = siblings.findIndex(s => s.id === selectedId);
        if (idx >= 0 && idx < siblings.length - 1) {
          e.preventDefault();
          setSelectedId(siblings[idx + 1].id);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [data, selectedId, handleAddChild, handleAddSibling, handleDelete, handleToggleCollapse]);

  // ============ Conversão pro ReactFlow ============
  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    const layout = layoutMindMap(data);
    const theme = (data.theme || 'rainbow') as Theme;
    const nodes: Node[] = layout.map(n => {
      const childCount = getChildren(data, n.id).length;
      const color = n.color || colorForDepth(n.depth, theme);
      const nodeData: MindNodeData = {
        text: n.text,
        depth: n.depth,
        color,
        isRoot: n.id === data.rootId,
        collapsed: !!n.collapsed,
        childCount,
        editing: editingId === n.id,
        side: n.side,
        icon: n.icon,
        hasNotes: !!(n.notes && n.notes.trim()),
        onCommitEdit: (text: string) => handleEditCommit(n.id, text),
        onStartEdit: () => setEditingId(n.id),
        onToggleCollapse: () => handleToggleCollapse(n.id),
        onAddChild: () => handleAddChild(n.id),
      };
      return {
        id: n.id,
        type: 'mindNode',
        position: { x: n.x, y: n.y },
        data: nodeData as unknown as Record<string, unknown>,
        selected: selectedId === n.id,
        draggable: false,
      };
    });
    const edges: Edge[] = [];
    for (const n of layout) {
      if (n.parentId && data.nodes[n.parentId] && !data.nodes[n.parentId].collapsed) {
        const color = n.color || colorForDepth(n.depth, theme);
        // Source handle vem do lado oposto ao filho — pra raiz, depende
        // do side do filho; pros demais, o handle source segue a direção
        // do side (mesma direção de crescimento).
        const sourceHandle = n.side === 'left' ? 'l' : 'r';
        const targetHandle = 't';
        edges.push({
          id: `e-${n.parentId}-${n.id}`,
          source: n.parentId,
          target: n.id,
          sourceHandle,
          targetHandle,
          type: 'mind',
          data: { color },
        });
      }
    }
    return { rfNodes: nodes, rfEdges: edges };
  }, [data, selectedId, editingId, handleAddChild, handleEditCommit, handleToggleCollapse]);

  // Fit view inicial
  const didFitRef = useRef(false);
  useEffect(() => {
    if (data && !loading && !didFitRef.current) {
      didFitRef.current = true;
      setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 80);
    }
  }, [data, loading, fitView]);

  const onRenameMapa = (novo: string) => mutate(d => ({ ...d, nome: novo }));
  const onSetTheme = (theme: Theme) => mutate(d => ({ ...d, theme }));
  const onSetLayout = (layout: 'map' | 'logical') => mutate(d => ({ ...d, layout }));

  const selNode = selectedId && data ? data.nodes[selectedId] : null;
  const selIsRoot = !!(selNode && data && selNode.id === data.rootId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <button onClick={() => router.push('/planejamento/mapas-mentais')} className="text-sm text-slate-600 hover:text-slate-900">
          ← Voltar
        </button>
        <p className="mt-4 text-slate-600">{error || 'Mapa não encontrado.'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#FAFBFC]">
      {/* ========= TOPBAR ========= */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 h-[52px] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => router.push('/planejamento/mapas-mentais')}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
            title="Voltar"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-slate-200 mx-1" />
          <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
          <input
            value={data.nome}
            onChange={e => onRenameMapa(e.target.value)}
            className="min-w-0 max-w-xs bg-transparent border-none outline-none text-[15px] font-semibold text-slate-900 focus:bg-slate-50 px-2 py-1 rounded"
            placeholder="Nome do mapa"
          />
        </div>

        {/* Ações principais */}
        <div className="flex items-center gap-1 shrink-0">
          <ToolbarButton
            onClick={() => selectedId && handleAddChild(selectedId)}
            disabled={!selectedId}
            icon={<Plus className="w-3.5 h-3.5" />}
            label="Tópico"
            shortcut="Tab"
            primary
          />
          <ToolbarButton
            onClick={() => selectedId && handleAddSibling(selectedId)}
            disabled={!selectedId || selIsRoot}
            icon={<GitBranch className="w-3.5 h-3.5" />}
            label="Irmão"
            shortcut="Enter"
          />
          <ToolbarButton
            onClick={() => selectedId && !selIsRoot && handleDelete(selectedId)}
            disabled={!selectedId || selIsRoot}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Remover"
            shortcut="Del"
            danger
          />
          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Layout dropdown — toggle simples */}
          <button
            onClick={() => onSetLayout(data.layout === 'logical' ? 'map' : 'logical')}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5"
            title="Trocar layout"
          >
            <GitBranch className="w-3.5 h-3.5 rotate-90" />
            {data.layout === 'logical' ? 'Árvore' : 'Mapa'}
          </button>

          <button
            onClick={() => setShowProperties(s => !s)}
            className={`p-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
              showProperties ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
            title="Painel de propriedades"
          >
            <Palette className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowShortcuts(true)}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            title="Atalhos do teclado"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Status save */}
          <div className="flex items-center gap-1.5">
            {saving ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin" /> salvando
              </span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <Check className="w-3 h-3" /> {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <button
              onClick={flushSave}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-slate-700 hover:bg-slate-100"
              title="Salvar agora"
            >
              <Save className="w-3 h-3" /> Salvar
            </button>
          </div>
        </div>
      </header>

      {/* ========= CANVAS + PAINEL ========= */}
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => { setSelectedId(null); setEditingId(null); }}
            proOptions={{ hideAttribution: true }}
            fitView
            panOnScroll
            minZoom={0.3}
            maxZoom={2.5}
            defaultEdgeOptions={{ type: 'mind' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#dbe2ea" />
            <Controls
              showInteractive={false}
              showZoom
              showFitView
              position="bottom-left"
              style={{
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                boxShadow: '0 2px 6px rgba(15,23,42,0.06)',
              }}
            />
          </ReactFlow>
        </div>

        {/* ========= PAINEL DIREITO ========= */}
        {showProperties && selNode && data && (
          <PropertiesPanel
            node={selNode}
            isRoot={selIsRoot}
            theme={(data.theme || 'rainbow') as Theme}
            currentTheme={(data.theme || 'rainbow') as Theme}
            onSetColor={(c) => handleSetColor(selNode.id, c)}
            onSetIcon={(i) => handleSetIcon(selNode.id, i)}
            onSetNotes={(n) => handleSetNotes(selNode.id, n)}
            onSetTheme={onSetTheme}
            onClose={() => setShowProperties(false)}
          />
        )}
      </div>

      {/* ========= MODAL ATALHOS ========= */}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

// ============ Toolbar Button ============
function ToolbarButton({
  onClick, disabled, icon, label, shortcut, primary, danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const base = 'px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors';
  const variant = disabled
    ? 'text-slate-300 cursor-not-allowed'
    : primary
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : danger
        ? 'text-red-600 hover:bg-red-50'
        : 'text-slate-700 hover:bg-slate-100';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variant}`}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// ============ Painel direito de propriedades ============
function PropertiesPanel({
  node, isRoot, currentTheme,
  onSetColor, onSetIcon, onSetNotes, onSetTheme, onClose,
}: {
  node: { id: string; text: string; color?: string; icon?: string; notes?: string };
  isRoot: boolean;
  theme: Theme;
  currentTheme: Theme;
  onSetColor: (c: string | undefined) => void;
  onSetIcon: (i: string | undefined) => void;
  onSetNotes: (n: string) => void;
  onSetTheme: (t: Theme) => void;
  onClose: () => void;
}) {
  return (
    <aside className="w-[280px] shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 h-[42px] flex items-center justify-between border-b border-slate-100">
        <h3 className="text-[13px] font-semibold text-slate-900 truncate">
          {isRoot ? 'Mapa' : 'Tópico'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:bg-slate-100"
          title="Fechar painel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Cor do nó (override) */}
        <Section icon={<Palette className="w-3.5 h-3.5" />} title="Cor">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onSetColor(undefined)}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                !node.color ? 'border-slate-900' : 'border-slate-200'
              }`}
              title="Cor automática (por nível)"
            >
              A
            </button>
            {NODE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => onSetColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                  node.color === c ? 'border-slate-900 scale-110' : 'border-white'
                }`}
                style={{ background: c, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                title={c}
              />
            ))}
          </div>
        </Section>

        {/* Ícone */}
        <Section icon={<Smile className="w-3.5 h-3.5" />} title="Ícone">
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => onSetIcon(undefined)}
              className={`w-7 h-7 rounded-md text-[10px] font-medium border ${
                !node.icon ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
              title="Sem ícone"
            >
              ∅
            </button>
            {ICONS.map(ic => (
              <button
                key={ic}
                onClick={() => onSetIcon(ic)}
                className={`w-7 h-7 rounded-md text-sm border transition-colors ${
                  node.icon === ic ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
                title={ic}
              >
                {ic}
              </button>
            ))}
          </div>
        </Section>

        {/* Notas */}
        <Section icon={<StickyNote className="w-3.5 h-3.5" />} title="Notas">
          <textarea
            value={node.notes || ''}
            onChange={e => onSetNotes(e.target.value)}
            placeholder="Adicione uma nota..."
            rows={4}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2 outline-none focus:border-blue-400 focus:bg-white resize-none"
          />
        </Section>

        {/* Tema global (só se for raiz, mas mostramos sempre como conveniência) */}
        {isRoot && (
          <Section icon={<Palette className="w-3.5 h-3.5" />} title="Tema do mapa">
            <div className="grid grid-cols-1 gap-1.5">
              {THEMES.map(t => (
                <button
                  key={t.id}
                  onClick={() => onSetTheme(t.id)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-colors ${
                    currentTheme === t.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex gap-0.5">
                    {t.preview.map((c, i) => (
                      <div key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="text-xs font-medium text-slate-700 flex-1">{t.label}</span>
                  {currentTheme === t.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

// ============ Modal de atalhos ============
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const items = [
    { k: 'Tab',           v: 'Adicionar filho' },
    { k: 'Enter',         v: 'Adicionar irmão' },
    { k: 'F2',            v: 'Editar texto' },
    { k: 'Duplo-clique',  v: 'Editar texto' },
    { k: 'Delete / ⌫',    v: 'Remover nó' },
    { k: 'Escape',        v: 'Sair da edição' },
    { k: 'Espaço',        v: 'Recolher / expandir' },
    { k: '← ↑ ↓ →',       v: 'Navegar entre nós' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-blue-600" /> Atalhos
          </h2>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50">
              <span className="text-xs text-slate-600">{it.v}</span>
              <kbd className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px]">
                {it.k}
              </kbd>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 inline-flex items-center gap-1">
          <ChevR className="w-3 h-3" /> Dica: clique no nó e pressione Tab pra criar filhos rapidamente.
        </div>
      </div>
    </div>
  );
}

// Helpers re-exportados (usados pela /lista)
export function _createMindMap(nome: string) { return createMindMap(nome); }
export function _newId() { return newId(); }
