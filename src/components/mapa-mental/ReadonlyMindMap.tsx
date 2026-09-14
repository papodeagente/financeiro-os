'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, Link2, Paperclip, StickyNote, X } from 'lucide-react';
import { MindNode, type MindNodeData } from './MindNode';
import { MindEdge } from './MindEdge';
import {
  colorForNode,
  getChildren,
  layoutMindMap,
  sanitizeMap,
  type LayoutNode,
  type MapaMentalData,
  type NodeSize,
  type Theme,
} from '@/lib/mapa-mental';

const nodeTypes: NodeTypes = { mindNode: MindNode };
const edgeTypes: EdgeTypes = { mind: MindEdge };
const noop = () => {};

export function ReadonlyMindMap({ mapa }: { mapa: MapaMentalData }) {
  return (
    <ReactFlowProvider>
      <ReadonlyMindMapInner mapa={mapa} />
    </ReactFlowProvider>
  );
}

function ReadonlyMindMapInner({ mapa }: { mapa: MapaMentalData }) {
  const { fitView } = useReactFlow();
  const [sizes, setSizes] = useState<Record<string, NodeSize>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sizesRef = useRef<Record<string, NodeSize>>({});
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clean = useMemo(() => sanitizeMap(mapa), [mapa]);
  const visibleData = useMemo(() => {
    if (Object.keys(collapsed).length === 0) return clean;
    const nodes = { ...clean.nodes };
    for (const [id, value] of Object.entries(collapsed)) {
      if (nodes[id]) nodes[id] = { ...nodes[id], collapsed: value };
    }
    return { ...clean, nodes };
  }, [clean, collapsed]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let next: Record<string, NodeSize> | null = null;
    for (const change of changes) {
      if (
        change.type !== 'dimensions'
        || !change.dimensions
        || change.dimensions.width <= 0
        || change.dimensions.height <= 0
      ) continue;
      const previous = sizesRef.current[change.id];
      if (
        previous
        && Math.abs(previous.width - change.dimensions.width) <= 0.5
        && Math.abs(previous.height - change.dimensions.height) <= 0.5
      ) continue;
      next ??= { ...sizesRef.current };
      next[change.id] = change.dimensions;
    }
    if (next) {
      sizesRef.current = next;
      setSizes(next);
    }
  }, []);

  const { nodes, edges } = useMemo(() => {
    const layout = layoutMindMap(visibleData, sizes);
    const index = new Map<string, LayoutNode>(layout.map(node => [node.id, node]));
    const theme = (visibleData.theme || 'minimal') as Theme;
    const colorOf = (node: LayoutNode): string => {
      if (node.color) return node.color;
      let current = node;
      while (current.parentId) {
        const parent = index.get(current.parentId);
        if (!parent) break;
        if (parent.color && parent.depth > 0) return parent.color;
        current = parent;
      }
      return colorForNode(node.depth, node.branchIndex, theme);
    };

    const flowNodes: Node[] = layout.map(node => {
      const childCount = getChildren(visibleData, node.id).length;
      const nodeData: MindNodeData = {
        text: node.text,
        depth: node.depth,
        color: colorOf(node),
        isRoot: node.id === visibleData.rootId,
        collapsed: !!node.collapsed,
        childCount,
        editing: false,
        side: node.side,
        icon: node.icon,
        hasNotes: !!node.notes?.trim(),
        readOnly: true,
        image: node.image,
        links: node.links,
        attachments: node.attachments,
        shape: node.style?.shape,
        bold: node.style?.bold,
        onCommitEdit: noop,
        onCancelEdit: noop,
        onStartEdit: noop,
        onAddChild: noop,
        onToggleCollapse: () => setCollapsed(current => ({
          ...current,
          [node.id]: !(current[node.id] ?? !!node.collapsed),
        })),
      };
      return {
        id: node.id,
        type: 'mindNode',
        position: { x: node.x, y: node.y },
        data: nodeData as unknown as Record<string, unknown>,
        selected: selectedId === node.id,
        draggable: false,
        deletable: false,
        selectable: true,
        focusable: true,
        ariaLabel: `Ver detalhes de ${node.text || 'tópico'}`,
        measured: sizes[node.id],
      };
    });

    const flowEdges: Edge[] = [];
    for (const node of layout) {
      if (!node.parentId || !visibleData.nodes[node.parentId]) continue;
      const sourceHandle = node.side === 'left' ? 'l' : 'r';
      const targetHandle = node.side === 'left' ? 'r' : 'l';
      flowEdges.push({
        id: `e-${node.parentId}-${node.id}`,
        source: node.parentId,
        target: node.id,
        sourceHandle,
        targetHandle,
        type: 'mind',
        data: { color: colorOf(node) },
      });
    }
    return { nodes: flowNodes, edges: flowEdges };
  }, [selectedId, sizes, visibleData]);

  const selectedNode = selectedId ? clean.nodes[selectedId] : null;

  const closeDetails = useCallback(() => {
    const nodeId = selectedId;
    setSelectedId(null);
    if (nodeId) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)?.focus();
      });
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && !clean.nodes[selectedId]) setSelectedId(null);
  }, [clean.nodes, selectedId]);

  useEffect(() => {
    if (!selectedNode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetails();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [closeDetails, selectedNode]);

  useEffect(() => {
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      void fitView({ padding: 0.16, duration: 250, minZoom: 0.01, maxZoom: 1.2 });
    }, 60);
    return () => {
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    };
  }, [fitView, nodes.length, sizes]);

  const safeLinks = selectedNode?.links
    ?.map(link => ({ ...link, url: safeResourceUrl(link.url) }))
    .filter((link): link is { label: string; url: string } => !!link.url) ?? [];
  const safeAttachments = selectedNode?.attachments
    ?.map(attachment => ({ ...attachment, url: safeResourceUrl(attachment.url) }))
    .filter((attachment): attachment is { name: string; url: string } => !!attachment.url) ?? [];

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onSelectionChange={({ nodes: selected }) => setSelectedId(selected[0]?.id ?? null)}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.01, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        deleteKeyCode={null}
        edgesFocusable={false}
        elementsSelectable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.01}
        maxZoom={3}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#dbe2ea" />
        <Controls
          showInteractive={false}
          position="bottom-left"
          className="!rounded-xl !border !border-slate-200 !bg-white !shadow-sm"
        />
      </ReactFlow>

      {selectedNode && (
        <aside
          aria-label={`Detalhes de ${selectedNode.text || 'tópico'}`}
          className="nodrag nopan nowheel absolute inset-x-3 bottom-3 z-20 max-h-[46%] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100%-2rem)] sm:w-80"
          onDoubleClick={event => event.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Detalhes do tópico</p>
              <h2 className="mt-1 break-words text-sm font-semibold text-slate-900">
                {selectedNode.text || 'Tópico sem título'}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeDetails}
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Fechar detalhes"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {selectedNode.notes?.trim() && (
            <section className="mt-4" aria-labelledby="readonly-node-notes">
              <h3 id="readonly-node-notes" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <StickyNote className="h-3.5 w-3.5 text-amber-500" /> Notas
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">
                {selectedNode.notes.trim()}
              </p>
            </section>
          )}

          {safeLinks.length > 0 && (
            <ResourceLinks
              title="Links"
              icon={<Link2 className="h-3.5 w-3.5 text-blue-500" />}
              items={safeLinks.map(link => ({ label: link.label || link.url, url: link.url }))}
            />
          )}

          {safeAttachments.length > 0 && (
            <ResourceLinks
              title="Anexos"
              icon={<Paperclip className="h-3.5 w-3.5 text-slate-500" />}
              items={safeAttachments.map(attachment => ({ label: attachment.name || 'Abrir anexo', url: attachment.url }))}
            />
          )}

          {!selectedNode.notes?.trim() && safeLinks.length === 0 && safeAttachments.length === 0 && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">Este tópico não possui notas, links ou anexos.</p>
          )}
        </aside>
      )}
    </div>
  );
}

function ResourceLinks({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: { label: string; url: string }[];
}) {
  return (
    <section className="mt-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        {icon} {title}
      </h3>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${item.url}-${index}`}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs font-medium text-blue-700 hover:border-blue-200 hover:bg-blue-50"
            >
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function safeResourceUrl(raw: string): string | null {
  if (!raw || /[\\\u0000-\u001F\u007F]/.test(raw)) return null;
  try {
    const base = 'https://app.entur.invalid';
    const parsed = new URL(raw, base);
    if (['mailto:', 'tel:'].includes(parsed.protocol)) return parsed.href;
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin === base
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.href;
  } catch {
    return null;
  }
}
