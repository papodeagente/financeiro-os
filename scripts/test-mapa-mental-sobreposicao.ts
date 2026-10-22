/**
 * Nenhum layout do mapa mental põe uma caixa em cima da outra.
 *
 * Os testes de layout conferem casos montados à mão; este gera centenas de
 * mapas ao acaso (textos curtos e compridos, nós com imagem, até quatro
 * níveis, ramos vazios e ramos cheios) e roda cada um nos nove layouts. Uma
 * sobreposição é reprovação, com o mapa que a causou impresso para reproduzir.
 *
 * Confere também as LINHAS, refeitas com a mesma geometria que a tela usa
 * (curva do React Flow, cotovelo, costela da espinha, trilho da matriz):
 * nenhuma passa por dentro de uma caixa que não seja a das suas pontas. Foi
 * assim que o Bruno viu "sdfdsf" cair em cima das causas da família vizinha
 * na espinha, e o texto das células riscado na matriz.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-mapa-mental-sobreposicao.ts
 */
import {
  createMindMap, addChild, updateNode, layoutMindMap, getChildren, handlesDaLigacao, estiloDaLigacao,
  type MapaMentalData, type NodeSize, type LayoutNode,
} from '../src/lib/mapa-mental.ts';
import { MODELOS_DE_MAPA, construirDoModelo } from '../src/lib/mapa-mental-templates.ts';

const LAYOUTS = ['map', 'logical', 'right', 'org', 'org-right', 'radial', 'timeline', 'fishbone', 'matrix'] as const;
const FOLGA = 4; // duas caixas a menos de 4px já parecem encostadas

let falhas = 0, total = 0;
const falhasPorLayout: Record<string, number> = {};

/** Gerador determinístico: o mesmo número dá o mesmo mapa, para reproduzir. */
function sorteador(semente: number) {
  let s = semente >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

function mapaAleatorio(semente: number): { mapa: MapaMentalData; tamanhos: Record<string, NodeSize> } {
  const r = sorteador(semente);
  let m = createMindMap('t');
  const tamanhos: Record<string, NodeSize> = { [m.rootId]: { width: 160 + Math.floor(r() * 220), height: 44 + (r() < 0.15 ? 60 : 0) } };
  const nivel = (paiId: string, depth: number) => {
    const max = depth === 1 ? 1 + Math.floor(r() * 7) : depth === 2 ? Math.floor(r() * 6) : depth === 3 ? Math.floor(r() * 4) : 0;
    for (let i = 0; i < max; i++) {
      const a = addChild(m, paiId); m = a.data;
      const curto = r() < 0.5;
      tamanhos[a.newId] = {
        width: curto ? 50 + Math.floor(r() * 80) : 130 + Math.floor(r() * 200),
        height: r() < 0.08 ? 136 : 30 + (r() < 0.1 ? 20 : 0),
      };
      if (r() < 0.75) nivel(a.newId, depth + 1);
    }
  };
  nivel(m.rootId, 1);
  if (r() < 0.1) {
    // De vez em quando um ramo recolhido: o que está dentro dele não aparece.
    const filhos = getChildren(m, m.rootId);
    if (filhos.length) m = updateNode(m, filhos[0].id, { collapsed: true });
  }
  return { mapa: m, tamanhos };
}

function sobrepostos(nos: LayoutNode[]): [LayoutNode, LayoutNode] | null {
  for (let i = 0; i < nos.length; i++) {
    for (let j = i + 1; j < nos.length; j++) {
      const a = nos[i], b = nos[j];
      if (a.x < b.x + b.width + FOLGA && a.x + a.width + FOLGA > b.x && a.y < b.y + b.height + FOLGA && a.y + a.height + FOLGA > b.y) return [a, b];
    }
  }
  return null;
}

/** O segmento p→q passa por dentro da caixa (encolhida 1px, para tocar na borda não contar)? */
function cruza(p: [number, number], q: [number, number], c: { x: number; y: number; width: number; height: number }): boolean {
  const x0 = c.x + 1, x1 = c.x + c.width - 1, y0 = c.y + 1, y1 = c.y + c.height - 1;
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

type Ponto = [number, number];
type Linha = { de: string; para: string; pontos: Ponto[] };

function pontoDoHandle(n: LayoutNode, h: string): Ponto {
  switch (h) {
    case 'l': case 'ls': return [n.x, n.y + n.height / 2];
    case 'r': case 'rs': return [n.x + n.width, n.y + n.height / 2];
    case 't': case 'ts': return [n.x + n.width / 2, n.y];
    default: return [n.x + n.width / 2, n.y + n.height];
  }
}

/** Curva do React Flow (getBezierPath, curvature 0.35), amostrada. */
function curva(p: Ponto, ph: string, q: Ponto, qh: string): Ponto[] {
  const desloc = (dist: number) => (dist >= 0 ? 0.5 * dist : 0.35 * 25 * Math.sqrt(-dist));
  const controle = (a: Ponto, h: string, b: Ponto): Ponto => {
    const lado = h[0];
    if (lado === 'l') return [a[0] - desloc(a[0] - b[0]), a[1]];
    if (lado === 'r') return [a[0] + desloc(b[0] - a[0]), a[1]];
    if (lado === 't') return [a[0], a[1] - desloc(a[1] - b[1])];
    return [a[0], a[1] + desloc(b[1] - a[1])];
  };
  const c1 = controle(p, ph, q), c2 = controle(q, qh, p);
  const pts: Ponto[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, u = 1 - t;
    pts.push([u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0],
              u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1]]);
  }
  return pts;
}

