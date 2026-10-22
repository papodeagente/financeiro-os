/**
 * O motor de layout do mapa mental e os modelos.
 *
 * Nada disto tinha teste: o layout vivia sem cobertura e modelo não existia.
 * O que estes testes seguram: no organograma os filhos ficam ABAIXO do pai
 * e centrados nele, irmãos não se sobrepõem, e todo modelo monta um mapa
 * que o resto do sistema consegue ler.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-mapa-mental-layout.ts
 */
import { readFileSync } from 'node:fs';
import {
  createMindMap, addChild, layoutMindMap, sanitizeMap, getChildren,
  ehOrganograma, direcaoDoLayout, type MapaMentalData,
} from '../src/lib/mapa-mental.ts';
import { MODELOS_DE_MAPA, construirDoModelo, modeloPorId } from '../src/lib/mapa-mental-templates.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

/** Raiz com três ramos, o do meio com dois filhos. */
function arvore(layout: MapaMentalData['layout']): MapaMentalData {
  let m = createMindMap('t');
  const r = m.rootId;
  const a = addChild(m, r); m = a.data;
  const b = addChild(m, r); m = b.data;
  const c = addChild(m, r); m = c.data;
  m = addChild(m, b.newId).data;
  m = addChild(m, b.newId).data;
  return { ...m, layout };
}
const porId = (nos: ReturnType<typeof layoutMindMap>) => Object.fromEntries(nos.map(n => [n.id, n]));
const filhosDaRaiz = (m: MapaMentalData) => getChildren(m, m.rootId).map(n => n.id);

console.log('--- organograma de cima para baixo ---');
{
  const m = arvore('org');
  const nos = porId(layoutMindMap(m));
  const raiz = nos[m.rootId];
  const [a, b, c] = filhosDaRaiz(m).map(id => nos[id]);
  eq([a.y > raiz.y + raiz.height, b.y > raiz.y + raiz.height, c.y > raiz.y + raiz.height], [true, true, true], 'os filhos ficam ABAIXO da raiz');
  eq([a.y === b.y, b.y === c.y], [true, true], 'irmãos na mesma fileira');
  eq(a.x + a.width <= b.x && b.x + b.width <= c.x, true, 'irmãos não se sobrepõem, da esquerda para a direita');
  // A raiz fica centrada na faixa dos filhos.
  const centroFilhos = (a.x + (c.x + c.width)) / 2;
  const centroRaiz = raiz.x + raiz.width / 2;
  eq(Math.abs(centroFilhos - centroRaiz) < 1, true, 'a raiz está centrada sobre os filhos');
  // Os netos ficam abaixo do filho do meio e centrados nele.
  const netos = getChildren(m, b.id).map(n => nos[n.id]);
  eq(netos.every(n => n.y > b.y + b.height), true, 'netos abaixo do pai');
  const centroNetos = (netos[0].x + (netos[1].x + netos[1].width)) / 2;
  eq(Math.abs(centroNetos - (b.x + b.width / 2)) < 1, true, 'e centrados nele');
  eq(nos[a.id].depth, 1, 'profundidade 1 no primeiro nível');
  eq(netos[0].depth, 2, 'profundidade 2 nos netos');
}

