// Tipos e algoritmos para o editor de mapas mentais.
//
// Estrutura hierarquica simples: cada node tem parentId (null = raiz)
// + ordem (sibling order). O layout horizontal e gerado dinamicamente
// no client a partir dessa arvore.

export interface MindNode {
  id: string;
  text: string;
  parentId: string | null;       // null = raiz
  ordem: number;                 // ordem entre siblings (0-indexed)
  color?: string;                // override de cor (auto-atribuida por nivel)
  icon?: string;                 // emoji opcional
  notes?: string;                // texto rico em markdown (futuro)
  collapsed?: boolean;           // se true, filhos nao sao renderizados
}

export interface MapaMentalData {
  id: string;
  nome: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  theme?: 'classic' | 'rainbow' | 'mono';
  view?: { zoom?: number; x?: number; y?: number };
}

// ============================================================
// Geracao de novo mapa em branco
// ============================================================

export function createMindMap(nome: string = 'Sem título'): MapaMentalData {
  const id = newId();
  const rootId = newId();
  return {
    id,
    nome,
    rootId,
    nodes: {
      [rootId]: { id: rootId, text: 'Ideia central', parentId: null, ordem: 0 },
    },
    theme: 'rainbow',
    view: {},
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ============================================================
// Helpers de traversal (parent/children/depth)
// ============================================================

export function getChildren(data: MapaMentalData, parentId: string): MindNode[] {
  return Object.values(data.nodes)
    .filter(n => n.parentId === parentId)
    .sort((a, b) => a.ordem - b.ordem);
}

export function getDepth(data: MapaMentalData, nodeId: string): number {
  let d = 0;
  let cur = data.nodes[nodeId];
  while (cur && cur.parentId) {
    d += 1;
    cur = data.nodes[cur.parentId];
  }
  return d;
}

export function getDescendantIds(data: MapaMentalData, nodeId: string): string[] {
  const out: string[] = [];
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    const children = getChildren(data, cur);
    for (const c of children) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

// ============================================================
// Mutacoes (imutaveis — retornam novo MapaMentalData)
// ============================================================

export function addChild(data: MapaMentalData, parentId: string, text = ''): { data: MapaMentalData; newId: string } {
  const id = newId();
  const ordem = getChildren(data, parentId).length;
  const node: MindNode = { id, text, parentId, ordem };
  return {
    newId: id,
    data: { ...data, nodes: { ...data.nodes, [id]: node } },
  };
}

export function addSibling(data: MapaMentalData, refId: string, text = ''): { data: MapaMentalData; newId: string } | null {
  const ref = data.nodes[refId];
  if (!ref || ref.parentId === null) return null; // root nao tem sibling
  const siblings = getChildren(data, ref.parentId);
  const insertIdx = siblings.findIndex(s => s.id === refId);
  const id = newId();
  const node: MindNode = { id, text, parentId: ref.parentId, ordem: insertIdx + 1 };
  // Shift ordem dos siblings posteriores
  const updated: Record<string, MindNode> = { ...data.nodes };
  siblings.forEach((s, i) => {
    if (i > insertIdx) updated[s.id] = { ...s, ordem: s.ordem + 1 };
  });
  updated[id] = node;
  return {
    newId: id,
    data: { ...data, nodes: updated },
  };
}

export function updateNode(data: MapaMentalData, id: string, patch: Partial<MindNode>): MapaMentalData {
  const node = data.nodes[id];
  if (!node) return data;
  return {
    ...data,
    nodes: { ...data.nodes, [id]: { ...node, ...patch } },
  };
}

export function removeNode(data: MapaMentalData, id: string): MapaMentalData {
  if (id === data.rootId) return data; // nao remove a raiz
  const descs = getDescendantIds(data, id);
  const toRemove = new Set([id, ...descs]);
  const next: Record<string, MindNode> = {};
  for (const [k, v] of Object.entries(data.nodes)) {
    if (!toRemove.has(k)) next[k] = v;
  }
  return { ...data, nodes: next };
}

// ============================================================
// Layout — algoritmo horizontal tipo MindMeister
// Posiciona nodes em x/y a partir da arvore: raiz centralizada
// verticalmente, filhos a direita com offsets verticais calculados
// pra evitar sobreposicao. Considera sub-arvore como bloco compacto.
// ============================================================

export interface LayoutNode extends MindNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 44;
const H_GAP = 80;      // espaco horizontal entre niveis
const V_GAP = 12;      // espaco vertical entre siblings

interface SubtreeMetrics {
  height: number;
}

function measureSubtree(
  data: MapaMentalData,
  nodeId: string,
): SubtreeMetrics {
  const node = data.nodes[nodeId];
  if (!node) return { height: NODE_HEIGHT };

  const children = node.collapsed ? [] : getChildren(data, nodeId);
  if (children.length === 0) return { height: NODE_HEIGHT };

  let total = 0;
  for (const c of children) {
    total += measureSubtree(data, c.id).height;
  }
  total += (children.length - 1) * V_GAP;
  return { height: Math.max(NODE_HEIGHT, total) };
}

function placeSubtree(
  data: MapaMentalData,
  nodeId: string,
  x: number,
  centerY: number,
  depth: number,
  out: LayoutNode[],
): void {
  const node = data.nodes[nodeId];
  if (!node) return;

  const subHeight = measureSubtree(data, nodeId).height;
  const y = centerY - NODE_HEIGHT / 2;

  out.push({
    ...node,
    x,
    y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    depth,
  });

  if (node.collapsed) return;

  const children = getChildren(data, nodeId);
  if (children.length === 0) return;

  // Distribui filhos verticalmente preservando centro alinhado
  const childX = x + NODE_WIDTH + H_GAP;
  // Calcula altura total dos filhos
  const heights = children.map(c => measureSubtree(data, c.id).height);
  const totalChildren = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * V_GAP;
  let cursor = centerY - totalChildren / 2;
  for (let i = 0; i < children.length; i++) {
    const ch = heights[i];
    const childCenterY = cursor + ch / 2;
    placeSubtree(data, children[i].id, childX, childCenterY, depth + 1, out);
    cursor += ch + V_GAP;
  }
  // unused
  void subHeight;
}

export function layoutMindMap(data: MapaMentalData): LayoutNode[] {
  const out: LayoutNode[] = [];
  placeSubtree(data, data.rootId, 80, 400, 0, out);
  return out;
}

// ============================================================
// Paleta — cor por nivel de profundidade (theme rainbow)
// ============================================================

const RAINBOW_COLORS = [
  '#0a84ff', // root (azul Apple)
  '#10b981', // nivel 1 (emerald)
  '#f59e0b', // nivel 2 (amber)
  '#ec4899', // nivel 3 (rose)
  '#8b5cf6', // nivel 4 (violet)
  '#06b6d4', // nivel 5 (cyan)
  '#84cc16', // nivel 6 (lime)
];

export function colorForDepth(depth: number, theme: 'classic' | 'rainbow' | 'mono' = 'rainbow'): string {
  if (theme === 'mono') return '#475569';
  if (theme === 'classic') {
    return depth === 0 ? '#0f172a' : '#475569';
  }
  return RAINBOW_COLORS[depth % RAINBOW_COLORS.length];
}
