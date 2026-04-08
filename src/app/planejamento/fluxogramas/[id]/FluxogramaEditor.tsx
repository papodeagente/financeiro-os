'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  reconnectEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, Save, Download, Trash2, Check, Loader2,
  Circle, CircleDot, Square, Diamond as DiamondIcon, Box,
  StickyNote, Layers, User, Cog, CircleDashed,
  Plus, X as XIcon, ListChecks, FileText,
  Clock, Mail, MessageCircle,
} from 'lucide-react';
import { generateId } from '@/lib/utils';
import { NODE_TYPES, type ChecklistItem, type DelayUnit } from './BpmnNodes';

interface Categoria { id: string; nome: string; ordem: number }
interface FluxogramaPayload {
  id: string;
  nome: string;
  descricao?: string;
  categoria_id: string;
  nodes: Node[];
  edges: Edge[];
  created_at?: string;
  updated_at?: string;
}

type PaletteShape = {
  type: keyof typeof NODE_TYPES;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultLabel: string;
  defaultStyle?: { width?: number; height?: number };
};

const PALETTE_SECTIONS: { title: string; shapes: PaletteShape[] }[] = [
  {
    title: 'Eventos',
    shapes: [
      { type: 'startEvent', label: 'Início', hint: 'Start event', icon: Circle, defaultLabel: 'Início' },
      { type: 'intermediateEvent', label: 'Intermediário', hint: 'Intermediate', icon: CircleDashed, defaultLabel: 'Evento' },
      { type: 'endEvent', label: 'Fim', hint: 'End event', icon: CircleDot, defaultLabel: 'Fim' },
    ],
  },
  {
    title: 'Atividades',
    shapes: [
      { type: 'task', label: 'Tarefa', hint: 'Task', icon: Square, defaultLabel: 'Tarefa' },
      { type: 'userTask', label: 'Usuário', hint: 'User task', icon: User, defaultLabel: 'Tarefa de usuário' },
      { type: 'serviceTask', label: 'Serviço', hint: 'Service task', icon: Cog, defaultLabel: 'Serviço automatizado' },
      { type: 'subprocess', label: 'Subprocesso', hint: 'Subprocess', icon: Box, defaultLabel: 'Subprocesso' },
    ],
  },
  {
    title: 'Gateways',
    shapes: [
      { type: 'gateway', label: 'Decisão', hint: 'Gateway exclusivo', icon: DiamondIcon, defaultLabel: 'Decisão' },
    ],
  },
  {
    title: 'Containers',
    shapes: [
      {
        type: 'pool',
        label: 'Pool / Raia',
        hint: 'Pool / Lane',
        icon: Layers,
        defaultLabel: 'Departamento',
        defaultStyle: { width: 480, height: 200 },
      },
      { type: 'annotation', label: 'Anotação', hint: 'Sticky note', icon: StickyNote, defaultLabel: 'Anotação...' },
    ],
  },
  {
    title: 'Mensagens & Tempo',
    shapes: [
      { type: 'delay', label: 'Aguardar', hint: 'Tempo de espera', icon: Clock, defaultLabel: 'Aguardar' },
      { type: 'email', label: 'E-mail', hint: 'Enviar e-mail', icon: Mail, defaultLabel: 'Enviar e-mail' },
      { type: 'whatsapp', label: 'WhatsApp', hint: 'Enviar WhatsApp', icon: MessageCircle, defaultLabel: 'Enviar WhatsApp' },
    ],
  },
];

const SHAPE_INDEX: Record<string, PaletteShape> = (() => {
  const idx: Record<string, PaletteShape> = {};
  PALETTE_SECTIONS.forEach(s => s.shapes.forEach(sh => { idx[sh.type] = sh; }));
  return idx;
})();

interface EditorProps { id: string }

