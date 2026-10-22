// Tipos e algoritmos para o editor de mapas mentais.
//
// Estrutura hierarquica simples: cada node tem parentId (null = raiz)
// + ordem (sibling order). O layout horizontal e gerado dinamicamente
// no client a partir dessa arvore, usando as dimensoes REAIS de cada
// nó (medidas pelo React Flow) — nunca um tamanho fixo estimado.

export interface MindNode {
  id: string;
  text: string;
  parentId: string | null;       // null = raiz
  ordem: number;                 // ordem entre siblings (0-indexed)
  side?: 'left' | 'right';       // só p/ filhos diretos da raiz (layout map); fixo após criado
  color?: string;                // override de cor (auto-atribuida por ramo)
  icon?: string;                 // emoji opcional
  notes?: string;                // texto rico em markdown (futuro)
  collapsed?: boolean;           // se true, filhos nao sao renderizados
  // Fase 2 — dados ricos
  image?: { url: string; alt?: string };
  links?: { label: string; url: string }[];
  attachments?: { name: string; url: string }[];
  style?: {
    shape?: 'rounded' | 'pill' | 'rect';  // undefined = texto puro (filhos)
    bold?: boolean;
  };
}

export type MapaLayout =
  | 'map' | 'logical' | 'right' | 'org' | 'org-right'
  | 'radial' | 'timeline' | 'fishbone' | 'matrix';

/** Os dois organogramas: conector em cotovelo, nó em caixa. */
export function ehOrganograma(layout: MapaLayout | undefined): boolean {
  return layout === 'org' || layout === 'org-right';
}

/**
 * Para onde a ligação sai do nó.
 *  horizontal  pelos lados (mapa, árvore, organograma deitado)
 *  vertical    por cima e por baixo (organograma, matriz)
 *  livre       pelo lado que encara o pai, decidido ligação a ligação
 *              (radial, linha do tempo, espinha de peixe)
 */
export function direcaoDoLayout(layout: MapaLayout | undefined): 'vertical' | 'horizontal' | 'livre' {
  if (layout === 'org' || layout === 'matrix') return 'vertical';
  if (layout === 'radial' || layout === 'timeline' || layout === 'fishbone') return 'livre';
  return 'horizontal';
}

/** Em que eixo os irmãos se espalham: decide se "antes/depois" ao soltar é
 *  pela horizontal ou pela vertical. */
export function eixoDeIrmaos(layout: MapaLayout | undefined): 'x' | 'y' {
  return layout === 'org' || layout === 'timeline' || layout === 'fishbone' || layout === 'radial' ? 'x' : 'y';
}

/**
 * Como a ligação é desenhada. É isto, mais do que a geometria, que faz cada
 * layout parecer o que é: cotovelo diz hierarquia, reta diz causa, curva
 * diz associação.
 */
export function estiloDaLigacao(layout: MapaLayout | undefined): 'curva' | 'cotovelo' | 'espinha' {
  if (layout === 'fishbone') return 'espinha';
  if (layout === 'org' || layout === 'org-right' || layout === 'matrix' || layout === 'timeline') return 'cotovelo';
  return 'curva';
}

/** O suficiente de um nó desenhado para decidir de que lado liga. */
export interface CaixaDoNo { x: number; y: number; width: number; height: number; depth?: number }

/**
 * Geometria de uma costela da espinha de peixe, nas coordenadas do mapa.
 * A família e as causas dela carregam a mesma costela; o MindEdge desenha
 * a espinha dorsal, a costela e as linhas deitadas das causas a partir dela.
 */
export interface Costela {
  encaixeX: number; encaixeY: number;  // onde a costela toca a espinha dorsal
  pontaX: number; pontaY: number;      // onde ela toca o rótulo da família
  caudaX: number;                      // onde a espinha dorsal termina, à esquerda
}

/**
 * Por que handles uma ligação sai do pai e entra no filho.
 *
 * Uma função só, usada pelo editor e pelo viewer público: a lógica vivia
 * duplicada nos dois, e duplicada é como um deles fica para trás.
 *
 * Ids: as saídas são 'ls' 'rs' 'ts' 'bs' e as entradas 'l' 'r' 't' 'b' — um
 * par por lado em TODO nó, para qualquer layout poder ligar por qualquer
 * lado. Nos layouts livres o lado é o que encara o pai, medido pelas caixas.
 */
