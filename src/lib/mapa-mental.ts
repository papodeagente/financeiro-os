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
  theme?: 'classic' | 'rainbow' | 'mono' | 'ocean' | 'sunset' | 'forest';
  layout?: 'map' | 'logical' | 'right';  // map=balanced L/R, logical=tree right, right=alias
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
  side: 'left' | 'right';   // de que lado da raiz o nó está
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 44;
const H_GAP = 90;      // espaco horizontal entre niveis
const V_GAP = 14;      // espaco vertical entre siblings

function measureSubtree(data: MapaMentalData, nodeId: string): number {
  const node = data.nodes[nodeId];
  if (!node) return NODE_HEIGHT;
  const children = node.collapsed ? [] : getChildren(data, nodeId);
  if (children.length === 0) return NODE_HEIGHT;
  let total = 0;
  for (const c of children) total += measureSubtree(data, c.id);
  total += (children.length - 1) * V_GAP;
  return Math.max(NODE_HEIGHT, total);
}

// Coloca uma subarvore num lado especifico (right=descendo a direita,
// left=descendo a esquerda). x recebido eh a borda da raiz na direcao
// de crescimento (ex: lado direito da raiz pra side=right).
function placeSubtree(
  data: MapaMentalData,
  nodeId: string,
  anchorX: number,           // borda da raiz/parent na direcao de crescimento
  centerY: number,
  depth: number,
  side: 'left' | 'right',
  out: LayoutNode[],
): void {
  const node = data.nodes[nodeId];
  if (!node) return;

  const x = side === 'right' ? anchorX + H_GAP : anchorX - H_GAP - NODE_WIDTH;
  const y = centerY - NODE_HEIGHT / 2;

  out.push({
    ...node,
    x, y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    depth,
    side,
  });

  if (node.collapsed) return;
  const children = getChildren(data, nodeId);
  if (children.length === 0) return;

  const childAnchorX = side === 'right' ? x + NODE_WIDTH : x;
  const heights = children.map(c => measureSubtree(data, c.id));
  const totalH = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * V_GAP;
  let cursor = centerY - totalH / 2;
  for (let i = 0; i < children.length; i++) {
    const ch = heights[i];
    placeSubtree(data, children[i].id, childAnchorX, cursor + ch / 2, depth + 1, side, out);
    cursor += ch + V_GAP;
  }
}

export function layoutMindMap(data: MapaMentalData): LayoutNode[] {
  const out: LayoutNode[] = [];
  const root = data.nodes[data.rootId];
  if (!root) return out;

  const ROOT_W = 220;          // raiz é um pouco mais larga
  const centerY = 400;
  const rootX = 0;
  const layoutMode = data.layout || 'map';

  out.push({
    ...root,
    x: rootX,
    y: centerY - NODE_HEIGHT / 2,
    width: ROOT_W,
    height: NODE_HEIGHT,
    depth: 0,
    side: 'right',
  });

  if (root.collapsed) return out;
  const children = getChildren(data, data.rootId);
  if (children.length === 0) return out;

  if (layoutMode === 'logical' || layoutMode === 'right') {
    // Tudo cresce pra direita
    const heights = children.map(c => measureSubtree(data, c.id));
    const totalH = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * V_GAP;
    let cursor = centerY - totalH / 2;
    const anchor = rootX + ROOT_W;
    for (let i = 0; i < children.length; i++) {
      placeSubtree(data, children[i].id, anchor, cursor + heights[i] / 2, 1, 'right', out);
      cursor += heights[i] + V_GAP;
    }
    return out;
  }

  // layout='map' — balanceia filhos da raiz entre esquerda/direita
  // alternando por ordem (par→direita, ímpar→esquerda) pra equilibrar.
  const rightKids: MindNode[] = [];
  const leftKids: MindNode[] = [];
  children.forEach((c, i) => { (i % 2 === 0 ? rightKids : leftKids).push(c); });

  // Lado direito
  const rH = rightKids.map(c => measureSubtree(data, c.id));
  const rTotal = rH.reduce((s, h) => s + h, 0) + Math.max(0, rightKids.length - 1) * V_GAP;
  let cR = centerY - rTotal / 2;
  for (let i = 0; i < rightKids.length; i++) {
    placeSubtree(data, rightKids[i].id, rootX + ROOT_W, cR + rH[i] / 2, 1, 'right', out);
    cR += rH[i] + V_GAP;
  }

  // Lado esquerdo
  const lH = leftKids.map(c => measureSubtree(data, c.id));
  const lTotal = lH.reduce((s, h) => s + h, 0) + Math.max(0, leftKids.length - 1) * V_GAP;
  let cL = centerY - lTotal / 2;
  for (let i = 0; i < leftKids.length; i++) {
    placeSubtree(data, leftKids[i].id, rootX, cL + lH[i] / 2, 1, 'left', out);
    cL += lH[i] + V_GAP;
  }

  return out;
}

// ============================================================
// Paleta — cor por nivel de profundidade (theme rainbow)
// ============================================================

// Paletas estilo XMind — pensadas pra contraste em ramo, não rainbow caótico.
const PALETTES: Record<string, string[]> = {
  rainbow: ['#0a84ff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'],
  ocean:   ['#0369a1', '#0891b2', '#0d9488', '#0e7490', '#1e40af', '#155e75', '#164e63'],
  sunset:  ['#db2777', '#ea580c', '#d97706', '#dc2626', '#be185d', '#c2410c', '#9f1239'],
  forest:  ['#15803d', '#65a30d', '#16a34a', '#047857', '#166534', '#3f6212', '#365314'],
  mono:    ['#1e293b', '#334155', '#475569', '#64748b', '#475569', '#334155', '#1e293b'],
  classic: ['#0f172a', '#334155', '#475569', '#64748b', '#475569', '#334155', '#0f172a'],
};

export type Theme = 'classic' | 'rainbow' | 'mono' | 'ocean' | 'sunset' | 'forest';

export const THEMES: { id: Theme; label: string; preview: string[] }[] = [
  { id: 'rainbow', label: 'Arco-íris', preview: ['#0a84ff', '#10b981', '#f59e0b', '#ec4899'] },
  { id: 'ocean',   label: 'Oceano',    preview: ['#0369a1', '#0891b2', '#0d9488', '#0e7490'] },
  { id: 'sunset',  label: 'Pôr do sol', preview: ['#db2777', '#ea580c', '#d97706', '#dc2626'] },
  { id: 'forest',  label: 'Floresta',  preview: ['#15803d', '#65a30d', '#16a34a', '#047857'] },
  { id: 'mono',    label: 'Mono',      preview: ['#1e293b', '#475569', '#64748b'] },
];

export function colorForDepth(depth: number, theme: Theme = 'rainbow'): string {
  const palette = PALETTES[theme] || PALETTES.rainbow;
  return palette[depth % palette.length];
}

// Paleta de seleção rápida pra override de cor de um nó (painel direito).
export const NODE_COLORS = [
  '#0a84ff', '#10b981', '#f59e0b', '#ec4899',
  '#8b5cf6', '#06b6d4', '#ef4444', '#475569',
];