function EditorInner({ id }: EditorProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<FluxogramaPayload | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  // Carrega fluxograma + categorias
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/planejamento/fluxogramas/${id}`).then(r => r.ok ? r.json() : null),
      fetch('/api/planejamento/fluxograma-categorias').then(r => r.json()),
    ]).then(([flx, cats]) => {
      if (cancelled) return;
      if (!flx || (flx as { error?: unknown }).error) {
        setError('Fluxograma não encontrado.');
        setLoading(false);
        return;
      }
      const data = flx as FluxogramaPayload;
      setMeta(data);
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
      setEdges(Array.isArray(data.edges) ? data.edges : []);
      setCategorias(Array.isArray(cats) ? cats : []);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('Falha ao carregar.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({
      ...connection,
      type: 'smoothstep',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#1A1A1A' },
      style: { stroke: '#1A1A1A', strokeWidth: 1.5 },
    }, eds));
  }, []);

  // Reconexão: permite agarrar o endpoint de uma edge existente
  // e arrastá-lo para outro handle/nó sem precisar recriar a conexão.
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    edgeReconnectSuccessful.current = true;
    setEdges(eds => reconnectEdge(oldEdge, newConnection, eds));
  }, []);

  const onReconnectEnd = useCallback((_event: unknown, edge: Edge) => {
    // Se o usuário soltou a ponta fora de um handle válido, remove a edge.
    if (!edgeReconnectSuccessful.current) {
      setEdges(eds => eds.filter(e => e.id !== edge.id));
    }
    edgeReconnectSuccessful.current = true;
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/bpmn-type');
    if (!type || !SHAPE_INDEX[type]) return;
    const shape = SHAPE_INDEX[type];
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const initialData: Record<string, unknown> = { label: shape.defaultLabel };
    if (type === 'delay') {
      initialData.delayValue = 1;
      initialData.delayUnit = 'horas';
    } else if (type === 'email') {
      initialData.subject = '';
      initialData.template = '';
    } else if (type === 'whatsapp') {
      initialData.template = '';
    }
    const newNode: Node = {
      id: generateId(),
      type,
      position,
      data: initialData,
      ...(shape.defaultStyle ? { style: shape.defaultStyle } : {}),
    };
    setNodes(nds => nds.concat(newNode));
  }, [screenToFlowPosition]);

  const onPaletteDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/bpmn-type', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
    setSelectedNode(ns[0] ?? null);
    setSelectedEdge(es[0] ?? null);
  }, []);

  const updateSelectedNodeData = (patch: Record<string, unknown>) => {
    if (!selectedNode) return;
    setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n));
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...patch } } : prev);
  };

  const getChecklist = (): ChecklistItem[] => {
    const list = (selectedNode?.data as { checklist?: ChecklistItem[] } | undefined)?.checklist;
    return Array.isArray(list) ? list : [];
  };

  const setChecklist = (next: ChecklistItem[]) => updateSelectedNodeData({ checklist: next });

  const addChecklistItem = () => {
    setChecklist([...getChecklist(), { id: generateId(), text: '', done: false }]);
  };

  const updateChecklistItem = (id: string, patch: Partial<ChecklistItem>) => {
    setChecklist(getChecklist().map(it => it.id === id ? { ...it, ...patch } : it));
  };

  const removeChecklistItem = (id: string) => {
    setChecklist(getChecklist().filter(it => it.id !== id));
  };

  const updateMeta = (patch: Partial<FluxogramaPayload>) => {
    setMeta(m => m ? { ...m, ...patch } : m);
  };

  const deleteSelected = () => {
    if (selectedNode) {
      setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
      setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
    }
    if (selectedEdge) {
      setEdges(eds => eds.filter(e => e.id !== selectedEdge.id));
      setSelectedEdge(null);
    }
  };

  // Atalho Delete/Backspace
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode || selectedEdge) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, selectedEdge]);

  const save = useCallback(async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const payload: FluxogramaPayload = {
        ...meta,
        nodes,
        edges,
        updated_at: new Date().toISOString(),
      };
      const res = await fetch(`/api/planejamento/fluxogramas/${meta.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }, [meta, nodes, edges]);

  // Atalho Cmd/Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const exportJson = () => {
    if (!meta) return;
    const blob = new Blob([JSON.stringify({ ...meta, nodes, edges }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.nome.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const savedLabel = useMemo(() => {
    if (saving) return 'Salvando...';
    if (savedAt) return `Salvo às ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    return 'Não salvo';
  }, [saving, savedAt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--t-bg)] text-[var(--t-text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando fluxograma...
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="h-screen bg-[var(--t-bg)] p-6">
        <button
          onClick={() => router.push('/planejamento/fluxogramas')}
          className="flex items-center gap-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao sistema
        </button>
        <p className="mt-6 text-[var(--text-body)] text-red-500">{error || 'Não encontrado'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--t-bg)]">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[var(--t-border)] bg-[var(--t-surface)] shrink-0">
        <button
          onClick={() => router.push('/planejamento/fluxogramas')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)] text-[var(--text-body-sm)] font-medium"
          title="Voltar ao sistema"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao sistema</span>
        </button>
        <span className="h-5 w-px bg-[var(--t-border)]" />
        <input
          value={meta.nome}
          onChange={e => updateMeta({ nome: e.target.value })}
          placeholder="Nome do fluxograma"
          className="flex-1 max-w-[360px] px-2 py-1 text-[var(--text-body)] font-medium text-[var(--t-text)] bg-transparent focus:bg-[var(--t-input-bg)] rounded outline-none"
        />
        <select
          value={meta.categoria_id}
          onChange={e => updateMeta({ categoria_id: e.target.value })}
          className="px-2 py-1 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] bg-[var(--t-input-bg)] rounded shadow-[var(--t-card-shadow)]"
        >
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] ml-auto flex items-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : savedAt ? <Check className="w-3 h-3 text-[var(--t-green)]" /> : null}
          {savedLabel}
        </span>
        <button
          onClick={exportJson}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-[var(--t-text)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-hover)]"
        >
          <Download className="w-3.5 h-3.5" /> Exportar
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> Salvar
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Palette à esquerda (Miro-style) */}
        <aside className="w-[220px] shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto p-3">
          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider mb-2">
            Arraste para o canvas
          </p>
          {PALETTE_SECTIONS.map(section => (
            <div key={section.title} className="mb-4">
              <p className="text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] mb-1.5">
                {section.title}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {section.shapes.map(shape => {
                  const Icon = shape.icon;
                  return (
                    <div
                      key={shape.type}
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, shape.type)}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] hover:bg-[var(--t-green-bg)] transition-colors cursor-grab active:cursor-grabbing"
                      title={shape.hint}
                    >
                      <Icon className="w-5 h-5 text-[var(--t-text-secondary)]" />
                      <span className="text-[10px] text-[var(--t-text)] text-center leading-tight">{shape.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <div ref={wrapperRef} className="flex-1 relative bg-[var(--t-bg)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onReconnectEnd={onReconnectEnd}
            onInit={setRfInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onSelectionChange={onSelectionChange}
            nodeTypes={NODE_TYPES}
            connectionMode={ConnectionMode.Loose}
            edgesReconnectable
            fitView
            snapToGrid
            snapGrid={[12, 12]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              reconnectable: true,
              markerEnd: { type: MarkerType.ArrowClosed, color: '#1A1A1A' },
              style: { stroke: '#1A1A1A', strokeWidth: 1.5 },
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(0,0,0,0.04)" />
          </ReactFlow>
          {/* Hint quando vazio */}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center px-6 py-4 rounded-xl bg-[var(--t-surface)]/80 border border-dashed border-[var(--t-border)]">
                <p className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">Arraste blocos da paleta à esquerda para começar.</p>
              </div>
            </div>
          )}
        </div>

        {/* Inspetor à direita */}
        <aside className="w-[320px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto p-4">
          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Inspetor</p>

          {!selectedNode && !selectedEdge && (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Descrição do fluxograma</label>
                  <textarea
                    value={meta.descricao || ''}
                    onChange={e => updateMeta({ descricao: e.target.value })}
                    rows={4}
                    placeholder="Para quê serve este fluxograma?"
                    className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-none"
                  />
                </div>
                <div className="text-[var(--text-caption)] text-[var(--t-text-muted)] pt-3 border-t border-[var(--t-border)]">
                  <p className="mb-1">{nodes.length} blocos · {edges.length} conexões</p>
                  <p className="opacity-70">Selecione um bloco para editar suas propriedades.</p>
                </div>
                <div className="text-[var(--text-caption)] text-[var(--t-text-muted)] space-y-1 pt-3 border-t border-[var(--t-border)]">
                  <p className="font-semibold text-[var(--t-text-secondary)]">Atalhos</p>
                  <p>⌫ excluir seleção · ⌘S salvar</p>
                  <p>arrastar para conectar · scroll para zoom</p>
                </div>
              </div>
            </>
          )}

          {selectedNode && (
            <div className="space-y-3">
              <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">
                {SHAPE_INDEX[selectedNode.type ?? '']?.label ?? selectedNode.type}
              </p>
              <div>
                <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Rótulo</label>
                <input
                  value={(selectedNode.data as { label?: string }).label ?? ''}
                  onChange={e => updateSelectedNodeData({ label: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                />
              </div>
              <div>
                <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Descrição</label>
                <textarea
                  value={(selectedNode.data as { description?: string }).description ?? ''}
                  onChange={e => updateSelectedNodeData({ description: e.target.value })}
                  rows={3}
                  className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Cor de fundo</label>
                  <input
                    type="color"
                    value={(selectedNode.data as { bgColor?: string }).bgColor ?? '#dbeafe'}
                    onChange={e => updateSelectedNodeData({ bgColor: e.target.value })}
                    className="w-full h-9 rounded-md cursor-pointer bg-transparent"
                  />
                </div>
                <div>
                  <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Cor do texto</label>
                  <input
                    type="color"
                    value={(selectedNode.data as { textColor?: string }).textColor ?? '#1e3a8a'}
                    onChange={e => updateSelectedNodeData({ textColor: e.target.value })}
                    className="w-full h-9 rounded-md cursor-pointer bg-transparent"
                  />
                </div>
              </div>

              {/* Configuração específica: Aguardar (delay) */}
              {selectedNode.type === 'delay' && (
                <div className="pt-3 mt-1 border-t border-[var(--t-border)] space-y-3">
                  <div className="flex items-center gap-1.5 text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider">
                    <Clock className="w-3 h-3" /> Tempo de espera
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Quantidade</label>
                      <input
                        type="number"
                        min={0}
                        value={(selectedNode.data as { delayValue?: number }).delayValue ?? 1}
                        onChange={e => updateSelectedNodeData({ delayValue: Number(e.target.value) })}
                        className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                      />
                    </div>
                    <div>
                      <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Unidade</label>
                      <select
                        value={(selectedNode.data as { delayUnit?: DelayUnit }).delayUnit ?? 'horas'}
                        onChange={e => updateSelectedNodeData({ delayUnit: e.target.value as DelayUnit })}
                        className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                      >
                        <option value="minutos">minutos</option>
                        <option value="horas">horas</option>
                        <option value="dias">dias</option>
                        <option value="semanas">semanas</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Configuração específica: E-mail */}
              {selectedNode.type === 'email' && (
                <div className="pt-3 mt-1 border-t border-[var(--t-border)] space-y-3">
                  <div className="flex items-center gap-1.5 text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider">
                    <Mail className="w-3 h-3" /> Mensagem de e-mail
                  </div>
                  <div>
                    <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Assunto</label>
                    <input
                      value={(selectedNode.data as { subject?: string }).subject ?? ''}
                      onChange={e => updateSelectedNodeData({ subject: e.target.value })}
                      placeholder="Ex.: Confirmação da sua reserva"
                      className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Template do e-mail</label>
                    <textarea
                      value={(selectedNode.data as { template?: string }).template ?? ''}
                      onChange={e => updateSelectedNodeData({ template: e.target.value })}
                      rows={8}
                      placeholder="Olá {{cliente}}, sua viagem está confirmada..."
                      className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-y leading-snug font-mono"
                    />
                    <p className="mt-1 text-[var(--text-caption)] text-[var(--t-text-muted)]">
                      Use variáveis como <code>{'{{cliente}}'}</code> ou <code>{'{{grupo}}'}</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* Configuração específica: WhatsApp */}
              {selectedNode.type === 'whatsapp' && (
                <div className="pt-3 mt-1 border-t border-[var(--t-border)] space-y-3">
                  <div className="flex items-center gap-1.5 text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider">
                    <MessageCircle className="w-3 h-3" /> Mensagem de WhatsApp
                  </div>
                  <div>
                    <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Template da mensagem</label>
                    <textarea
                      value={(selectedNode.data as { template?: string }).template ?? ''}
                      onChange={e => updateSelectedNodeData({ template: e.target.value })}
                      rows={8}
                      placeholder="Olá {{cliente}}! 👋 Tudo certo para sua viagem..."
                      className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-y leading-snug font-mono"
                    />
                    <p className="mt-1 text-[var(--text-caption)] text-[var(--t-text-muted)]">
                      Use variáveis como <code>{'{{cliente}}'}</code> ou <code>{'{{grupo}}'}</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* Cartão da tarefa: instruções + checklist */}
              <div className="pt-3 mt-1 border-t border-[var(--t-border)] space-y-3">
                <div className="flex items-center gap-1.5 text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider">
                  <FileText className="w-3 h-3" /> Cartão da tarefa
                </div>

                <div>
                  <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Instruções de execução</label>
                  <textarea
                    value={(selectedNode.data as { instructions?: string }).instructions ?? ''}
                    onChange={e => updateSelectedNodeData({ instructions: e.target.value })}
                    rows={6}
                    placeholder="Como executar esta tarefa? Quem é responsável, quais ferramentas usar, qual o resultado esperado..."
                    className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-y leading-snug"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5 text-[var(--text-caption)] text-[var(--t-text-muted)]">
                      <ListChecks className="w-3 h-3" /> Checklist
                      {getChecklist().length > 0 && (
                        <span className="text-[var(--t-text-secondary)]">
                          ({getChecklist().filter(i => i.done).length}/{getChecklist().length})
                        </span>
                      )}
                    </span>
                    <button
                      onClick={addChecklistItem}
                      className="flex items-center gap-1 text-[var(--text-caption)] text-[var(--t-green)] hover:underline"
                    >
                      <Plus className="w-3 h-3" /> Adicionar
                    </button>
                  </div>

                  {getChecklist().length === 0 ? (
                    <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] italic px-1">
                      Nenhum item ainda. Adicione passos verificáveis para esta tarefa.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {getChecklist().map(item => (
                        <li
                          key={item.id}
                          className="group flex items-start gap-2 p-1.5 rounded-md hover:bg-[var(--t-surface-hover)]"
                        >
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={e => updateChecklistItem(item.id, { done: e.target.checked })}
                            className="mt-1 w-3.5 h-3.5 accent-[var(--t-green)] cursor-pointer shrink-0"
                          />
                          <input
                            value={item.text}
                            onChange={e => updateChecklistItem(item.id, { text: e.target.value })}
                            placeholder="Descreva o passo..."
                            className={`flex-1 min-w-0 bg-transparent text-[var(--text-body-sm)] outline-none border-b border-transparent focus:border-[var(--t-border)] ${
                              item.done ? 'line-through text-[var(--t-text-muted)]' : 'text-[var(--t-text)]'
                            }`}
                          />
                          <button
                            onClick={() => removeChecklistItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--t-text-muted)] hover:bg-red-500/10 hover:text-red-500 shrink-0"
                            title="Remover item"
                          >
                            <XIcon className="w-3 h-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir bloco
              </button>
            </div>
          )}

          {selectedEdge && !selectedNode && (
            <div className="space-y-3">
              <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Conexão</p>
              <div>
                <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Rótulo</label>
                <input
                  value={(selectedEdge.label as string) ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setEdges(eds => eds.map(ed => ed.id === selectedEdge.id ? { ...ed, label: v } : ed));
                    setSelectedEdge(prev => prev ? { ...prev, label: v } : prev);
                  }}
                  className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                />
              </div>
              <div>
                <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Estilo</label>
                <select
                  value={(selectedEdge.type as string) ?? 'smoothstep'}
                  onChange={e => {
                    const v = e.target.value;
                    setEdges(eds => eds.map(ed => ed.id === selectedEdge.id ? { ...ed, type: v } : ed));
                    setSelectedEdge(prev => prev ? { ...prev, type: v } : prev);
                  }}
                  className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                >
                  <option value="smoothstep">Curvado (smoothstep)</option>
                  <option value="step">Ortogonal (step)</option>
                  <option value="straight">Reto</option>
                  <option value="default">Bezier</option>
                </select>
              </div>
              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir conexão
              </button>
            </div>
          )}
        </aside>
      </div>
      {/* unused state vars to keep ref instance bindable */}
      {rfInstance ? null : null}
    </div>
  );
}

export default function FluxogramaEditor({ id }: EditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner id={id} />
    </ReactFlowProvider>
  );
}