console.log('--- organograma deitado tem a geometria da árvore ---');
{
  const org = porId(layoutMindMap(arvore('org-right')));
  const arv = porId(layoutMindMap(arvore('logical')));
  // Mesma árvore, ids diferentes entre as duas montagens: compara por posição relativa à raiz.
  const relativo = (nos: Record<string, { x: number; y: number }>, rootId: string) =>
    Object.values(nos).map(n => [Math.round(n.x - nos[rootId].x), Math.round(n.y - nos[rootId].y)]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const mOrg = arvore('org-right'); const mArv = arvore('logical');
  eq(relativo(porId(layoutMindMap(mOrg)), mOrg.rootId), relativo(porId(layoutMindMap(mArv)), mArv.rootId), 'org-right e logical colocam os nós nos mesmos lugares');
  void org; void arv;
}

console.log('--- o que distingue um organograma ---');
eq(['org', 'org-right'].map(l => ehOrganograma(l as never)), [true, true], 'os dois são organograma');
eq(['map', 'logical', 'right', undefined].map(l => ehOrganograma(l as never)), [false, false, false, false], 'os outros não');
eq(direcaoDoLayout('org'), 'vertical', 'org cresce para baixo');
eq(['org-right', 'map', 'logical', undefined].map(l => direcaoDoLayout(l as never)), ['horizontal', 'horizontal', 'horizontal', 'horizontal'], 'todo o resto cresce para o lado');

console.log('--- o servidor aceita os layouts novos ---');
{
  // Sem isto o compartilhamento rebaixa o organograma para "map" em silêncio.
  const fonte = readFileSync(new URL('../src/lib/mapas-mentais-compartilhamento.ts', import.meta.url), 'utf8');
  const m = fonte.match(/const LAYOUTS = new Set[^\n]*\[([^\]]*)\]/);
  const aceitos = (m?.[1] ?? '').match(/'([a-z-]+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];
  eq(aceitos.includes('org') && aceitos.includes('org-right'), true, `o Set do servidor inclui org e org-right (tem: ${aceitos.join(', ')})`);
}

console.log('--- os modelos ---');
eq(MODELOS_DE_MAPA.length, 10, 'são dez modelos');
eq(new Set(MODELOS_DE_MAPA.map(m => m.id)).size, 10, 'com ids únicos');
eq(MODELOS_DE_MAPA.every(m => m.nome && m.descricao && m.raiz && m.galhos.length >= 3), true, 'todos com nome, descrição, raiz e pelo menos três ramos');
eq(MODELOS_DE_MAPA.some(m => m.layout === 'org'), true, 'pelo menos um nasce em organograma');
eq(MODELOS_DE_MAPA.filter(m => m.categoria === 'viagens').length >= 3, true, 'pelo menos três são de viagens: é o trabalho de quem usa');
for (const modelo of MODELOS_DE_MAPA) {
  const mapa = construirDoModelo(modelo);
  const nos = Object.values(mapa.nodes);
  const ids = new Set(nos.map(n => n.id));
  const orfaos = nos.filter(n => n.parentId !== null && !ids.has(n.parentId));
  const raiz = mapa.nodes[mapa.rootId];
  const saneado = sanitizeMap(mapa);
  eq([orfaos.length, raiz?.text, mapa.layout, mapa.theme], [0, modelo.raiz, modelo.layout, modelo.theme], `${modelo.nome}: sem órfão, raiz certa, layout e tema do modelo`);
  eq(Object.keys(saneado.nodes).length, nos.length, `${modelo.nome}: sanitizeMap não descarta nó nenhum`);
  // Todo nó tem lugar no desenho, em todos os layouts — um modelo não pode
  // nascer com nó invisível.
  for (const layout of ['map', 'logical', 'org', 'org-right'] as const) {
    const desenhados = layoutMindMap({ ...saneado, layout }).length;
    if (desenhados !== nos.length) eq(desenhados, nos.length, `${modelo.nome} em ${layout}: todo nó é desenhado`);
  }
}
total++; console.log('PASS  todo modelo desenha todos os nós nos quatro layouts');
eq(construirDoModelo(modeloPorId('swot')!, 'Minha análise').nome, 'Minha análise', 'o nome dado vence o nome do modelo');
eq(construirDoModelo(modeloPorId('swot')!).nome, 'Análise SWOT', 'sem nome, fica o do modelo');
eq(modeloPorId('nao-existe'), undefined, 'modelo desconhecido não inventa nada');
{
  // Duas montagens do mesmo modelo não compartilham ids: cada mapa é seu.
  const a = construirDoModelo(modeloPorId('okr')!); const b = construirDoModelo(modeloPorId('okr')!);
  const comuns = Object.keys(a.nodes).filter(id => id in b.nodes);
  eq(comuns.length, 0, 'montar duas vezes dá ids diferentes');
}

console.log(`\n${total - falhas}/${total} testes do layout e dos modelos passaram`);
if (falhas > 0) process.exit(1);