export function handlesDaLigacao(
  layout: MapaLayout | undefined,
  side: 'left' | 'right',
  pai?: CaixaDoNo,
  filho?: CaixaDoNo,
): { sourceHandle: 'ls' | 'rs' | 'ts' | 'bs'; targetHandle: 'l' | 'r' | 't' | 'b' } {
  const direcao = direcaoDoLayout(layout);
  if (direcao === 'vertical') return { sourceHandle: 'bs', targetHandle: 't' };
  if (layout === 'timeline' && pai && filho) {
    // O EIXO É FEITO DAS PRÓPRIAS LIGAÇÕES. Do título para cada evento a
    // ligação sai pela direita e entra por baixo (evento acima do eixo) ou
    // por cima (abaixo): o cotovelo corre na horizontal pela altura do
    // título e sobe no x do evento — e como todos os trechos horizontais
    // ficam na mesma altura, eles se somam num eixo só. Sair pela direita
    // e entrar pela ESQUERDA, como a regra livre faria, cruzava os cinco
    // cotovelos uns sobre os outros.
    const dx = (filho.x + filho.width / 2) - (pai.x + pai.width / 2);
    const dy = (filho.y + filho.height / 2) - (pai.y + pai.height / 2);
    if (Math.abs(dx) > Math.abs(dy)) return dy < 0 ? { sourceHandle: 'rs', targetHandle: 'b' } : { sourceHandle: 'rs', targetHandle: 't' };
    // Dentro de um evento as coisas empilham para longe do eixo: ligação em pé.
    return dy < 0 ? { sourceHandle: 'ts', targetHandle: 'b' } : { sourceHandle: 'bs', targetHandle: 't' };
  }
  if (layout === 'fishbone' && pai && filho && filho.depth !== undefined) {
    // A costela sai da espinha dorsal (não do rótulo do efeito) e toca o
    // rótulo da família por baixo ou por cima; a causa encosta na costela por
    // uma linha deitada que sai da direita dela. Quem desenha é o MindEdge;
    // aqui só se escolhe em que ponto de cada caixa a linha toca.
    if (filho.depth === 1) {
      const acima = (filho.y + filho.height / 2) < (pai.y + pai.height / 2);
      return { sourceHandle: 'ls', targetHandle: acima ? 'b' : 't' };
    }
    if (filho.depth === 2) return { sourceHandle: 'bs', targetHandle: 'r' };
  }
  if (direcao === 'livre' && pai && filho) {
    const dx = (filho.x + filho.width / 2) - (pai.x + pai.width / 2);
    const dy = (filho.y + filho.height / 2) - (pai.y + pai.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? { sourceHandle: 'rs', targetHandle: 'l' } : { sourceHandle: 'ls', targetHandle: 'r' };
    }
    return dy >= 0 ? { sourceHandle: 'bs', targetHandle: 't' } : { sourceHandle: 'ts', targetHandle: 'b' };
  }
  return side === 'left'
    ? { sourceHandle: 'ls', targetHandle: 'r' }
    : { sourceHandle: 'rs', targetHandle: 'l' };
}

export interface MapaMentalData {
  id: string;
  nome: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  theme?: Theme;
  /**
   * map       ramos dos dois lados da raiz (mapa mental clássico)
   * logical   tudo cresce para a direita, em árvore
   * right     apelido legado de logical
   * org       organograma: raiz no topo, filhos em fileiras abaixo
   * org-right organograma deitado: raiz à esquerda, cresce para o lado
   *
   * Os dois organogramas usam conector em cotovelo e nó em caixa — é isso
   * que faz um org chart parecer org chart, não só a direção.
   */
  layout?: MapaLayout;
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
    theme: 'minimal',
    layout: 'map',
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

export function isDescendantOf(data: MapaMentalData, nodeId: string, ancestorId: string): boolean {
  let cur = data.nodes[nodeId];
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = data.nodes[cur.parentId];
  }
  return false;
}

// Ramo (filho direto da raiz) do qual o nó descende. A propria raiz e
// filhos orfaos retornam null.
export function getBranchRootId(data: MapaMentalData, nodeId: string): string | null {
  let cur = data.nodes[nodeId];
  if (!cur || cur.parentId === null) return null;
  while (cur.parentId !== data.rootId) {
    const parent = data.nodes[cur.parentId!];
    if (!parent) return null;
    cur = parent;
    if (cur.parentId === null) return null;
  }
  return cur.id;
}

// ============================================================
// Sanitizacao — conserta dados legados/corrompidos no load.
// Orfaos viram filhos da raiz; ordens sao normalizadas 0..n-1;
// lados dos ramos sao materializados (fixos) no layout 'map'.
// ============================================================