/** Cotovelo (getSmoothStepPath) nos casos que os layouts usam. */
function cotovelo(p: Ponto, ph: string, q: Ponto, qh: string): Ponto[] {
  const vertical = (h: string) => h[0] === 't' || h[0] === 'b';
  if (vertical(ph) && vertical(qh)) { const my = (p[1] + q[1]) / 2; return [p, [p[0], my], [q[0], my], q]; }
  if (!vertical(ph) && !vertical(qh)) { const mx = (p[0] + q[0]) / 2; return [p, [mx, p[1]], [mx, q[1]], q]; }
  if (!vertical(ph)) return [p, [q[0], p[1]], q];   // sai deitado, entra em pé
  return [p, [p[0], q[1]], q];                       // sai em pé, entra deitado
}

function linhasDoMapa(nos: LayoutNode[], layout: MapaMentalData['layout']): Linha[] {
  const porId = new Map(nos.map(n => [n.id, n]));
  const estilo = estiloDaLigacao(layout);
  const linhas: Linha[] = [];
  for (const n of nos) {
    const pai = n.parentId ? porId.get(n.parentId) : undefined;
    if (!pai) continue;
    const { sourceHandle, targetHandle } = handlesDaLigacao(layout, n.side, pai, n);
    const p = pontoDoHandle(pai, sourceHandle), q = pontoDoHandle(n, targetHandle);
    const c = n.costela;
    if (estilo === 'espinha' && c && n.depth === 1) {
      linhas.push({ de: pai.id, para: n.id, pontos: [[pai.x, c.encaixeY], [c.caudaX, c.encaixeY]] });
      linhas.push({ de: pai.id, para: n.id, pontos: [[c.encaixeX, c.encaixeY], [c.pontaX, c.pontaY]] });
    } else if (estilo === 'espinha' && c && n.depth === 2) {
      const t = (q[1] - c.encaixeY) / ((c.pontaY - c.encaixeY) || 1);
      linhas.push({ de: pai.id, para: n.id, pontos: [q, [c.encaixeX + (c.pontaX - c.encaixeX) * t, q[1]]] });
    } else if (estilo === 'espinha') {
      linhas.push({ de: pai.id, para: n.id, pontos: [p, q] });
    } else if (estilo === 'trilho' && n.trilho !== undefined) {
      // Na linha do tempo a ligação do título leva junto o trecho do eixo.
      const comeco: Ponto[] = n.depth === 1 ? [p] : [];
      linhas.push({ de: pai.id, para: n.id, pontos: [...comeco, [n.trilho, p[1]], [n.trilho, q[1]], q] });
    } else if (estilo === 'cotovelo' || estilo === 'trilho') {
      linhas.push({ de: pai.id, para: n.id, pontos: cotovelo(p, sourceHandle, q, targetHandle) });
    } else {
      linhas.push({ de: pai.id, para: n.id, pontos: curva(p, sourceHandle, q, targetHandle) });
    }
  }
  return linhas;
}

function conferir(rotulo: string, mapa: MapaMentalData, tamanhos: Record<string, NodeSize> | undefined, layout: string) {
  total++;
  const nos = layoutMindMap({ ...mapa, layout: layout as MapaMentalData['layout'] }, tamanhos);
  const par = sobrepostos(nos);
  let problema = par ? `"${par[0].id.slice(0, 6)}" (prof ${par[0].depth}) e "${par[1].id.slice(0, 6)}" (prof ${par[1].depth}) se sobrepõem` : '';
  if (!problema) {
    for (const l of linhasDoMapa(nos, layout as MapaMentalData['layout'])) {
      let atravessada: LayoutNode | undefined;
      for (let k = 1; k < l.pontos.length && !atravessada; k++) {
        atravessada = nos.find(n => n.id !== l.de && n.id !== l.para && cruza(l.pontos[k - 1], l.pontos[k], n));
      }
      if (atravessada) { problema = `a linha ${l.de.slice(0, 6)}→${l.para.slice(0, 6)} atravessa "${atravessada.id.slice(0, 6)}" (prof ${atravessada.depth})`; break; }
    }
  }
  if (problema) {
    falhas++; falhasPorLayout[layout] = (falhasPorLayout[layout] ?? 0) + 1;
    if (falhasPorLayout[layout] <= 3) console.log(`FAIL  ${layout.padEnd(9)} ${rotulo}: ${problema}`);
  }
}

console.log('--- os dez modelos, em cada um dos nove layouts ---');
for (const modelo of MODELOS_DE_MAPA) {
  const mapa = construirDoModelo(modelo);
  for (const layout of LAYOUTS) conferir(`modelo ${modelo.id}`, mapa, undefined, layout);
}

console.log('--- 300 mapas ao acaso, em cada um dos nove layouts ---');
for (let semente = 1; semente <= 300; semente++) {
  const { mapa, tamanhos } = mapaAleatorio(semente);
  for (const layout of LAYOUTS) conferir(`semente ${semente}`, mapa, tamanhos, layout);
}

for (const layout of LAYOUTS) console.log(`  ${layout.padEnd(9)} ${falhasPorLayout[layout] ? `${falhasPorLayout[layout]} mapas com caixa ou linha por cima de outra` : 'nada por cima de nada'}`);
console.log(`\n${total - falhas}/${total} mapas sem caixa sobre caixa nem linha sobre caixa`);
if (falhas) process.exit(1);
