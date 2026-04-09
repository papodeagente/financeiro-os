'use client';

/**
 * Editor visual do funil (3-zonas: biblioteca / canvas / painel direito)
 * reutilizando todo o padrão do /planejamento/fluxogramas. ReactFlow com
 * Background.Dots, smoothstep edges, drag-from-palette.
 *
 * Simulação live: cada mudança re-roda o motor no client para refletir KPIs
 * em tempo real. Botão "Simular" persiste no backend e dispara o cálculo
 * oficial (que grava em funis_simulacoes).
 *
 * Auto-save: PUT /api/funis/[id] a cada 3s de inatividade.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Controls, MiniMap, MarkerType, ConnectionMode,
  addEdge, applyNodeChanges, applyEdgeChanges,
  useReactFlow,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Check, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { generateId } from '@/lib/utils';
import { simularFunil, cenariosPadrao } from '@/lib/funil-engine';
import type {
  FunilPayload, NodeFunil, EdgeFunil, TipoNode, CategoriaNode,
  DadosReaisAgencia, KPIsFunil, CenarioComparativo,
} from '@/lib/funil-types';
import { FunilNode } from '@/components/funis/FunilNode';
import { BibliotecaNodes } from '@/components/funis/BibliotecaNodes';
import { PainelConfigNode } from '@/components/funis/PainelConfigNode';
import { PainelKPIs } from '@/components/funis/PainelKPIs';
import { ModalComparacao } from '@/components/funis/ModalComparacao';
import { categoriaDoTipo, CATEGORIA_INFO } from '@/components/funis/categorias';

type FunilNodeData = {
  tipo: TipoNode;
  categoria: CategoriaNode;
  label: string;
  config: NodeFunil['data']['config'];
  resultado?: NodeFunil['data']['resultado'];
};

const nodeTypes: NodeTypes = { funilNode: FunilNode };

function nodeFunilToRf(n: NodeFunil): Node<FunilNodeData> {
  return {
    id: n.id,
    type: 'funilNode',
    position: n.position,
    data: n.data,
  };
}

function rfToNodeFunil(n: Node<FunilNodeData>): NodeFunil {
  return {
    id: n.id,
    type: 'funilNode',
    position: n.position,
    data: n.data,
  };
}

function edgeFunilToRf(e: EdgeFunil): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
    style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '8 4' },
    data: { taxa_conversao_override: e.taxa_conversao_override ?? null },
  };
}

function rfToEdgeFunil(e: Edge): EdgeFunil {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    taxa_conversao_override: ((e.data as { taxa_conversao_override?: number | null } | undefined)?.taxa_conversao_override) ?? null,
  };
}

function EditorInner({ id }: { id: string }) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<FunilPayload | null>(null);
  const [nodes, setNodes] = useState<Node<FunilNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node<FunilNodeData> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [kpis, setKpis] = useState<KPIsFunil | null>(null);
  const [cenarios, setCenarios] = useState<CenarioComparativo[]>(cenariosPadrao());
  const [cenarioAtivo, setCenarioAtivo] = useState<CenarioComparativo['id']>('baseline');
  const [dadosReais, setDadosReais] = useState<DadosReaisAgencia | null>(null);
  const [usarDadosReais, setUsarDadosReais] = useState(false);
  const [modalComparacao, setModalComparacao] = useState(false);

  // Load funil + dados reais
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/funis/${id}`).then(r => r.ok ? r.json() : null),
      fetch('/api/funis/dados-reais').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([funil, dados]) => {
      if (cancelled) return;
      if (!funil || funil.error) {
        setError('Funil não encontrado.');
        setLoading(false);
        return;
      }
      const payload = funil as FunilPayload;
      setMeta(payload);
      setNodes((payload.data.nodes ?? []).map(nodeFunilToRf));
      setEdges((payload.data.edges ?? []).map(edgeFunilToRf));
      setCenarios(payload.data.cenarios?.length ? payload.data.cenarios : cenariosPadrao());
      setUsarDadosReais(payload.data.config?.usar_dados_reais ?? false);
      if (dados && !dados.error) setDadosReais(dados);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError('Falha ao carregar funil.');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  // Live simulation: roda o motor no client a cada mudança relevante
  useEffect(() => {
    if (nodes.length === 0) { setKpis(null); return; }
    const cenario = cenarios.find(c => c.id === cenarioAtivo);
    const result = simularFunil(
      nodes.map(rfToNodeFunil),
      edges.map(rfToEdgeFunil),
      cenario,
      dadosReais ?? undefined,
      usarDadosReais,
    );
    // Atualiza apenas resultado nos nodes atuais (não recria as posições)
    setNodes(prev => prev.map(n => {
      const updated = result.nodes.find(x => x.id === n.id);
      return updated ? { ...n, data: { ...n.data, resultado: updated.data.resultado } } : n;
    }));
    setKpis(result.kpis);
    // Intencionalmente omite `nodes` e `edges` para evitar loop:
    // a função já produz nodes atualizados e só o nodes.length
    // / config / cenário disparam re-cálculo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length, cenarioAtivo, usarDadosReais, dadosReais, cenarios]);

  // Auto-save debounce 3s
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(); }, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const payload: FunilPayload = {
        ...meta,
        data: {
          ...meta.data,
          nodes: nodes.map(rfToNodeFunil),
          edges: edges.map(rfToEdgeFunil),
          cenarios,
          config: { ...meta.data.config, usar_dados_reais: usarDadosReais },
        },
        updated_at: new Date().toISOString(),
      };
      await fetch(`/api/funis/${meta.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }, [meta, nodes, edges, cenarios, usarDadosReais]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds) as Node<FunilNodeData>[]);
    scheduleSave();
  }, [scheduleSave]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(eds => applyEdgeChanges(changes, eds));
    scheduleSave();
  }, [scheduleSave]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({
      ...connection,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '8 4' },
      data: { taxa_conversao_override: null },
    }, eds));
    scheduleSave();
  }, [scheduleSave]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const tipo = e.dataTransfer.getData('application/funil-tipo') as TipoNode;
    if (!tipo) return;
    const categoria = categoriaDoTipo(tipo);
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const info = CATEGORIA_INFO[categoria];
    const tipoInfo = info.tipos.find(t => t.tipo === tipo);
    const novoNode: Node<FunilNodeData> = {
      id: generateId(),
      type: 'funilNode',
      position,
      data: {
        tipo,
        categoria,
        label: tipoInfo?.label ?? tipo,
        config: defaultConfigParaCategoria(categoria),
      },
    };
    setNodes(nds => [...nds, novoNode]);
    scheduleSave();
  }, [screenToFlowPosition, scheduleSave]);

  const onDragStartPalette = useCallback((e: React.DragEvent, tipo: TipoNode) => {
    e.dataTransfer.setData('application/funil-tipo', tipo);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onSelectionChange = useCallback(({ nodes: ns }: { nodes: Node[] }) => {
    setSelectedNode((ns[0] as Node<FunilNodeData> | undefined) ?? null);
  }, []);

  const updateSelectedNodeData = useCallback((patch: Partial<FunilNodeData>) => {
    if (!selectedNode) return;
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n,
    ));
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...patch } } : prev);
    scheduleSave();
  }, [selectedNode, scheduleSave]);

  const deleteSelected = useCallback(() => {
    if (!selectedNode) return;
    const id = selectedNode.id;
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
    scheduleSave();
  }, [selectedNode, scheduleSave]);

  const simularServer = useCallback(async () => {
    if (!meta) return;
    setSimulando(true);
    await save(); // garante estado persistido
    try {
      const res = await fetch(`/api/funis/${meta.id}/simular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cenario_id: cenarioAtivo }),
      });
      if (res.ok) {
        const data = await res.json();
        setKpis(data.kpis);
        if (Array.isArray(data.nodes)) {
          setNodes(prev => prev.map(n => {
            const updated = (data.nodes as NodeFunil[]).find(x => x.id === n.id);
            return updated ? { ...n, data: { ...n.data, resultado: updated.data.resultado } } : n;
          }));
        }
      }
    } finally {
      setSimulando(false);
    }
  }, [meta, cenarioAtivo, save]);

  const exportarPDF = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const elemento = document.querySelector('.react-flow') as HTMLElement | null;
      if (!elemento) return;
      html2pdf().from(elemento).set({
        margin: 10,
        filename: `${meta?.nome ?? 'funil'}.pdf`,
        jsPDF: { orientation: 'landscape' },
      }).save();
    } catch {
      // silently
    }
  }, [meta]);

  const savedLabel = useMemo(() => {
    if (saving) return 'Salvando...';
    if (savedAt) return `Salvo ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    return 'Não salvo';
  }, [saving, savedAt]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[var(--t-bg)] text-[var(--t-text-muted)]">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando funil...
    </div>
  );

  if (error || !meta) return (
    <div className="h-screen bg-[var(--t-bg)] p-6">
      <button
        onClick={() => router.push('/planejamento/funis')}
        className="flex items-center gap-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <p className="mt-6 text-red-500">{error}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-[var(--t-bg)]">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[var(--t-border)] bg-[var(--t-surface)] shrink-0">
        <button
          onClick={() => router.push('/planejamento/funis')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)] text-[var(--text-body-sm)] font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> <span>Voltar</span>
        </button>
        <span className="h-5 w-px bg-[var(--t-border)]" />
        <input
          value={meta.nome}
          onChange={e => { setMeta({ ...meta, nome: e.target.value }); scheduleSave(); }}
          placeholder="Nome do funil"
          className="flex-1 max-w-[360px] px-2 py-1 text-[var(--text-body)] font-medium text-[var(--t-text)] bg-transparent focus:bg-[var(--t-input-bg)] rounded outline-none"
        />

        <label className="flex items-center gap-1.5 text-[var(--text-caption)] text-[var(--t-text-muted)] ml-auto">
          <input
            type="checkbox"
            checked={usarDadosReais}
            onChange={e => { setUsarDadosReais(e.target.checked); scheduleSave(); }}
            className="accent-[var(--t-green)]"
          />
          <Sparkles className="w-3 h-3 text-[var(--t-green)]" />
          Usar dados reais
        </label>

        <select
          value={cenarioAtivo}
          onChange={e => setCenarioAtivo(e.target.value as CenarioComparativo['id'])}
          className="px-2 py-1 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] bg-[var(--t-input-bg)] rounded shadow-[var(--t-card-shadow)]"
        >
          {cenarios.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] flex items-center gap-1 min-w-[110px] justify-end">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : savedAt ? <Check className="w-3 h-3 text-[var(--t-green)]" /> : null}
          {savedLabel}
        </span>
      </header>

      {/* 3 zonas */}
      <div className="flex flex-1 min-h-0">
        <BibliotecaNodes onDragStart={onDragStartPalette} />

        <div ref={wrapperRef} className="flex-1 relative bg-[#f8fafc] min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Strict}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            snapToGrid
            snapGrid={[12, 12]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
              style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '8 4' },
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d1d5db" />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(0,0,0,0.04)" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center px-6 py-4 rounded-xl bg-[var(--t-surface)]/80 border border-dashed border-[var(--t-border)]">
                <p className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">
                  Arraste blocos da biblioteca para desenhar seu funil.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Painel direito */}
        <aside className="w-[320px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto p-4">
          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Inspetor</p>
          {!selectedNode ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Como começar</p>
                <ol className="text-[11px] text-[var(--t-text-muted)] space-y-1 list-decimal list-inside">
                  <li>Arraste blocos da biblioteca à esquerda</li>
                  <li>Conecte os blocos nas setas</li>
                  <li>Clique em &quot;Simular&quot; para ver os KPIs</li>
                </ol>
              </div>

              {dadosReais && (
                <div className="pt-3 border-t border-[var(--t-border)] space-y-2">
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider">Dados reais da agência</p>
                  <DadoReal label="Ticket médio" value={dadosReais.ticket_medio > 0 ? `R$ ${dadosReais.ticket_medio.toFixed(0)}` : '—'} />
                  <DadoReal label="Taxa proposta" value={dadosReais.taxa_proposta_aceita > 0 ? `${dadosReais.taxa_proposta_aceita.toFixed(1)}%` : '—'} />
                  <DadoReal label="CAC médio" value={dadosReais.cac_medio > 0 ? `R$ ${dadosReais.cac_medio.toFixed(0)}` : '—'} />
                  <DadoReal label="Margem mínima" value={dadosReais.margem_minima > 0 ? `${dadosReais.margem_minima.toFixed(1)}%` : '—'} />
                </div>
              )}
            </div>
          ) : (
            <>
              <PainelConfigNode
                node={selectedNode}
                onChange={updateSelectedNodeData}
                dadosReais={dadosReais}
                usarDadosReais={usarDadosReais}
              />
              <button
                onClick={deleteSelected}
                className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[var(--text-body-sm)] font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir elemento
              </button>
            </>
          )}
        </aside>
      </div>

      <PainelKPIs
        kpis={kpis}
        loading={simulando}
        onSimular={simularServer}
        onComparar={() => setModalComparacao(true)}
        onExportar={exportarPDF}
      />

      {modalComparacao && (
        <ModalComparacao
          nodes={nodes.map(rfToNodeFunil)}
          edges={edges.map(rfToEdgeFunil)}
          cenariosIniciais={cenarios}
          dadosReais={dadosReais}
          usarDadosReais={usarDadosReais}
          onClose={() => setModalComparacao(false)}
          onSalvar={(novos) => { setCenarios(novos); scheduleSave(); }}
        />
      )}
    </div>
  );
}

function DadoReal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[var(--t-text-muted)]">{label}</span>
      <span className="font-medium text-[var(--t-text)]">{value}</span>
    </div>
  );
}

function defaultConfigParaCategoria(categoria: CategoriaNode): NodeFunil['data']['config'] {
  switch (categoria) {
    case 'trafego':     return { visitantes: 5000, investimento: 1000, taxa_conversao: 100 };
    case 'captura':     return { taxa_conversao: 15 };
    case 'nutricao':    return { taxa_conversao: 30, taxa_resposta: 50, taxa_abertura: 40 };
    case 'qualificacao':return { taxa_conversao: 50 };
    case 'proposta':    return { taxa_conversao: 35 };
    case 'fechamento':  return { taxa_conversao: 70, valor_produto: 3000, margem_liquida: 35 };
    case 'upsell':      return { taxa_conversao: 20, valor_produto: 500, margem_liquida: 50 };
    case 'saida':       return { taxa_conversao: 100 };
  }
}

export function FunilEditor({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <EditorInner id={id} />
    </ReactFlowProvider>
  );
}