export function sanitizeMap(data: MapaMentalData): MapaMentalData {
  const nodes: Record<string, MindNode> = { ...data.nodes };
  let changed = false;

  // 1. raiz precisa existir e ter parentId null
  const root = nodes[data.rootId];
  if (root && root.parentId !== null) {
    nodes[data.rootId] = { ...root, parentId: null };
    changed = true;
  }

  // Órfão adotado entra no FIM da lista de filhos da raiz — nunca no
  // meio (senão embaralha ordem, lado e cor dos ramos existentes).
  let adoptOrdem = Object.values(nodes)
    .filter(n => n.parentId === data.rootId)
    .reduce((m, n) => Math.max(m, n.ordem), -1) + 1;

  // 2. orfaos (parentId que nao existe) e auto-referencias → viram filhos da raiz
  for (const n of Object.values(nodes)) {
    if (n.id === data.rootId) continue;
    if (!n.parentId || !nodes[n.parentId] || n.parentId === n.id) {
      nodes[n.id] = { ...n, parentId: data.rootId, ordem: adoptOrdem++ };
      changed = true;
    }
  }

  // 3. quebra ciclos (nó cujo caminho até a raiz nunca chega nela)
  for (const n of Object.values(nodes)) {
    if (n.id === data.rootId) continue;
    const seen = new Set<string>([n.id]);
    let cur = nodes[n.id];
    let reachesRoot = false;
    while (cur && cur.parentId) {
      if (cur.parentId === data.rootId) { reachesRoot = true; break; }
      if (seen.has(cur.parentId)) break;
      seen.add(cur.parentId);
      cur = nodes[cur.parentId];
    }
    if (!reachesRoot) {
      nodes[n.id] = { ...nodes[n.id], parentId: data.rootId, ordem: adoptOrdem++ };
      changed = true;
    }
  }

  const result: MapaMentalData = changed ? { ...data, nodes } : data;

  // 4. normaliza ordem 0..n-1 por grupo de siblings
  const byParent = new Map<string, MindNode[]>();
  for (const n of Object.values(result.nodes)) {
    if (n.parentId === null) continue;
    const list = byParent.get(n.parentId) || [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  let ordemChanged = false;
  const nodes2 = { ...result.nodes };
  for (const list of byParent.values()) {
    list.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
    list.forEach((n, i) => {
      if (n.ordem !== i) {
        nodes2[n.id] = { ...nodes2[n.id], ordem: i };
        ordemChanged = true;
      }
    });
  }
  const result2 = ordemChanged ? { ...result, nodes: nodes2 } : result;

  // 5. materializa lado dos ramos (fixo dali em diante). Legado usava
  // paridade do indice — mantemos a mesma formula pra nao reembaralhar
  // mapas existentes na primeira carga.
  const rootKids = getChildren(result2, result2.rootId);
  let sideChanged = false;
  const nodes3 = { ...result2.nodes };
  rootKids.forEach((c, i) => {
    if (c.side !== 'left' && c.side !== 'right') {
      nodes3[c.id] = { ...nodes3[c.id], side: i % 2 === 0 ? 'right' : 'left' };
      sideChanged = true;
    }
  });
  return sideChanged ? { ...result2, nodes: nodes3 } : result2;
}

// ============================================================
// Mutacoes (imutaveis — retornam novo MapaMentalData)
// ============================================================

// Lado com menos nós recebe o proximo ramo (equilibrio tipo MindMeister).
function pickBalancedSide(data: MapaMentalData): 'left' | 'right' {
  const rootKids = getChildren(data, data.rootId);
  let left = 0;
  let right = 0;
  for (const kid of rootKids) {
    const weight = 1 + getDescendantIds(data, kid.id).length;
    if (kid.side === 'left') left += weight;
    else right += weight;
  }
  return left < right ? 'left' : 'right';
}

export function addChild(data: MapaMentalData, parentId: string, text = ''): { data: MapaMentalData; newId: string } {
  const id = newId();
  const ordem = getChildren(data, parentId).length;
  const node: MindNode = { id, text, parentId, ordem };
  // Lado é atribuído SEMPRE que o pai é a raiz (mesmo em layout logical,
  // que o ignora) — trocar pra 'map' depois não pode reembaralhar ramos.
  if (parentId === data.rootId) {
    node.side = pickBalancedSide(data);
  }
  const nodes: Record<string, MindNode> = { ...data.nodes, [id]: node };
  // Criar filho num nó recolhido expande o nó — filho novo nunca nasce invisivel.
  const parent = nodes[parentId];
  if (parent?.collapsed) {
    nodes[parentId] = { ...parent, collapsed: false };
  }
  return { newId: id, data: { ...data, nodes } };
}

export function addSibling(data: MapaMentalData, refId: string, text = ''): { data: MapaMentalData; newId: string } | null {
  const ref = data.nodes[refId];
  if (!ref || ref.parentId === null) return null; // root nao tem sibling
  const siblings = getChildren(data, ref.parentId);
  const insertIdx = siblings.findIndex(s => s.id === refId);
  const id = newId();
  const node: MindNode = { id, text, parentId: ref.parentId, ordem: insertIdx + 1 };
  // Tópico principal novo vai pro lado com menos conteúdo (MindMeister
  // equilibra os ramos em volta da raiz); em outros níveis o lado vem
  // da ancestralidade, não do nó.
  if (ref.parentId === data.rootId) {
    node.side = pickBalancedSide(data);
  }
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
  const target = data.nodes[id];
  if (!target) return data;
  const descs = getDescendantIds(data, id);
  const toRemove = new Set([id, ...descs]);
  const next: Record<string, MindNode> = {};
  for (const [k, v] of Object.entries(data.nodes)) {
    if (!toRemove.has(k)) next[k] = v;
  }
  // Reindexa siblings restantes
  if (target.parentId && next[target.parentId]) {
    const siblings = Object.values(next)
      .filter(n => n.parentId === target.parentId)
      .sort((a, b) => a.ordem - b.ordem);
    siblings.forEach((s, i) => {
      if (s.ordem !== i) next[s.id] = { ...s, ordem: i };
    });
  }
  return { ...data, nodes: next };
}

/**
 * Move um nó (com sua subarvore) pra outro pai / outra posicao.
 * `index` é a posicao desejada na lista de filhos do NOVO pai,
 * considerando a lista SEM o nó movido. Guardas: nunca move a raiz,
 * nunca move pra dentro da propria subarvore.
 */
export function moveNode(
  data: MapaMentalData,
  nodeId: string,
  newParentId: string,
  index: number,
  side?: 'left' | 'right',
): MapaMentalData {
  const node = data.nodes[nodeId];
  const newParent = data.nodes[newParentId];
  if (!node || !newParent) return data;
  if (nodeId === data.rootId) return data;
  if (newParentId === nodeId) return data;
  if (isDescendantOf(data, newParentId, nodeId)) return data; // ciclo

  const updated: Record<string, MindNode> = { ...data.nodes };

  // 1. remove da lista antiga (reindexa)
  const oldSiblings = getChildren(data, node.parentId!).filter(s => s.id !== nodeId);
  oldSiblings.forEach((s, i) => {
    if (s.ordem !== i) updated[s.id] = { ...updated[s.id], ordem: i };
  });

  // 2. insere na lista nova na posicao pedida
  const newSiblings = (node.parentId === newParentId ? oldSiblings : getChildren(data, newParentId))
    .map(s => updated[s.id] || s);
  const clamped = Math.max(0, Math.min(index, newSiblings.length));
  newSiblings.forEach((s, i) => {
    const ordem = i < clamped ? i : i + 1;
    if (s.ordem !== ordem) updated[s.id] = { ...updated[s.id], ordem };
  });

  const moved: MindNode = { ...node, parentId: newParentId, ordem: clamped };
  // side só faz sentido em filho direto da raiz
  if (newParentId === data.rootId) {
    moved.side = side || node.side || pickBalancedSide(data);
  } else {
    delete moved.side;
  }
  updated[nodeId] = moved;

  // 3. destino recolhido expande — nó movido nunca some da tela
  if (updated[newParentId].collapsed) {
    updated[newParentId] = { ...updated[newParentId], collapsed: false };
  }

  return { ...data, nodes: updated };
}

/** Move o nó uma posicao acima/abaixo entre os irmãos. Ramos da raiz no
 * layout 'map' trocam de posição só com vizinhos do MESMO lado — mover
 * "pra cima" na lista mista esquerda/direita não teria efeito visível. */
export function reorderNode(data: MapaMentalData, nodeId: string, dir: -1 | 1): MapaMentalData {
  const node = data.nodes[nodeId];
  if (!node || node.parentId === null) return data;
  const siblings = getChildren(data, node.parentId);
  const idx = siblings.findIndex(s => s.id === nodeId);
  if (idx < 0) return data;

  if (node.parentId === data.rootId && (data.layout || 'map') === 'map') {
    const sameSide = siblings.filter(s => (s.side || 'right') === (node.side || 'right'));
    const sIdx = sameSide.findIndex(s => s.id === nodeId);
    const neighbor = sameSide[sIdx + dir];
    if (!neighbor) return data;
    const without = siblings.filter(s => s.id !== nodeId);
    const nIdx = without.findIndex(s => s.id === neighbor.id);
    const target = dir === -1 ? nIdx : nIdx + 1;
    return moveNode(data, nodeId, node.parentId, target, node.side);
  }

  const target = idx + dir;
  if (target < 0 || target >= siblings.length) return data;
  return moveNode(data, nodeId, node.parentId, target, node.side);
}

/** Shift+Tab — o nó vira irmão do pai, logo depois dele. */
export function outdentNode(data: MapaMentalData, nodeId: string): MapaMentalData {
  const node = data.nodes[nodeId];
  if (!node || node.parentId === null) return data;
  const parent = data.nodes[node.parentId];
  if (!parent || parent.parentId === null) return data; // pai é raiz — nada a fazer
  const side = parent.parentId === data.rootId ? parent.side : undefined;
  return moveNode(data, nodeId, parent.parentId, parent.ordem + 1, side);
}

// ============================================================
// Layout — algoritmo horizontal tipo MindMeister.
// Posiciona nodes em x/y a partir da arvore usando as dimensoes
// REAIS de cada nó (passadas em `sizes`, medidas pelo React Flow).
// Cada subarvore é um bloco compacto centrado verticalmente no pai.
// ============================================================

export interface NodeSize { width: number; height: number }

export interface LayoutNode extends MindNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  side: 'left' | 'right';   // de que lado da raiz o nó está
  branchIndex: number;      // indice do ramo (filho da raiz) — define a cor
  costela?: Costela;        // só na espinha de peixe: a costela deste ramo
}

const H_GAP = 70;      // espaco horizontal entre niveis
const V_GAP = 18;      // espaco vertical entre siblings
// Organograma respira mais: a hierarquia se lê pela distância entre fileiras,
// e irmãos colados viram uma faixa contínua em vez de caixas.
const ORG_NIVEL_GAP = 56;   // espaco vertical entre fileiras
const ORG_IRMAO_GAP = 24;   // espaco horizontal entre irmaos
const RADIAL_RAIO_1 = 150;  // distancia da ideia central ao primeiro anel
const RADIAL_ANEL = 150;    // distancia entre aneis
const TL_GAP = 48;          // vao entre eventos na linha do tempo
const TL_AFASTA = 44;       // distancia do evento ate o eixo
const FB_BONE_DX = 110;     // quanto a costela inclina para trás (na altura mínima)
const FB_BONE_DY = 150;     // altura mínima da costela
const FB_LINHA = 36;        // a linha deitada entre a causa e a costela
const FB_CAUSA_GAP = 44;    // distância vertical entre causas na mesma costela
const FB_PASSO_MIN = 220;   // distância mínima entre costelas do mesmo lado
const FB_CABECA = 72;       // folga entre a última costela e a cabeça
const MX_COL_GAP = 24;      // vao entre colunas da matriz
const MX_CEL_GAP = 10;      // vao entre celulas

// Estimativa pro primeiro paint, antes do React Flow medir. Curta o
// suficiente pra nao "pular" demais quando a medida real chega.
function estimateSize(node: MindNode, isRoot: boolean): NodeSize {
  const text = node.text || (isRoot ? 'Ideia central' : 'Novo tópico');
  const charW = isRoot ? 8.6 : 7.6;
  const padding = isRoot ? 60 : 34;
  const extras = (node.icon ? 24 : 0) + (node.notes ? 18 : 0)
    + (node.links?.length ? 18 : 0) + (node.attachments?.length ? 18 : 0);
  const width = Math.min(640, Math.max(isRoot ? 180 : 72, text.length * charW + padding + extras));
  let height = isRoot ? 48 : 30;
  if (node.image?.url) height += isRoot ? 96 : 106;
  return { width, height };
}

interface LayoutCtx {
  data: MapaMentalData;
  sizeOf: (id: string) => NodeSize;
  out: LayoutNode[];
}

function measureSubtree(ctx: LayoutCtx, nodeId: string): number {
  const node = ctx.data.nodes[nodeId];
  if (!node) return 0;
  const own = ctx.sizeOf(nodeId).height;
  const children = node.collapsed ? [] : getChildren(ctx.data, nodeId);
  if (children.length === 0) return own;
  let total = 0;
  for (const c of children) total += measureSubtree(ctx, c.id);
  total += (children.length - 1) * V_GAP;
  return Math.max(own, total);
}

// Coloca uma subarvore num lado especifico. anchorX é a borda do pai
// na direcao de crescimento (borda direita do pai pra side=right,
// borda esquerda pra side=left).
function placeSubtree(
  ctx: LayoutCtx,
  nodeId: string,
  anchorX: number,
  centerY: number,
  depth: number,
  side: 'left' | 'right',
  branchIndex: number,
): void {
  const node = ctx.data.nodes[nodeId];
  if (!node) return;

  const { width, height } = ctx.sizeOf(nodeId);
  const x = side === 'right' ? anchorX + H_GAP : anchorX - H_GAP - width;
  const y = centerY - height / 2;

  ctx.out.push({ ...node, x, y, width, height, depth, side, branchIndex });

  if (node.collapsed) return;
  const children = getChildren(ctx.data, nodeId);
  if (children.length === 0) return;

  const childAnchorX = side === 'right' ? x + width : x;
  const heights = children.map(c => measureSubtree(ctx, c.id));
  const totalH = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * V_GAP;
  let cursor = centerY - totalH / 2;
  for (let i = 0; i < children.length; i++) {
    const ch = heights[i];
    placeSubtree(ctx, children[i].id, childAnchorX, cursor + ch / 2, depth + 1, side, branchIndex);
    cursor += ch + V_GAP;
  }
}

/** Largura que a subárvore ocupa numa fileira: o maior entre o próprio nó e
 *  a soma dos filhos com os vãos. É o espelho de measureSubtree, que mede
 *  altura para o layout deitado. */
function measureSubtreeWidth(ctx: LayoutCtx, nodeId: string): number {
  const node = ctx.data.nodes[nodeId];
  if (!node) return 0;
  const own = ctx.sizeOf(nodeId).width;
  const children = node.collapsed ? [] : getChildren(ctx.data, nodeId);
  if (children.length === 0) return own;
  let total = 0;
  for (const c of children) total += measureSubtreeWidth(ctx, c.id);
  total += (children.length - 1) * ORG_IRMAO_GAP;
  return Math.max(own, total);
}

/**
 * Organograma de cima para baixo. O nó fica centrado na faixa que a sua
 * subárvore ocupa, e os filhos dividem essa faixa na fileira de baixo.
 *
 * `side` é sempre 'right' aqui: ele existe no LayoutNode para os layouts
 * deitados decidirem lado da raiz, e o organograma não tem lado. Quem
 * precisa saber a direção pergunta a direcaoDoLayout, não ao side.
 */
function placeSubtreeDown(
  ctx: LayoutCtx,
  nodeId: string,
  centerX: number,
  topY: number,
  depth: number,
  branchIndex: number,
): void {
  const node = ctx.data.nodes[nodeId];
  if (!node) return;

  const { width, height } = ctx.sizeOf(nodeId);
  ctx.out.push({ ...node, x: centerX - width / 2, y: topY, width, height, depth, side: 'right', branchIndex });

  if (node.collapsed) return;
  const children = getChildren(ctx.data, nodeId);
  if (children.length === 0) return;

  const widths = children.map(c => measureSubtreeWidth(ctx, c.id));
  const total = widths.reduce((a, w) => a + w, 0) + (children.length - 1) * ORG_IRMAO_GAP;
  let cursor = centerX - total / 2;
  const childTop = topY + height + ORG_NIVEL_GAP;
  for (let i = 0; i < children.length; i++) {
    placeSubtreeDown(ctx, children[i].id, cursor + widths[i] / 2, childTop, depth + 1, branchIndex);
    cursor += widths[i] + ORG_IRMAO_GAP;
  }
}

/** Quantas folhas a subárvore tem: é o peso que divide o ângulo no radial. */
function contarFolhas(ctx: LayoutCtx, nodeId: string): number {
  const node = ctx.data.nodes[nodeId];
  if (!node) return 0;
  const children = node.collapsed ? [] : getChildren(ctx.data, nodeId);
  if (children.length === 0) return 1;
  let n = 0;
  for (const c of children) n += contarFolhas(ctx, c.id);
  return n;
}

/**
 * Radial: cada ramo ocupa uma fatia do círculo proporcional às folhas que
 * tem, e a subárvore cresce para fora dentro dessa fatia. É o mapa mental
 * "de livro", o que o XMind chama de map e o MindMeister de radial.
 */
function placeRadial(ctx: LayoutCtx, nodeId: string, angulo: number, abertura: number, depth: number, branchIndex: number, raio1: number): void {
  const node = ctx.data.nodes[nodeId];
  if (!node) return;
  const { width, height } = ctx.sizeOf(nodeId);
  const r = raio1 + (depth - 1) * RADIAL_ANEL;
  const cx = Math.cos(angulo) * r;
  const cy = Math.sin(angulo) * r;
  ctx.out.push({
    ...node, x: cx - width / 2, y: cy - height / 2, width, height, depth,
    side: Math.cos(angulo) < 0 ? 'left' : 'right', branchIndex,
  });
  if (node.collapsed) return;
  const children = getChildren(ctx.data, nodeId);
  if (children.length === 0) return;
  const pesos = children.map(c => contarFolhas(ctx, c.id));
  const total = pesos.reduce((a, b) => a + b, 0);
  let inicio = angulo - abertura / 2;
  for (let i = 0; i < children.length; i++) {
    const fatia = abertura * (pesos[i] / total);
    placeRadial(ctx, children[i].id, inicio + fatia / 2, fatia, depth + 1, branchIndex, raio1);
    inicio += fatia;
  }
}

/**
 * Linha do tempo: a raiz é o título à esquerda, os ramos são os eventos em
 * ordem, da esquerda para a direita, alternando acima e abaixo de um eixo.
 * O que está dentro de cada evento se afasta do eixo em coluna.
 */
function placeTimeline(ctx: LayoutCtx, children: MindNode[], rootRightX: number): void {
  let cursor = rootRightX + 90;
  for (let i = 0; i < children.length; i++) {
    const colW = measureSubtreeWidth(ctx, children[i].id);
    const acima = i % 2 === 0;
    placeColuna(ctx, children[i].id, cursor + colW / 2, acima ? -TL_AFASTA : TL_AFASTA, acima ? -1 : 1, 1, i);
    cursor += colW + TL_GAP;
  }
}

/** Uma coluna que cresce num sentido vertical (−1 sobe, +1 desce). */
function placeColuna(ctx: LayoutCtx, nodeId: string, centerX: number, bordaY: number, sentido: -1 | 1, depth: number, branchIndex: number): void {
  const node = ctx.data.nodes[nodeId];
  if (!node) return;
  const { width, height } = ctx.sizeOf(nodeId);
  const y = sentido < 0 ? bordaY - height : bordaY;
  ctx.out.push({ ...node, x: centerX - width / 2, y, width, height, depth, side: 'right', branchIndex });
  if (node.collapsed) return;
  const children = getChildren(ctx.data, nodeId);
  if (children.length === 0) return;
  const widths = children.map(c => measureSubtreeWidth(ctx, c.id));
  const total = widths.reduce((a, w) => a + w, 0) + (children.length - 1) * ORG_IRMAO_GAP;
  let cursor = centerX - total / 2;
  const proximaBorda = sentido < 0 ? y - 28 : y + height + 28;
  for (let i = 0; i < children.length; i++) {
    placeColuna(ctx, children[i].id, cursor + widths[i] / 2, proximaBorda, sentido, depth + 1, branchIndex);
    cursor += widths[i] + ORG_IRMAO_GAP;
  }
}

/**
 * Espinha de peixe (Ishikawa): o efeito é a cabeça, à direita; uma espinha
 * dorsal sai dela para a esquerda; as famílias de causa são costelas que
 * saem da dorsal inclinadas para trás, alternando em cima e embaixo; cada
 * causa pendura ao longo da sua costela, ligada a ela por uma linha deitada.
 * A geometria fica em `costela` nos nós, e o MindEdge desenha a partir dela.
 */
function placeFishbone(ctx: LayoutCtx, children: MindNode[], rootLeftX: number): void {
  const pares = Math.ceil(children.length / 2);
  // Cada costela precisa de espaço para as causas que penduram à esquerda
  // dela (largura mais a linha deitada), e o rótulo da família também não
  // pode invadir a costela vizinha do mesmo lado.
  let passo = FB_PASSO_MIN;
  let maisCausas = 0;
  for (const c of children) {
    passo = Math.max(passo, ctx.sizeOf(c.id).width + 24);
    const causas = c.collapsed ? [] : getChildren(ctx.data, c.id);
    maisCausas = Math.max(maisCausas, causas.length);
    for (const f of causas) passo = Math.max(passo, ctx.sizeOf(f.id).width + FB_LINHA + 32);
  }
  // A costela cresce com o número de causas, para elas não se empilharem.
  const altura = Math.max(FB_BONE_DY, (maisCausas + 1) * FB_CAUSA_GAP + 40);
  const inclinacao = Math.round(altura * FB_BONE_DX / FB_BONE_DY);
  const costelas: Costela[] = [];
  for (let i = 0; i < children.length; i++) {
    const k = Math.floor(i / 2);
    const sinal: -1 | 1 = i % 2 === 0 ? -1 : 1;
    // A primeira família fica mais atrás; as seguintes avançam para a cabeça.
    const encaixeX = rootLeftX - FB_CABECA - passo * (pares - 1 - k);
    const { height } = ctx.sizeOf(children[i].id);
    const centroX = encaixeX - inclinacao;
    const centroY = sinal * altura;
    const costela: Costela = { encaixeX, encaixeY: 0, pontaX: centroX, pontaY: centroY - sinal * height / 2, caudaX: 0 };
    costelas.push(costela);
    placeEspinha(ctx, children[i].id, centroX, centroY, costela, 1, i);
  }
  // A espinha dorsal vai da cabeça até um pouco depois do que estiver mais atrás.
  const xs = ctx.out.filter(n => n.depth > 0).map(n => n.x);
  const caudaX = xs.length ? Math.round(Math.min(...xs) - 24) : rootLeftX - FB_CABECA;
  for (const c of costelas) c.caudaX = caudaX;
}

function placeEspinha(ctx: LayoutCtx, nodeId: string, centroX: number, centroY: number, costela: Costela, depth: number, branchIndex: number): void {
  const node = ctx.data.nodes[nodeId];
  if (!node) return;
  const { width, height } = ctx.sizeOf(nodeId);
  ctx.out.push({ ...node, x: centroX - width / 2, y: centroY - height / 2, width, height, depth, side: 'left', branchIndex, costela });
  if (node.collapsed) return;
  const children = getChildren(ctx.data, nodeId);
  if (children.length === 0) return;
  if (depth === 1) {
    // As causas penduram ao longo da costela, da ponta (junto ao rótulo) ao
    // encaixe na dorsal, cada uma com a borda direita a FB_LINHA da costela.
    for (let j = 0; j < children.length; j++) {
      const t = (j + 1) / (children.length + 1);
      const px = costela.pontaX + (costela.encaixeX - costela.pontaX) * t;
      const py = costela.pontaY + (costela.encaixeY - costela.pontaY) * t;
      const w = ctx.sizeOf(children[j].id).width;
      placeEspinha(ctx, children[j].id, px - FB_LINHA - w / 2, py, costela, depth + 1, branchIndex);
    }
    return;
  }
  // Mais fundo que a causa: abre para trás, como um mapa deitado para a esquerda.
  const x = centroX - width / 2;
  const heights = children.map(c => measureSubtree(ctx, c.id));
  const totalH = heights.reduce((a, h) => a + h, 0) + (children.length - 1) * V_GAP;
  let cursor = centroY - totalH / 2;
  for (let i = 0; i < children.length; i++) {
    placeSubtree(ctx, children[i].id, x, cursor + heights[i] / 2, depth + 1, 'left', branchIndex);
    cursor += heights[i] + V_GAP;
  }
}

/**
 * Matriz: a raiz é o título; cada ramo é uma coluna com o cabeçalho em cima
 * e o que ele contém empilhado embaixo. O que está mais fundo entra na
 * mesma coluna, recuado — uma SWOT, por exemplo, vira quatro colunas.
 */
function placeMatrix(ctx: LayoutCtx, children: MindNode[], topoY: number): void {
  const larguras = children.map(c => {
    let w = 0;
    const visitar = (id: string, recuo: number) => {
      const n = ctx.data.nodes[id]; if (!n) return;
      w = Math.max(w, ctx.sizeOf(id).width + recuo);
      if (!n.collapsed) for (const f of getChildren(ctx.data, id)) visitar(f.id, recuo + (id === c.id ? 0 : 16));
    };
    visitar(c.id, 0);
    return w;
  });
  const total = larguras.reduce((a, w) => a + w, 0) + (children.length - 1) * MX_COL_GAP;
  let cursor = -total / 2;
  for (let i = 0; i < children.length; i++) {
    const esquerda = cursor;
    let y = topoY;
    const empilhar = (id: string, recuo: number, depth: number) => {
      const n = ctx.data.nodes[id]; if (!n) return;
      const { width, height } = ctx.sizeOf(id);
      ctx.out.push({ ...n, x: esquerda + recuo, y, width, height, depth, side: 'right', branchIndex: i });
      y += height + MX_CEL_GAP;
      if (!n.collapsed) for (const f of getChildren(ctx.data, id)) empilhar(f.id, recuo + (depth === 1 ? 0 : 16), depth + 1);
    };
    empilhar(children[i].id, 0, 1);
    cursor += larguras[i] + MX_COL_GAP;
  }
}

export function layoutMindMap(
  data: MapaMentalData,
  sizes?: Record<string, NodeSize>,
): LayoutNode[] {
  const out: LayoutNode[] = [];
  const root = data.nodes[data.rootId];
  if (!root) return out;

  const sizeOf = (id: string): NodeSize => {
    const measured = sizes?.[id];
    if (measured && measured.width > 0 && measured.height > 0) return measured;
    return estimateSize(data.nodes[id], id === data.rootId);
  };
  const ctx: LayoutCtx = { data, sizeOf, out };

  const rootSize = sizeOf(data.rootId);
  const centerY = 0;
  const rootX = -rootSize.width / 2;

  out.push({
    ...root,
    x: rootX,
    y: centerY - rootSize.height / 2,
    width: rootSize.width,
    height: rootSize.height,
    depth: 0,
    side: 'right',
    branchIndex: 0,
  });

  if (root.collapsed) return out;
  const children = getChildren(data, data.rootId);
  if (children.length === 0) return out;

  const layoutMode = data.layout || 'map';

  if (layoutMode === 'radial') {
    const pesos = children.map(c => contarFolhas(ctx, c.id));
    const total = pesos.reduce((a, b) => a + b, 0);
    // O primeiro anel começa fora da raiz E fora do botão "+" que fica ao lado
    // dela — com raio fixo, uma ideia central comprida engolia o primeiro ramo.
    // Cada nó fica CENTRADO no seu ponto do anel, então o ramo que cai na
    // horizontal precisa de meia largura dele própria, mais meia da raiz, mais
    // o botão, para não encostar.
    const maisLargo = Math.max(...children.map(c => ctx.sizeOf(c.id).width));
    const raio1 = Math.max(RADIAL_RAIO_1, rootSize.width / 2 + maisLargo / 2 + 56);
    let inicio = -Math.PI / 2;
    for (let i = 0; i < children.length; i++) {
      const fatia = (2 * Math.PI) * (pesos[i] / total);
      placeRadial(ctx, children[i].id, inicio + fatia / 2, fatia, 1, i, raio1);
      inicio += fatia;
    }
    return out;
  }

  if (layoutMode === 'timeline') {
    placeTimeline(ctx, children, rootX + rootSize.width);
    return out;
  }

  if (layoutMode === 'fishbone') {
    placeFishbone(ctx, children, rootX);
    return out;
  }

  if (layoutMode === 'matrix') {
    placeMatrix(ctx, children, out[0].y + rootSize.height + ORG_NIVEL_GAP);
    return out;
  }

  if (layoutMode === 'org') {
    // Raiz no topo, cada ramo é uma coluna da primeira fileira.
    const widths = children.map(c => measureSubtreeWidth(ctx, c.id));
    const total = widths.reduce((a, w) => a + w, 0) + (children.length - 1) * ORG_IRMAO_GAP;
    let cursor = -total / 2;
    const childTop = out[0].y + rootSize.height + ORG_NIVEL_GAP;
    for (let i = 0; i < children.length; i++) {
      placeSubtreeDown(ctx, children[i].id, cursor + widths[i] / 2, childTop, 1, i);
      cursor += widths[i] + ORG_IRMAO_GAP;
    }
    return out;
  }

  // O organograma deitado tem a mesma geometria da árvore para a direita;
  // o que o distingue é o conector em cotovelo e o nó em caixa, decididos
  // por quem desenha. Uma geometria só, duas aparências.
  if (layoutMode === 'logical' || layoutMode === 'right' || layoutMode === 'org-right') {
    // Tudo cresce pra direita
    const heights = children.map(c => measureSubtree(ctx, c.id));
    const totalH = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * V_GAP;
    let cursor = centerY - totalH / 2;
    const anchor = rootX + rootSize.width;
    for (let i = 0; i < children.length; i++) {
      placeSubtree(ctx, children[i].id, anchor, cursor + heights[i] / 2, 1, 'right', i);
      cursor += heights[i] + V_GAP;
    }
    return out;
  }

  // layout='map' — cada ramo tem lado FIXO (persistido em node.side).
  // Legado sem side cai na paridade do indice (mesma formula do
  // sanitizeMap, entao nunca diverge apos a primeira carga).
  const rightKids: { node: MindNode; branchIndex: number }[] = [];
  const leftKids: { node: MindNode; branchIndex: number }[] = [];
  children.forEach((c, i) => {
    const side = c.side || (i % 2 === 0 ? 'right' : 'left');
    (side === 'right' ? rightKids : leftKids).push({ node: c, branchIndex: i });
  });

  for (const [kids, side] of [[rightKids, 'right'], [leftKids, 'left']] as const) {
    const heights = kids.map(k => measureSubtree(ctx, k.node.id));
    const total = heights.reduce((s, h) => s + h, 0) + Math.max(0, kids.length - 1) * V_GAP;
    let cursor = centerY - total / 2;
    const anchor = side === 'right' ? rootX + rootSize.width : rootX;
    for (let i = 0; i < kids.length; i++) {
      placeSubtree(ctx, kids[i].node.id, anchor, cursor + heights[i] / 2, 1, side, kids[i].branchIndex);
      cursor += heights[i] + V_GAP;
    }
  }

  return out;
}

// ============================================================
// Paleta — cor por RAMO (estilo MindMeister): cada filho da raiz
// define a cor de toda sua subarvore. Temas mono-cor (minimal)
// continuam uniformes.
// ============================================================

// Paletas — minimal mono-azul é o default (estilo XMind/Whimsical clean).
const PALETTES: Record<string, string[]> = {
  minimal:  ['#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6'],
  rainbow:  ['#0a84ff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'],
  pastel:   ['#93C5FD', '#6EE7B7', '#FCD34D', '#F9A8D4', '#C4B5FD', '#67E8F9', '#BEF264'],
  vibrante: ['#2563EB', '#DC2626', '#F59E0B', '#16A34A', '#7C3AED', '#DB2777', '#0891B2'],
  escuro:   ['#60A5FA', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#22D3EE', '#A3E635'],
  sepia:    ['#92400E', '#B45309', '#A16207', '#78350F', '#713F12', '#854D0E', '#92400E'],
  ocean:    ['#0369a1', '#0891b2', '#0d9488', '#0e7490', '#1e40af', '#155e75', '#164e63'],
  sunset:   ['#db2777', '#ea580c', '#d97706', '#dc2626', '#be185d', '#c2410c', '#9f1239'],
  forest:   ['#15803d', '#65a30d', '#16a34a', '#047857', '#166534', '#3f6212', '#365314'],
  mono:     ['#1e293b', '#334155', '#475569', '#64748b', '#475569', '#334155', '#1e293b'],
  classic:  ['#0f172a', '#334155', '#475569', '#64748b', '#475569', '#334155', '#0f172a'],
};

export type Theme =
  | 'minimal' | 'classic' | 'rainbow' | 'mono'
  | 'ocean' | 'sunset' | 'forest'
  | 'pastel' | 'vibrante' | 'escuro' | 'sepia';

export const THEMES: { id: Theme; label: string; preview: string[] }[] = [
  { id: 'minimal',  label: 'Minimal',   preview: ['#3B82F6'] },
  { id: 'rainbow',  label: 'Arco-íris', preview: ['#0a84ff', '#10b981', '#f59e0b', '#ec4899'] },
  { id: 'pastel',   label: 'Pastel',    preview: ['#93C5FD', '#6EE7B7', '#FCD34D', '#F9A8D4'] },
  { id: 'vibrante', label: 'Vibrante',  preview: ['#2563EB', '#DC2626', '#F59E0B', '#16A34A'] },
  { id: 'escuro',   label: 'Escuro',    preview: ['#60A5FA', '#34D399', '#FBBF24', '#F87171'] },
  { id: 'sepia',    label: 'Sépia',     preview: ['#92400E', '#B45309', '#A16207', '#78350F'] },
  { id: 'ocean',    label: 'Oceano',    preview: ['#0369a1', '#0891b2', '#0d9488', '#0e7490'] },
  { id: 'sunset',   label: 'Pôr do sol', preview: ['#db2777', '#ea580c', '#d97706', '#dc2626'] },
  { id: 'forest',   label: 'Floresta',  preview: ['#15803d', '#65a30d', '#16a34a', '#047857'] },
  { id: 'mono',     label: 'Mono',      preview: ['#1e293b', '#475569', '#64748b'] },
];

const ROOT_NEUTRAL = '#334155';

export function colorForNode(depth: number, branchIndex: number, theme: Theme = 'minimal'): string {
  const palette = PALETTES[theme] || PALETTES.minimal;
  const distinct = new Set(palette).size;
  if (depth === 0) return distinct <= 1 ? palette[0] : ROOT_NEUTRAL;
  return palette[branchIndex % palette.length];
}

/** @deprecated use colorForNode — mantido só por compatibilidade. */
export function colorForDepth(depth: number, theme: Theme = 'minimal'): string {
  const palette = PALETTES[theme] || PALETTES.minimal;
  return palette[depth % palette.length];
}

// Paleta de seleção rápida pra override de cor de um nó (painel direito).
export const NODE_COLORS = [
  '#0a84ff', '#10b981', '#f59e0b', '#ec4899',
  '#8b5cf6', '#06b6d4', '#ef4444', '#475569',
];
