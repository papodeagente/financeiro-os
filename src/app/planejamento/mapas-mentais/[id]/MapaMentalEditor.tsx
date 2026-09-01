'use client';

/**
 * Editor de mapa mental — UX padrão MindMeister.
 *
 * Atalhos:
 *   Tab            adiciona filho do selecionado
 *   Shift+Tab      sobe um nível (outdent)
 *   Enter          adiciona irmao do selecionado (raiz: filho)
 *   F2 / dbl-click edita texto do selecionado
 *   digitar        edita substituindo o texto
 *   Delete / Bkspc remove selecionado (e descendentes) — desfazível
 *   Ctrl/Cmd+Z     desfaz  ·  Ctrl+Shift+Z / Ctrl+Y refaz
 *   Ctrl/Cmd+↑↓    move o nó entre os irmãos
 *   Escape         sai do modo edicao / desseleciona
 *   ↑↓             navega entre siblings
 *   ← →            navega pai/filho (respeitando o lado do ramo)
 *   Space          recolhe / expande
 *   arrastar nó    move pra outro pai (solta em cima) ou reordena
 *                  (solta acima/abaixo de um irmão)
 *
 * Layout: calculado com as dimensões REAIS medidas pelo React Flow —
 * nós nunca se sobrepõem, mesmo com textos longos ou imagens.
 * Auto-save: PUT /api/mapas-mentais/[id] a cada 1.5s de inatividade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Controls,
  useReactFlow, useUpdateNodeInternals,
  type Node, type Edge, type NodeChange, type Viewport,
  type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, Loader2, Sparkles, Save, Trash2,
  Plus, GitBranch, Palette, StickyNote, Smile, Keyboard, X,
  ChevronRight as ChevR,
  Shapes, Link2, Paperclip, Image as ImageIcon,
  List, LayoutGrid, Upload, Undo2, Redo2,
  MessageSquare, MoreHorizontal,
} from 'lucide-react';
import { MindNode, type MindNodeData, type DropHint } from '@/components/mapa-mental/MindNode';
import { MindEdge } from '@/components/mapa-mental/MindEdge';
import { OutlineView } from '@/components/mapa-mental/OutlineView';
import {
  type MapaMentalData, type Theme, type NodeSize, type LayoutNode,
  layoutMindMap, colorForNode, addChild, addSibling, updateNode, removeNode,
  moveNode, reorderNode, outdentNode, sanitizeMap,
  getChildren, getDescendantIds, createMindMap, newId, THEMES, NODE_COLORS,
} from '@/lib/mapa-mental';

const nodeTypes: NodeTypes = { mindNode: MindNode };
const edgeTypes: EdgeTypes = { mind: MindEdge };

const ICONS = ['💡', '⭐', '🎯', '🚀', '⚡', '🔥', '✅', '❌', '❓', '📌', '🏆', '💰', '📊', '🧠', '🎨', '🛠️'];

const HISTORY_LIMIT = 100;

interface Props { id: string }

export function MapaMentalEditor({ id }: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner id={id} />
    </ReactFlowProvider>
  );
}

interface DragPos { id: string; x: number; y: number }
interface DropTarget { targetId: string; kind: DropHint }

function EditorInner({ id }: Props) {
  const router = useRouter();
  const { fitView, setViewport, getViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MapaMentalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeed, setEditSeed] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [panelFocus, setPanelFocus] = useState<PanelSection | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'map' | 'outline'>('map');
  const [sizes, setSizes] = useState<Record<string, NodeSize>>({});
  const [dragPos, setDragPos] = useState<DragPos | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const dataRef = useRef<MapaMentalData | null>(null);
  const sizesRef = useRef<Record<string, NodeSize>>({});
  const layoutIndexRef = useRef<Map<string, LayoutNode>>(new Map());
  const dragMetaRef = useRef<{ id: string; subtree: Set<string> } | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const lastCreatedRef = useRef<string | null>(null);

  // ============ HISTÓRICO (undo/redo) ============
  const pastRef = useRef<MapaMentalData[]>([]);
  const futureRef = useRef<MapaMentalData[]>([]);
  const lastPushRef = useRef<{ key: string | null; time: number } | null>(null);

  const openPanelWithFocus = useCallback((section?: PanelSection) => {
    setShowProperties(true);
    setPanelFocus(section);
  }, []);

  // ============ AUTO-SAVE ============
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // keepalive só no unload: fetch com keepalive limita o body a 64KiB e
  // faria mapas grandes NUNCA salvarem no ciclo normal.
  const flushSaveRef = useRef<(opts?: { keepalive?: boolean }) => Promise<void>>(async () => {});
  const flushSave = useCallback(async (opts?: { keepalive?: boolean }) => {
    if (!dataRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      const res = await fetch(`/api/mapas-mentais/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataRef.current),
        keepalive: opts?.keepalive === true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedAt(new Date());
    } catch {
      // save falhou → segue sujo e re-tenta; nada de perda silenciosa
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { flushSaveRef.current(); }, 5000);
    }
    setSaving(false);
  }, [id]);
  useEffect(() => { flushSaveRef.current = flushSave; }, [flushSave]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSaveRef.current(); }, 1500);
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => { if (dirtyRef.current) flushSaveRef.current({ keepalive: true }); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ============ NÚCLEO DE MUTAÇÃO ============
  // Toda mudança estrutural passa aqui: histórico + save + refs em sincronia.
  // `historyKey` agrupa mudanças contínuas (digitação de nota, etc) num
  // único passo de undo.
  const syncHistFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const commitChange = useCallback((next: MapaMentalData, opts?: { historyKey?: string; skipHistory?: boolean }) => {
    const prev = dataRef.current;
    if (!prev || next === prev) return;
    lastCreatedRef.current = null;
    if (!opts?.skipHistory) {
      const now = Date.now();
      const key = opts?.historyKey ?? null;
      const coalesce = key !== null
        && lastPushRef.current?.key === key
        && now - lastPushRef.current.time < 1200;
      if (coalesce) {
        lastPushRef.current!.time = now;
      } else {
        pastRef.current.push(prev);
        if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
        futureRef.current = [];
        lastPushRef.current = { key, time: now };
      }
      syncHistFlags();
    }
    dataRef.current = next;
    setData(next);
    scheduleSave();
  }, [scheduleSave, syncHistFlags]);

  const applyHistory = useCallback((snapshot: MapaMentalData) => {
    const cur = dataRef.current;
    // preserva o enquadramento atual — undo não mexe no zoom/pan
    const next = { ...snapshot, view: cur?.view ?? snapshot.view };
    dataRef.current = next;
    setData(next);
    setEditingId(null);
    setEditSeed(undefined);
    setSelectedId(sel => (sel && next.nodes[sel]) ? sel : next.rootId);
    lastPushRef.current = null;
    scheduleSave();
    syncHistFlags();
  }, [scheduleSave, syncHistFlags]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev || !dataRef.current) return;
    futureRef.current.push(dataRef.current);
    applyHistory(prev);
  }, [applyHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next || !dataRef.current) return;
    pastRef.current.push(dataRef.current);
    applyHistory(next);
  }, [applyHistory]);

  // Mudança de viewport (zoom/pan) — salva sem entrar no histórico
  const commitView = useCallback((vp: Viewport) => {
    const d = dataRef.current;
    if (!d) return;
    const view = { zoom: Math.round(vp.zoom * 1000) / 1000, x: Math.round(vp.x), y: Math.round(vp.y) };
    if (d.view && d.view.zoom === view.zoom && d.view.x === view.x && d.view.y === view.y) return;
    const next = { ...d, view };
    dataRef.current = next;
    setData(next);
    scheduleSave();
  }, [scheduleSave]);

  // ============ LOAD ============
  const pendingFitRef = useRef(true);
  useEffect(() => {
    let cancel = false;
    const adopt = (md: MapaMentalData) => {
      const clean = sanitizeMap(md);
      dataRef.current = clean;
      setData(clean);
      setSelectedId(clean.rootId);
      setLoading(false);
      if (clean !== md) scheduleSave();  // persiste a correção de dados legados
    };

    // Handoff da tela de listagem: entrada com timestamp e validade curta.
    // NÃO removemos na leitura — o StrictMode roda o efeito duas vezes em
    // dev, e a 2ª execução precisa achar o cache de novo.
    const cacheKey = `mapa-mental:${id}`;
    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as { t?: number; data?: MapaMentalData } | MapaMentalData;
        const entry = 'data' in parsed && parsed.data ? parsed : { t: 0, data: parsed as MapaMentalData };
        if (entry.data && Date.now() - (entry.t || 0) < 15000) {
          adopt(entry.data);
          return;
        }
        sessionStorage.removeItem(cacheKey);  // expirado
      }
    } catch { /* ignore */ }

    fetch(`/api/mapas-mentais/${id}`).then(async r => {
      if (cancel) return;
      if (r.status === 404) {
        // NUNCA auto-criar aqui: um 404 pode ser id de mapa de OUTRO
        // tenant, e o POST de upsert sobrescreveria dados alheios. O
        // fluxo legítimo de criação passa pela listagem (+ handoff).
        setError('Mapa não encontrado — ele pode ter sido removido, ou o link não é seu.');
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
        theme: d.theme || 'minimal',
        layout: d.layout || 'map',
        view: d.view || {},
      };
      if (!md.rootId || !md.nodes[md.rootId]) {
        const fresh = createMindMap(md.nome);
        md.rootId = fresh.rootId;
        md.nodes = fresh.nodes;
      }
      adopt(md);
    }).catch(() => {
      if (!cancel) { setError('Falha ao carregar.'); setLoading(false); }
    });
    return () => { cancel = true; };
  }, [id, scheduleSave]);

  // ============ Mutações ============
  const handleAddChild = useCallback((parentId: string) => {
    const d = dataRef.current;
    if (!d || !d.nodes[parentId]) return;
    const { data: next, newId: created } = addChild(d, parentId, '');
    commitChange(next);
    lastCreatedRef.current = created;
    setSelectedId(created);
    setEditingId(created);
    setEditSeed(undefined);
  }, [commitChange]);

  const handleAddSibling = useCallback((refId: string) => {
    const d = dataRef.current;
    if (!d) return;
    const result = addSibling(d, refId);
    if (!result) {
      // raiz não tem irmão → cria filho (mesmo gesto do MindMeister)
      handleAddChild(refId);
      return;
    }
    commitChange(result.data);
    lastCreatedRef.current = result.newId;
    setSelectedId(result.newId);
    setEditingId(result.newId);
    setEditSeed(undefined);
  }, [commitChange, handleAddChild]);

  // Remoção direta + toast com Desfazer (padrão MindMeister — sem confirm)
  const handleDelete = useCallback((nodeId: string) => {
    const d = dataRef.current;
    if (!d || nodeId === d.rootId) return;
    const node = d.nodes[nodeId];
    if (!node) return;
    const descCount = getDescendantIds(d, nodeId).length;
    commitChange(removeNode(d, nodeId));
    // marcador: o Desfazer do toast só desfaz se ESTA remoção ainda for a
    // última mudança — nunca desfaz cegamente outra coisa
    const marker = pastRef.current[pastRef.current.length - 1];
    setSelectedId(node.parentId);
    setEditingId(cur => (cur === nodeId ? null : cur));
    if (descCount > 0 || node.text.trim() !== '') {
      toast(
        descCount > 0
          ? `Tópico removido com ${descCount} ${descCount === 1 ? 'subtópico' : 'subtópicos'}`
          : 'Tópico removido',
        {
          action: {
            label: 'Desfazer',
            onClick: () => {
              if (pastRef.current[pastRef.current.length - 1] === marker) undo();
              else toast.info('Houve outras mudanças depois — use Ctrl+Z pra voltar passo a passo.');
            },
          },
        },
      );
    }
  }, [commitChange, undo]);

  const handleEditCommit = useCallback((nodeId: string, text: string) => {
    setEditingId(cur => (cur === nodeId ? null : cur));
    setEditSeed(undefined);
    const d = dataRef.current;
    if (!d) return;
    const node = d.nodes[nodeId];
    if (!node) return;
    const t = text.trim();
    if (t === '') {
      // Nó esvaziado sem conteúdo extra → descarta (não acumula nós vazios)
      const hasContent = !!(node.notes || node.image || node.links?.length
        || node.attachments?.length || getChildren(d, nodeId).length > 0);
      if (!hasContent && nodeId !== d.rootId) {
        const parent = node.parentId;
        commitChange(removeNode(d, nodeId));
        setSelectedId(parent);
      }
      return;
    }
    if (t === node.text) return;
    commitChange(updateNode(d, nodeId, { text: t }));
  }, [commitChange]);

  // Escape durante edição: nó recém-criado e vazio é descartado
  // revertendo a própria criação; nó existente só sai da edição.
  const handleCancelEdit = useCallback((nodeId: string) => {
    setEditingId(null);
    setEditSeed(undefined);
    const d = dataRef.current;
    if (!d) return;
    const node = d.nodes[nodeId];
    if (!node) return;
    if (
      lastCreatedRef.current === nodeId
      && node.text.trim() === ''
      && getChildren(d, nodeId).length === 0
    ) {
      lastCreatedRef.current = null;
      const parent = node.parentId;
      undo();
      // seleção volta pro PAI do nó descartado, não pra raiz
      if (parent && dataRef.current?.nodes[parent]) setSelectedId(parent);
    }
  }, [undo]);

  const handleToggleCollapse = useCallback((nodeId: string) => {
    const d = dataRef.current;
    if (!d) return;
    const node = d.nodes[nodeId];
    if (!node) return;
    commitChange(updateNode(d, nodeId, { collapsed: !node.collapsed }), { historyKey: `collapse:${nodeId}` });
  }, [commitChange]);

  const patchNode = useCallback((nodeId: string, patch: Partial<MapaMentalData['nodes'][string]>, key: string) => {
    const d = dataRef.current;
    if (!d) return;
    commitChange(updateNode(d, nodeId, patch), { historyKey: `${key}:${nodeId}` });
  }, [commitChange]);

  const handleSetColor = useCallback((nodeId: string, color: string | undefined) => patchNode(nodeId, { color }, 'color'), [patchNode]);
  const handleSetIcon = useCallback((nodeId: string, icon: string | undefined) => patchNode(nodeId, { icon }, 'icon'), [patchNode]);
  const handleSetNotes = useCallback((nodeId: string, notes: string) => patchNode(nodeId, { notes }, 'notes'), [patchNode]);
  const handleSetImage = useCallback((nodeId: string, image: { url: string; alt?: string } | undefined) => patchNode(nodeId, { image }, 'image'), [patchNode]);
  const handleSetLinks = useCallback((nodeId: string, links: { label: string; url: string }[]) => patchNode(nodeId, { links }, 'links'), [patchNode]);
  const handleSetAttachments = useCallback((nodeId: string, attachments: { name: string; url: string }[]) => patchNode(nodeId, { attachments }, 'attachments'), [patchNode]);

  const handleSetShape = useCallback((nodeId: string, shape: 'rounded' | 'pill' | 'rect' | undefined) => {
    const d = dataRef.current;
    const cur = d?.nodes[nodeId];
    if (!d || !cur) return;
    commitChange(updateNode(d, nodeId, { style: { ...(cur.style || {}), shape } }), { historyKey: `shape:${nodeId}` });
  }, [commitChange]);

  const handleSetBold = useCallback((nodeId: string, bold: boolean) => {
    const d = dataRef.current;
    const cur = d?.nodes[nodeId];
    if (!d || !cur) return;
    commitChange(updateNode(d, nodeId, { style: { ...(cur.style || {}), bold } }), { historyKey: `bold:${nodeId}` });
  }, [commitChange]);

  const handleOutdent = useCallback((nodeId: string) => {
    const d = dataRef.current;
    if (!d) return;
    const next = outdentNode(d, nodeId);
    if (next !== d) commitChange(next);
  }, [commitChange]);

  const handleReorder = useCallback((nodeId: string, dir: -1 | 1) => {
    const d = dataRef.current;
    if (!d) return;
    const next = reorderNode(d, nodeId, dir);
    if (next !== d) commitChange(next);
  }, [commitChange]);

  // Aplica o enquadramento salvo (ou fit) — usado no primeiro load e ao
  // voltar do modo Esboço (o unmount do ReactFlow zera o viewport).
  const applyViewport = useCallback(() => {
    const saved = dataRef.current?.view;
    if (saved && typeof saved.zoom === 'number' && isFinite(saved.zoom) && saved.zoom > 0) {
      setViewport({ x: saved.x ?? 0, y: saved.y ?? 0, zoom: saved.zoom });
    } else {
      // maxZoom evita mapa pequeno estourado em 300% no primeiro fit
      fitView({ padding: 0.25, duration: 300, maxZoom: 1.25 });
    }
  }, [fitView, setViewport]);

  // ============ Medição de nós (React Flow → layout) ============
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let next: Record<string, NodeSize> | null = null;
    for (const ch of changes) {
      if (ch.type === 'dimensions' && ch.dimensions && ch.dimensions.width > 0 && ch.dimensions.height > 0) {
        const prev = sizesRef.current[ch.id];
        if (!prev || Math.abs(prev.width - ch.dimensions.width) > 0.5 || Math.abs(prev.height - ch.dimensions.height) > 0.5) {
          next = next || { ...sizesRef.current };
          next[ch.id] = { width: ch.dimensions.width, height: ch.dimensions.height };
        }
      }
    }
    if (next) {
      sizesRef.current = next;
      setSizes(next);
      // primeiro lote de medidas → enquadra o mapa com dimensões reais
      if (pendingFitRef.current) {
        pendingFitRef.current = false;
        requestAnimationFrame(() => applyViewport());
      }
    }
  }, [applyViewport]);

  // ============ Drag & drop (mover / reordenar nós) ============
  const computeDropTarget = useCallback((dragId: string, x: number, y: number): DropTarget | null => {
    const d = dataRef.current;
    const meta = dragMetaRef.current;
    if (!d || !meta) return null;
    const li = layoutIndexRef.current;
    const drag = li.get(dragId);
    if (!drag) return null;
    const cx = x + drag.width / 2;
    const cy = y + drag.height / 2;
    let best: { cand: LayoutNode; dy: number } | null = null;
    let bestDist = Infinity;
    for (const cand of li.values()) {
      if (cand.id === dragId || meta.subtree.has(cand.id)) continue;
      const ccx = cand.x + cand.width / 2;
      const ccy = cand.y + cand.height / 2;
      const dx = cx - ccx;
      const dy = cy - ccy;
      if (Math.abs(dx) > cand.width / 2 + 150 || Math.abs(dy) > cand.height / 2 + 48) continue;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; best = { cand, dy }; }
    }
    if (!best) return null;
    const { cand, dy } = best;
    if (cand.id === d.rootId) return { targetId: cand.id, kind: 'child' };
    const third = Math.max(10, cand.height / 3);
    const kind: DropHint = dy < -third ? 'before' : dy > third ? 'after' : 'child';
    return { targetId: cand.id, kind };
  }, []);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    const d = dataRef.current;
    if (!d || node.id === d.rootId) return;
    setSelectedId(node.id);
    setEditingId(null);
    setEditSeed(undefined);
    dragMetaRef.current = { id: node.id, subtree: new Set([node.id, ...getDescendantIds(d, node.id)]) };
    setDragPos({ id: node.id, x: node.position.x, y: node.position.y });
  }, []);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    if (!dragMetaRef.current || dragMetaRef.current.id !== node.id) return;
    setDragPos({ id: node.id, x: node.position.x, y: node.position.y });
    const target = computeDropTarget(node.id, node.position.x, node.position.y);
    dropTargetRef.current = target;
    setDropTarget(target);
  }, [computeDropTarget]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    const meta = dragMetaRef.current;
    const target = dropTargetRef.current;
    dragMetaRef.current = null;
    dropTargetRef.current = null;
    setDragPos(null);
    setDropTarget(null);
    const d = dataRef.current;
    if (!d || !meta || meta.id !== node.id) return;
    if (!target) return; // sem alvo → volta pro lugar (layout re-renderiza)

    let next = d;
    if (target.kind === 'child') {
      const children = getChildren(d, target.targetId).filter(c => c.id !== node.id);
      let side: 'left' | 'right' | undefined;
      if (target.targetId === d.rootId && (d.layout || 'map') === 'map') {
        const rootL = layoutIndexRef.current.get(d.rootId);
        const dragL = layoutIndexRef.current.get(node.id);
        if (rootL && dragL) {
          const rootCx = rootL.x + rootL.width / 2;
          side = node.position.x + dragL.width / 2 < rootCx ? 'left' : 'right';
        }
      }
      next = moveNode(d, node.id, target.targetId, children.length, side);
    } else {
      const tNode = d.nodes[target.targetId];
      if (!tNode?.parentId) return;
      const sibs = getChildren(d, tNode.parentId).filter(s => s.id !== node.id);
      const ti = sibs.findIndex(s => s.id === target.targetId);
      if (ti < 0) return;
      const index = target.kind === 'before' ? ti : ti + 1;
      const side = tNode.parentId === d.rootId ? tNode.side : undefined;
      next = moveNode(d, node.id, tNode.parentId, index, side);
    }
    if (next !== d) {
      commitChange(next);
      setSelectedId(node.id);
    }
  }, [commitChange]);

  // ============ Atalhos ============
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (showShortcuts) return;  // modal aberto: atalhos do mapa suspensos
      const d = dataRef.current;
      if (!d) return;

      // Undo/redo funcionam mesmo sem seleção
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }

      if (!selectedId) return;
      const sel = d.nodes[selectedId];
      if (!sel) return;

      // Edição já iniciada por digitação mas input ainda sem foco →
      // acumula os caracteres no seed pra não perder tecla nenhuma.
      if (editingId === selectedId) {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setEditSeed(prev => (prev ?? '') + e.key);
        }
        return;
      }
      const selSide = layoutIndexRef.current.get(selectedId)?.side
        ?? (sel.parentId ? 'right' : 'right');
      const isRoot = selectedId === d.rootId;

      const goToFirstChild = () => {
        const children = getChildren(d, selectedId);
        if (children.length === 0) return;
        if (sel.collapsed) handleToggleCollapse(selectedId);
        setSelectedId(children[0].id);
      };

      if (mod && e.key === 'ArrowUp') {
        e.preventDefault();
        handleReorder(selectedId, -1);
      } else if (mod && e.key === 'ArrowDown') {
        e.preventDefault();
        handleReorder(selectedId, 1);
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        handleOutdent(selectedId);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleAddChild(selectedId);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleAddSibling(selectedId);
      } else if (e.key === 'F2') {
        e.preventDefault();
        setEditSeed(undefined);
        setEditingId(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isRoot) return;
        e.preventDefault();
        handleDelete(selectedId);
      } else if (e.key === 'Escape') {
        // Se uma edição está pendente (input ainda sem foco), cancela
        // com a mesma semântica do Escape no input: nó novo vazio é
        // descartado. Sem edição, desseleciona (MindMeister).
        if (editingId) handleCancelEdit(editingId);
        else setSelectedId(null);
      } else if (e.key === ' ') {
        const children = getChildren(d, selectedId);
        if (children.length > 0) {
          e.preventDefault();
          handleToggleCollapse(selectedId);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isRoot) {
          // vai pro primeiro ramo da esquerda
          const leftKid = getChildren(d, selectedId).find(c =>
            layoutIndexRef.current.get(c.id)?.side === 'left');
          if (leftKid && !sel.collapsed) setSelectedId(leftKid.id);
        } else if (selSide === 'left') {
          goToFirstChild();  // lado esquerdo cresce pra esquerda
        } else if (sel.parentId) {
          setSelectedId(sel.parentId);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isRoot) {
          const rightKid = getChildren(d, selectedId).find(c =>
            layoutIndexRef.current.get(c.id)?.side !== 'left');
          if (rightKid && !sel.collapsed) setSelectedId(rightKid.id);
        } else if (selSide === 'left') {
          if (sel.parentId) setSelectedId(sel.parentId);
        } else {
          goToFirstChild();
        }
      } else if (e.key === 'ArrowUp' && sel.parentId) {
        const siblings = getChildren(d, sel.parentId);
        const idx = siblings.findIndex(s => s.id === selectedId);
        if (idx > 0) {
          e.preventDefault();
          setSelectedId(siblings[idx - 1].id);
        }
      } else if (e.key === 'ArrowDown' && sel.parentId) {
        const siblings = getChildren(d, sel.parentId);
        const idx = siblings.findIndex(s => s.id === selectedId);
        if (idx >= 0 && idx < siblings.length - 1) {
          e.preventDefault();
          setSelectedId(siblings[idx + 1].id);
        }
      } else if (
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      ) {
        // digitar com nó selecionado → edita substituindo (MindMeister)
        e.preventDefault();
        setEditSeed(e.key);
        setEditingId(selectedId);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, editingId, showShortcuts, undo, redo, handleAddChild, handleAddSibling, handleDelete, handleToggleCollapse, handleOutdent, handleReorder, handleCancelEdit]);

  // ============ Conversão pro ReactFlow ============
  const { rfNodes, rfEdges, layoutIndex, selColor } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[], layoutIndex: new Map<string, LayoutNode>(), selColor: '#3B82F6' };
    const layout = layoutMindMap(data, sizes);
    const index = new Map<string, LayoutNode>();
    for (const n of layout) index.set(n.id, n);

    const theme = (data.theme || 'minimal') as Theme;
    const colorOf = (n: LayoutNode): string => {
      if (n.color) return n.color;
      // cor herdada por RAMO: override do ancestral vale pra subarvore
      let cur = n;
      while (cur.parentId) {
        const parent = index.get(cur.parentId);
        if (!parent) break;
        if (parent.color && parent.depth > 0) return parent.color;
        cur = parent;
      }
      return colorForNode(n.depth, n.branchIndex, theme);
    };

    const nodes: Node[] = layout.map(n => {
      const childCount = getChildren(data, n.id).length;
      const color = colorOf(n);
      const isDragged = dragPos?.id === n.id;
      const nodeData: MindNodeData = {
        text: n.text,
        depth: n.depth,
        color,
        isRoot: n.id === data.rootId,
        collapsed: !!n.collapsed,
        childCount,
        editing: editingId === n.id,
        editSeed: editingId === n.id ? editSeed : undefined,
        side: n.side,
        icon: n.icon,
        hasNotes: !!(n.notes && n.notes.trim()),
        dropHint: dropTarget?.targetId === n.id ? dropTarget.kind : undefined,
        dragging: isDragged,
        onCommitEdit: (text: string) => handleEditCommit(n.id, text),
        onCancelEdit: () => handleCancelEdit(n.id),
        onStartEdit: () => { setEditSeed(undefined); setEditingId(n.id); },
        onToggleCollapse: () => handleToggleCollapse(n.id),
        onAddChild: () => handleAddChild(n.id),
        onAddSibling: () => handleAddSibling(n.id),
        onOutdent: () => handleOutdent(n.id),
        image: n.image,
        links: n.links,
        attachments: n.attachments,
        shape: n.style?.shape,
        bold: n.style?.bold,
      };
      return {
        id: n.id,
        type: 'mindNode',
        position: isDragged ? { x: dragPos.x, y: dragPos.y } : { x: n.x, y: n.y },
        data: nodeData as unknown as Record<string, unknown>,
        selected: selectedId === n.id,
        // arrastar durante a edição engoliria o texto digitado
        draggable: n.id !== data.rootId && editingId !== n.id,
        zIndex: isDragged ? 1000 : selectedId === n.id ? 10 : 0,
        // preserva as medições internas do React Flow entre re-renders —
        // sem isso cada sync desmonta edges e re-mede todos os nós
        measured: sizes[n.id],
      };
    });

    const edges: Edge[] = [];
    for (const n of layout) {
      if (n.parentId && data.nodes[n.parentId] && !data.nodes[n.parentId].collapsed) {
        const color = colorOf(n);
        // Convenção uniforme: source sai do lado de crescimento do filho
        // (right→saida na direita do pai; left→saida na esquerda do pai).
        // Target entra no lado oposto do filho. IDs dos handles são
        // 'l' ou 'r' em TODOS os nós (incluindo raiz e intermediários).
        const sourceHandle = n.side === 'left' ? 'l' : 'r';
        const targetHandle = n.side === 'left' ? 'r' : 'l';
        edges.push({
          id: `e-${n.parentId}-${n.id}`,
          source: n.parentId,
          target: n.id,
          sourceHandle,
          targetHandle,
          type: 'mind',
          data: { color, faded: dragPos?.id === n.id },
        });
      }
    }
    const selLayout = selectedId ? index.get(selectedId) : undefined;
    const selColor = selLayout ? colorOf(selLayout) : '#3B82F6';
    return { rfNodes: nodes, rfEdges: edges, layoutIndex: index, selColor };
  }, [data, sizes, selectedId, editingId, editSeed, dragPos, dropTarget, handleAddChild, handleAddSibling, handleEditCommit, handleCancelEdit, handleToggleCollapse, handleOutdent]);

  // Índice do layout disponível pros handlers de teclado/drag (fora do render)
  useEffect(() => { layoutIndexRef.current = layoutIndex; }, [layoutIndex]);

  // Nó que trocou de lado troca também a posição dos handles sem mudar de
  // tamanho — o ResizeObserver não dispara, então forçamos a re-medição.
  const prevSidesRef = useRef<Map<string, 'left' | 'right'>>(new Map());
  useEffect(() => {
    const changed: string[] = [];
    for (const [nid, n] of layoutIndex) {
      const prev = prevSidesRef.current.get(nid);
      if (prev && prev !== n.side) changed.push(nid);
    }
    prevSidesRef.current = new Map([...layoutIndex].map(([nid, n]) => [nid, n.side]));
    if (changed.length) updateNodeInternals(changed);
  }, [layoutIndex, updateNodeInternals]);

  // Auto-pan: nó selecionado/criado sempre visível (MindMeister). Pana o
  // mínimo necessário, sem mexer no zoom. Não interfere durante drag.
  useEffect(() => {
    if (!selectedId || dragPos || pendingFitRef.current) return;
    const n = layoutIndex.get(selectedId);
    const el = canvasRef.current;
    if (!n || !el) return;
    const vp = getViewport();
    const { width: cw, height: chh } = el.getBoundingClientRect();
    if (cw === 0 || chh === 0) return;
    const M = 48;   // margem lateral/inferior
    const MT = 84;  // topo maior: limpa a toolbar de seleção fixa
    const sx = n.x * vp.zoom + vp.x;
    const sy = n.y * vp.zoom + vp.y;
    const sw = n.width * vp.zoom;
    const sh = n.height * vp.zoom;
    let dx = 0;
    let dy = 0;
    if (sx < M) dx = M - sx;
    else if (sx + sw > cw - M) dx = (cw - M) - (sx + sw);
    if (sy < MT) dy = MT - sy;
    else if (sy + sh > chh - M) dy = (chh - M) - (sy + sh);
    // nó maior que a área útil: garante a borda inicial visível
    if (sw > cw - 2 * M && sx < M) dx = M - sx;
    if (dx !== 0 || dy !== 0) {
      setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 150 });
    }
  }, [selectedId, layoutIndex, dragPos, getViewport, setViewport]);

  // Persiste zoom/pan (debounced) — restaurado na próxima abertura
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    if (pendingFitRef.current) return;
    if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
    viewTimerRef.current = setTimeout(() => commitView(vp), 600);
  }, [commitView]);

  const onRenameMapa = (novo: string) => {
    const d = dataRef.current;
    if (!d) return;
    commitChange({ ...d, nome: novo }, { historyKey: 'nome' });
  };
  const onSetTheme = (theme: Theme) => {
    const d = dataRef.current;
    if (d) commitChange({ ...d, theme });
  };
  const onSetLayout = (layout: 'map' | 'logical') => {
    const d = dataRef.current;
    if (d) commitChange({ ...d, layout });
  };

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
          {/* Undo / Redo */}
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Refazer (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Toggle Esboço/Mapa */}
          <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setViewMode('map')}
              className={`px-2.5 py-1.5 inline-flex items-center gap-1 ${
                viewMode === 'map' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
              }`}
              title="Modo Mapa mental"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Mapa</span>
            </button>
            <button
              onClick={() => setViewMode('outline')}
              className={`px-2.5 py-1.5 inline-flex items-center gap-1 border-l border-slate-200 ${
                viewMode === 'outline' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
              }`}
              title="Modo Esboço (outline)"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Esboço</span>
            </button>
          </div>

          <button
            onClick={() => onSetLayout(data.layout === 'logical' ? 'map' : 'logical')}
            disabled={viewMode === 'outline'}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Trocar layout"
          >
            <GitBranch className="w-3.5 h-3.5 rotate-90" />
            <span className="hidden md:inline">{data.layout === 'logical' ? 'Árvore' : 'Mapa'}</span>
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
              onClick={() => flushSave()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-slate-700 hover:bg-slate-100"
              title="Salvar agora"
            >
              <Save className="w-3 h-3" /> Salvar
            </button>
          </div>
        </div>
      </header>

      {/* ========= CANVAS / OUTLINE + PAINEL ========= */}
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative" ref={canvasRef}>
          {viewMode === 'map' ? (
            <>
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeClick={(_, node) => setSelectedId(node.id)}
                onNodeDoubleClick={(_, node) => { setSelectedId(node.id); setEditSeed(undefined); setEditingId(node.id); }}
                onPaneClick={() => { setSelectedId(null); setEditingId(null); setEditSeed(undefined); }}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onMoveEnd={onMoveEnd}
                onInit={() => {
                  // remount (volta do modo Esboço) zera o viewport do
                  // provider — restaura o enquadramento salvo
                  if (!pendingFitRef.current) applyViewport();
                }}
                proOptions={{ hideAttribution: true }}
                // Interação padrão de mind map:
                // - drag no fundo (pane) → pan livre do canvas
                // - scroll wheel → zoom in/out (padrão)
                // - duplo-clique → editar nó (zoomOnDoubleClick desativado)
                // - drag de nó → mover pra outro pai / reordenar
                panOnDrag
                panOnScroll={false}
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick={false}
                nodesDraggable
                nodesConnectable={false}
                nodesFocusable={false}
                selectNodesOnDrag={false}
                elementsSelectable
                selectionOnDrag={false}
                deleteKeyCode={null}
                minZoom={0.2}
                maxZoom={3}
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

              {/* Toolbar do nó selecionado — FIXA no topo do canvas, nunca
                  cobre nós vizinhos (toolbar flutuante sobre o nó bloqueava
                  cliques nos irmãos com espaçamento apertado) */}
              {selNode && !dragPos && editingId !== selNode.id && (
                <SelectionToolbar
                  key={selNode.id}
                  color={selColor}
                  isRoot={selIsRoot}
                  nodeColor={selNode.color}
                  hasImage={!!selNode.image?.url}
                  hasLinks={!!selNode.links?.length}
                  hasAttachments={!!selNode.attachments?.length}
                  hasNotes={!!(selNode.notes && selNode.notes.trim())}
                  onSetColor={(c) => handleSetColor(selNode.id, c)}
                  onSetIcon={(i) => handleSetIcon(selNode.id, i)}
                  onOpenPanel={openPanelWithFocus}
                  onDelete={() => handleDelete(selNode.id)}
                />
              )}

              {/* Barra lateral direita flutuante (estilo XMind) */}
              {!showProperties && (
                <FloatingSidebar
                  onAddChild={() => selectedId && handleAddChild(selectedId)}
                  canAdd={!!selectedId}
                  currentTheme={(data.theme || 'minimal') as Theme}
                  onSetTheme={onSetTheme}
                  onTogglePanel={() => setShowProperties(true)}
                />
              )}
            </>
          ) : (
            <OutlineView
              data={data}
              selectedId={selectedId}
              editingId={editingId}
              editSeed={editSeed}
              onSelect={setSelectedId}
              onStartEdit={(nid) => { setEditSeed(undefined); setEditingId(nid); }}
              onCommitEdit={handleEditCommit}
              onCancelEdit={handleCancelEdit}
              onAddChild={handleAddChild}
              onAddSibling={handleAddSibling}
              onOutdent={handleOutdent}
              onToggleCollapse={handleToggleCollapse}
            />
          )}
        </div>

        {/* ========= PAINEL DIREITO ========= */}
        {showProperties && selNode && data && (
          <PropertiesPanel
            node={selNode}
            isRoot={selIsRoot}
            theme={(data.theme || 'minimal') as Theme}
            currentTheme={(data.theme || 'minimal') as Theme}
            focusSection={panelFocus}
            onSetColor={(c) => handleSetColor(selNode.id, c)}
            onSetIcon={(i) => handleSetIcon(selNode.id, i)}
            onSetNotes={(n) => handleSetNotes(selNode.id, n)}
            onSetShape={(s) => handleSetShape(selNode.id, s)}
            onSetBold={(b) => handleSetBold(selNode.id, b)}
            onSetImage={(img) => handleSetImage(selNode.id, img)}
            onSetLinks={(l) => handleSetLinks(selNode.id, l)}
            onSetAttachments={(a) => handleSetAttachments(selNode.id, a)}
            onSetTheme={onSetTheme}
            onClose={() => { setShowProperties(false); setPanelFocus(undefined); }}
            onDelete={() => handleDelete(selNode.id)}
          />
        )}
      </div>

      {/* ========= MODAL ATALHOS ========= */}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

// ============ Toolbar do nó selecionado (fixa no topo do canvas) ============
const QUICK_COLORS = ['#3B82F6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#475569'];
const QUICK_ICONS = ['💡', '⭐', '🎯', '🚀', '⚡', '🔥', '✅', '❓', '📌', '💰'];

function SelectionToolbar({
  color, isRoot, nodeColor, hasImage, hasLinks, hasAttachments, hasNotes,
  onSetColor, onSetIcon, onOpenPanel, onDelete,
}: {
  color: string;
  isRoot: boolean;
  nodeColor?: string;
  hasImage: boolean;
  hasLinks: boolean;
  hasAttachments: boolean;
  hasNotes: boolean;
  onSetColor: (c: string | undefined) => void;
  onSetIcon: (i: string | undefined) => void;
  onOpenPanel: (section?: PanelSection) => void;
  onDelete: () => void;
}) {
  const [openPicker, setOpenPicker] = useState<null | 'color' | 'icon'>(null);
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
      <div
        className="bg-white rounded-xl border border-slate-200 px-1.5 py-1.5 flex items-center gap-0.5"
        style={{ boxShadow: '0 6px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)' }}
      >
        {/* Cor */}
        <div className="relative">
          <button
            onClick={() => setOpenPicker(p => p === 'color' ? null : 'color')}
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
            >
              <button
                onClick={() => { onSetColor(undefined); setOpenPicker(null); }}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold text-slate-500 hover:scale-110 transition-transform ${!nodeColor ? 'border-slate-900' : 'border-slate-200'}`}
                title="Cor automática (por ramo)"
              >
                A
              </button>
              {QUICK_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { onSetColor(c); setOpenPicker(null); }}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                  style={{ background: c, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* Ícone */}
        <div className="relative">
          <button
            onClick={() => setOpenPicker(p => p === 'icon' ? null : 'icon')}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
            title="Ícone"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          {openPicker === 'icon' && (
            <div
              className="absolute top-full mt-2 left-0 bg-white rounded-lg border border-slate-200 p-2 flex flex-wrap gap-1 w-[180px] z-50"
              style={{ boxShadow: '0 10px 32px rgba(15,23,42,0.18)' }}
            >
              <button
                onClick={() => { onSetIcon(undefined); setOpenPicker(null); }}
                className="w-7 h-7 rounded text-[10px] text-slate-500 border border-slate-200 hover:bg-slate-50"
              >∅</button>
              {QUICK_ICONS.map(ic => (
                <button
                  key={ic}
                  onClick={() => { onSetIcon(ic); setOpenPicker(null); }}
                  className="w-7 h-7 rounded text-base hover:bg-slate-100 transition-colors"
                >
                  {ic}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        <button
          onClick={() => onOpenPanel('image')}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasImage ? 'text-blue-600' : 'text-slate-600'}`}
          title="Imagem"
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onOpenPanel('attachments')}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasAttachments ? 'text-blue-600' : 'text-slate-600'}`}
          title="Anexo"
        >
          <Paperclip className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onOpenPanel('links')}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasLinks ? 'text-blue-600' : 'text-slate-600'}`}
          title="Link"
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        <button
          onClick={() => onOpenPanel('notes')}
          className={`p-1.5 rounded-md hover:bg-slate-100 ${hasNotes ? 'text-amber-500' : 'text-slate-600'}`}
          title="Nota"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onOpenPanel()}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
          title="Mais opções"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {!isRoot && (
          <>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onClick={onDelete}
              className="p-1.5 rounded-md hover:bg-red-50 text-slate-500 hover:text-red-600"
              title="Apagar (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Barra lateral direita flutuante ============
function FloatingSidebar({
  onAddChild, canAdd, currentTheme, onSetTheme, onTogglePanel,
}: {
  onAddChild: () => void;
  canAdd: boolean;
  currentTheme: Theme;
  onSetTheme: (t: Theme) => void;
  onTogglePanel: () => void;
}) {
  const [openTheme, setOpenTheme] = useState(false);
  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-3">
      {/* Grupo 1: ação primária */}
      <button
        onClick={onAddChild}
        disabled={!canAdd}
        className="w-11 h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center text-blue-600 hover:bg-blue-50 disabled:text-slate-300 disabled:hover:bg-white transition-colors"
        style={{ boxShadow: '0 4px 14px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.04)' }}
        title="Adicionar filho ao selecionado (Tab)"
      >
        <Plus className="w-5 h-5" />
      </button>

      {/* Grupo 2: configurações visuais */}
      <div
        className="flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 4px 14px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.04)' }}
      >
        <button
          onClick={onTogglePanel}
          className="w-11 h-11 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
          title="Painel de propriedades"
        >
          <GitBranch className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            onClick={() => setOpenTheme(t => !t)}
            className="w-11 h-11 flex items-center justify-center hover:bg-slate-50 transition-colors"
            title="Tema"
          >
            <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
              <div className="rounded-full" style={{ background: '#3B82F6' }} />
              <div className="rounded-full" style={{ background: '#ec4899' }} />
              <div className="rounded-full" style={{ background: '#10b981' }} />
              <div className="rounded-full" style={{ background: '#f59e0b' }} />
            </div>
          </button>
          {openTheme && (
            <div
              className="absolute top-0 right-full mr-2 bg-white border border-slate-200 rounded-xl p-2 w-[180px]"
              style={{ boxShadow: '0 10px 32px rgba(15,23,42,0.18)' }}
            >
              {THEMES.map(t => (
                <button
                  key={t.id}
                  onClick={() => { onSetTheme(t.id); setOpenTheme(false); }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors ${
                    currentTheme === t.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex gap-0.5">
                    {t.preview.slice(0, 4).map((c, i) => (
                      <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="text-xs font-medium text-slate-700 flex-1">{t.label}</span>
                  {currentTheme === t.id && <Check className="w-3 h-3 text-blue-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Painel direito de propriedades ============
function PropertiesPanel({
  node, isRoot, currentTheme, focusSection,
  onSetColor, onSetIcon, onSetNotes, onSetTheme, onClose, onDelete,
  onSetShape, onSetBold, onSetImage, onSetLinks, onSetAttachments,
}: {
  node: MindNodeRecord;
  isRoot: boolean;
  theme: Theme;
  currentTheme: Theme;
  focusSection?: PanelSection;
  onSetColor: (c: string | undefined) => void;
  onSetIcon: (i: string | undefined) => void;
  onSetNotes: (n: string) => void;
  onSetTheme: (t: Theme) => void;
  onClose: () => void;
  onDelete: () => void;
  onSetShape: (s: 'rounded' | 'pill' | 'rect' | undefined) => void;
  onSetBold: (b: boolean) => void;
  onSetImage: (img: { url: string; alt?: string } | undefined) => void;
  onSetLinks: (links: { label: string; url: string }[]) => void;
  onSetAttachments: (atts: { name: string; url: string }[]) => void;
}) {
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const imageUrlRef = useRef<HTMLInputElement>(null);

  // Auto-foco na seção pedida ao abrir o painel via toolbar contextual
  useEffect(() => {
    if (!focusSection) return;
    const t = setTimeout(() => {
      if (focusSection === 'notes') notesRef.current?.focus();
      if (focusSection === 'image') imageUrlRef.current?.focus();
      const el = document.getElementById(`panel-section-${focusSection}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(t);
  }, [focusSection, node.id]);

  return (
    <aside className="w-[300px] shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
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
              title="Cor automática (por ramo)"
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

        {/* Forma */}
        <Section icon={<Shapes className="w-3.5 h-3.5" />} title="Forma">
          <div className="grid grid-cols-4 gap-1.5">
            <ShapeBtn label="Texto" active={!node.style?.shape && !isRoot} onClick={() => onSetShape(undefined)} disabled={isRoot} preview="text" />
            <ShapeBtn label="Arred." active={node.style?.shape === 'rounded' || (isRoot && !node.style?.shape)} onClick={() => onSetShape('rounded')} preview="rounded" />
            <ShapeBtn label="Pill" active={node.style?.shape === 'pill'} onClick={() => onSetShape('pill')} preview="pill" />
            <ShapeBtn label="Reto" active={node.style?.shape === 'rect'} onClick={() => onSetShape('rect')} preview="rect" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={!!node.style?.bold}
              onChange={e => onSetBold(e.target.checked)}
              className="rounded border-slate-300"
            />
            Negrito
          </label>
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

        {/* Imagem */}
        <div id="panel-section-image">
          <Section icon={<ImageIcon className="w-3.5 h-3.5" />} title="Imagem">
            <div className="space-y-2">
              <UploadButton
                accept="image/*"
                label="Enviar imagem"
                onUploaded={(files) => {
                  const f = files[0];
                  if (f) onSetImage({ url: f.url, alt: f.nome });
                }}
              />
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className="flex-1 h-px bg-slate-200" />
                ou cole uma URL
                <span className="flex-1 h-px bg-slate-200" />
              </div>
              <input
                ref={imageUrlRef}
                type="url"
                value={node.image?.url || ''}
                onChange={e => {
                  const url = e.target.value.trim();
                  onSetImage(url ? { url, alt: node.image?.alt } : undefined);
                }}
                placeholder="https://..."
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 outline-none focus:border-blue-400 focus:bg-white"
              />
              {node.image?.url && (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={node.image.url} alt={node.image.alt || ''} className="w-full max-h-32 object-cover rounded border border-slate-200" />
                  <button
                    onClick={() => onSetImage(undefined)}
                    className="mt-1.5 text-[11px] text-red-500 hover:text-red-700"
                  >
                    Remover imagem
                  </button>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Links */}
        <div id="panel-section-links">
          <Section icon={<Link2 className="w-3.5 h-3.5" />} title="Links">
            <ListEditor
              items={node.links || []}
              onChange={onSetLinks}
              fields={[
                { key: 'label', placeholder: 'Título' },
                { key: 'url', placeholder: 'https://...' },
              ]}
              addLabel="+ link"
            />
          </Section>
        </div>

        {/* Anexos */}
        <div id="panel-section-attachments">
          <Section icon={<Paperclip className="w-3.5 h-3.5" />} title="Anexos">
            <div className="space-y-2">
              <UploadButton
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*"
                multiple
                label="Enviar arquivos"
                onUploaded={(files) => {
                  const existing = node.attachments || [];
                  const additions = files.map(f => ({ name: f.nome, url: f.url }));
                  onSetAttachments([...existing, ...additions]);
                }}
              />
              <ListEditor
                items={node.attachments || []}
                onChange={onSetAttachments}
                fields={[
                  { key: 'name', placeholder: 'Nome do arquivo' },
                  { key: 'url', placeholder: 'https://...' },
                ]}
                addLabel="+ adicionar manualmente"
              />
            </div>
          </Section>
        </div>

        {/* Notas */}
        <div id="panel-section-notes">
          <Section icon={<StickyNote className="w-3.5 h-3.5" />} title="Notas">
            <textarea
              ref={notesRef}
              value={node.notes || ''}
              onChange={e => onSetNotes(e.target.value)}
              placeholder="Adicione uma nota..."
              rows={4}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2 outline-none focus:border-blue-400 focus:bg-white resize-none"
            />
          </Section>
        </div>

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

      {/* Rodapé com ação destrutiva (só pra filhos) */}
      {!isRoot && (
        <div className="shrink-0 border-t border-slate-100 p-3">
          <button
            onClick={onDelete}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Apagar tópico
          </button>
        </div>
      )}
    </aside>
  );
}

type PanelSection = 'image' | 'links' | 'attachments' | 'notes';
type MindNodeRecord = {
  id: string;
  text: string;
  color?: string;
  icon?: string;
  notes?: string;
  image?: { url: string; alt?: string };
  links?: { label: string; url: string }[];
  attachments?: { name: string; url: string }[];
  style?: { shape?: 'rounded' | 'pill' | 'rect'; bold?: boolean };
};

function ShapeBtn({
  label, active, onClick, disabled, preview,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  preview: 'text' | 'rounded' | 'pill' | 'rect';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-md border transition-colors ${
        active
          ? 'border-blue-300 bg-blue-50'
          : disabled
            ? 'border-slate-100 text-slate-300 cursor-not-allowed'
            : 'border-slate-200 hover:bg-slate-50'
      }`}
      title={preview === 'text' ? 'Apenas texto (filhos)' : `Forma ${label}`}
    >
      <span
        className={`w-7 h-3 bg-slate-300 ${
          preview === 'pill' ? 'rounded-full'
          : preview === 'rect' ? 'rounded-sm'
          : preview === 'rounded' ? 'rounded-md'
          : 'bg-transparent border-b border-slate-400'
        }`}
      />
      <span className="text-[10px] text-slate-600">{label}</span>
    </button>
  );
}

function ListEditor<T extends Record<string, string>>({
  items, onChange, fields, addLabel,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  fields: { key: keyof T; placeholder: string }[];
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex flex-col gap-1 p-2 rounded border border-slate-200 bg-slate-50">
          {fields.map(f => (
            <input
              key={String(f.key)}
              value={item[f.key] || ''}
              onChange={e => {
                const next = [...items];
                next[idx] = { ...next[idx], [f.key]: e.target.value };
                onChange(next);
              }}
              placeholder={f.placeholder}
              className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
            />
          ))}
          <button
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            className="text-[10px] text-red-500 hover:text-red-700 self-end"
          >
            Remover
          </button>
        </div>
      ))}
      <button
        onClick={() => {
          const empty = Object.fromEntries(fields.map(f => [f.key, ''])) as T;
          onChange([...items, empty]);
        }}
        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
      >
        {addLabel}
      </button>
    </div>
  );
}

// Botão de upload via /api/upload. accept controla quais tipos abrir no
// file picker; multiple permite seleção múltipla (útil pra anexos).
function UploadButton({
  accept, multiple, label, onUploaded,
}: {
  accept: string;
  multiple?: boolean;
  label: string;
  onUploaded: (files: { url: string; nome: string; tamanho: number }[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'falha' }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url: string; nome: string; tamanho: number }[];
      onUploaded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no upload');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {uploading ? 'Enviando...' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={e => handleFiles(e.target.files)}
        className="hidden"
      />
      {error && <p className="mt-1 text-[10px] text-red-500">{error}</p>}
    </>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const items = [
    { k: 'Tab',            v: 'Adicionar filho' },
    { k: 'Enter',          v: 'Adicionar irmão' },
    { k: 'Shift+Tab',      v: 'Subir um nível' },
    { k: 'F2 / digitar',   v: 'Editar texto' },
    { k: 'Duplo-clique',   v: 'Editar texto' },
    { k: 'Delete / ⌫',     v: 'Remover nó (desfazível)' },
    { k: 'Ctrl+Z',         v: 'Desfazer' },
    { k: 'Ctrl+Shift+Z',   v: 'Refazer' },
    { k: 'Ctrl+↑ / Ctrl+↓', v: 'Mover entre os irmãos' },
    { k: 'Escape',         v: 'Sair da edição' },
    { k: 'Espaço',         v: 'Recolher / expandir' },
    { k: '← ↑ ↓ →',        v: 'Navegar entre nós' },
    { k: 'Arrastar nó',    v: 'Mover pra outro pai / reordenar' },
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
          <ChevR className="w-3 h-3" /> Dica: clique num nó e simplesmente digite pra reescrevê-lo.
        </div>
      </div>
    </div>
  );
}

// Helpers re-exportados (usados pela /lista)
export function _createMindMap(nome: string) { return createMindMap(nome); }
export function _newId() { return newId(); }
