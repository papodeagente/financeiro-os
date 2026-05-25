'use client';

/**
 * Editor de mapa mental — UX inspirada em MindMeister.
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
  Controls, MiniMap,
  useReactFlow,
  type Node, type Edge,
  type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Check, Loader2, Sparkles, Trash2, Save } from 'lucide-react';
import { MindNode, type MindNodeData } from '@/components/mapa-mental/MindNode';
import { MindEdge } from '@/components/mapa-mental/MindEdge';
import {
  type MapaMentalData,
  layoutMindMap, colorForDepth, addChild, addSibling, updateNode, removeNode,
  getChildren, createMindMap, newId,
} from '@/lib/mapa-mental';

const nodeTypes: NodeTypes = { mindNode: MindNode };
const edgeTypes: EdgeTypes = { mind: MindEdge };

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

  // ============ LOAD ============
  useEffect(() => {
    let cancel = false;
    const cacheKey = `mapa-mental:${id}`;

    // 1. Tenta cache do sessionStorage (vindo da pagina lista que acabou
    //    de criar este mapa) — abre o editor INSTANTANEAMENTE, sem
    //    esperar GET. Race condition com servidor evitada.
    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
      if (cached) {
        const md = JSON.parse(cached) as MapaMentalData;
        setData(md);
        setSelectedId(md.rootId);
        setLoading(false);
        sessionStorage.removeItem(cacheKey);
        return; // pula GET
      }
    } catch { /* ignore */ }

    // 2. GET normal. Se 404, auto-cria mapa novo (cobre o caso de
    //    navegacao direta pra /[id] inexistente).
    fetch(`/api/mapas-mentais/${id}`).then(async r => {
      if (cancel) return;
      if (r.status === 404) {
        // Mapa nao existe — cria automaticamente com o id pedido.
        const fresh = createMindMap('Novo mapa mental');
        fresh.id = id;
        try {
          await fetch('/api/mapas-mentais', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fresh),
          });
        } catch { /* ignore — auto-save futuro recupera */ }
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

  // ============ AUTO-SAVE (debounced) ============
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

  // Salva ao sair da pagina
  useEffect(() => {
    const onBeforeUnload = () => { if (dirtyRef.current) flushSave(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushSave]);

  // ============ Helpers de mutacao ============
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
      const { data: next, newId } = addChild(d, parentId, 'Nova ideia');
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
        // raiz — adiciona filho em vez
        const c = addChild(d, refId, 'Nova ideia');
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

  // ============ Atalhos teclado ============
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Nao captura quando ha input focado (modo edicao). MindNode ja
      // tem onKeyDown proprio pra Enter/Esc.
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
        // toggle collapse
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

  // ============ Converte arvore em nodes/edges do ReactFlow ============
  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    const layout = layoutMindMap(data);
    const nodes: Node[] = layout.map(n => {
      const childCount = getChildren(data, n.id).length;
      const color = n.color || colorForDepth(n.depth, data.theme);
      const nodeData: MindNodeData = {
        text: n.text,
        depth: n.depth,
        color,
        isRoot: n.id === data.rootId,
        collapsed: !!n.collapsed,
        childCount,
        editing: editingId === n.id,
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
        const color = colorForDepth(n.depth, data.theme);
        edges.push({
          id: `e-${n.parentId}-${n.id}`,
          source: n.parentId,
          target: n.id,
          type: 'mind',
          data: { color },
        });
      }
    }
    return { rfNodes: nodes, rfEdges: edges };
  }, [data, selectedId, editingId, handleAddChild, handleEditCommit, handleToggleCollapse]);

  // Fit view quando o mapa carrega
  useEffect(() => {
    if (data && !loading) {
      setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
    }
  }, [data, loading, fitView]);

  const onRenameMapa = (novo: string) => {
    mutate(d => ({ ...d, nome: novo }));
  };

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
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => router.push('/planejamento/mapas-mentais')}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
            title="Voltar"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
          <input
            value={data.nome}
            onChange={e => onRenameMapa(e.target.value)}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-base font-bold text-slate-900 focus:bg-slate-50 px-2 py-1 rounded"
            placeholder="Nome do mapa"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saving ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" /> salvando...
            </span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
              <Check className="w-3 h-3" /> salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          <button
            onClick={flushSave}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-slate-600 hover:bg-slate-100"
            title="Salvar agora"
          >
            <Save className="w-3 h-3" /> Salvar
          </button>
        </div>
      </header>

      {/* Atalhos hint bar */}
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-4 py-1.5 flex items-center gap-3 text-[10px] text-slate-500 overflow-x-auto">
        <Kbd>Tab</Kbd> <span>novo filho</span>
        <Kbd>Enter</Kbd> <span>irmão</span>
        <Kbd>F2</Kbd> <span>editar</span>
        <Kbd>Del</Kbd> <span>remover</span>
        <Kbd>Space</Kbd> <span>recolher</span>
        <Kbd>←↑↓→</Kbd> <span>navegar</span>
        <span className="ml-auto text-slate-400">Duplo-clique pra editar o nó</span>
      </div>

      {/* Canvas */}
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
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable zoomable
            nodeColor={(n) => {
              const d = n.data as MindNodeData | undefined;
              return d?.color || '#94a3b8';
            }}
            maskColor="rgba(15,23,42,0.04)"
          />
        </ReactFlow>

        {/* FAB: adicionar filho ao selecionado (mobile-friendly) */}
        {selectedId && (
          <div className="absolute bottom-20 right-4 flex flex-col gap-2 z-10">
            <button
              onClick={() => handleAddChild(selectedId)}
              className="px-3 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-lg hover:bg-blue-700"
            >
              + Filho
            </button>
            {selectedId !== data.rootId && (
              <>
                <button
                  onClick={() => handleAddSibling(selectedId)}
                  className="px-3 py-2 rounded-full bg-slate-700 text-white text-xs font-semibold shadow-lg hover:bg-slate-800"
                >
                  + Irmão
                </button>
                <button
                  onClick={() => {
                    if (confirm('Remover este nó e seus filhos?')) handleDelete(selectedId);
                  }}
                  className="px-3 py-2 rounded-full bg-red-500 text-white text-xs font-semibold shadow-lg hover:bg-red-600 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Remover
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-mono text-[10px] shadow-sm">
      {children}
    </kbd>
  );
}

// Helper exportado pra criar mapa novo (usado pela /lista)
export function _createMindMap(nome: string) {
  return createMindMap(nome);
}
export function _newId() { return newId(); }
