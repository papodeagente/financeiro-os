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
  ehOrganograma, direcaoDoLayout, eixoDeIrmaos, estiloDaLigacao, handlesDaLigacao,
  type MapaMentalData,
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

/** Raiz com cinco ramos; o terceiro com dois filhos. */
function cincoRamos(layout: MapaMentalData['layout']): MapaMentalData {
  let m = createMindMap('t'); const r = m.rootId;
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { const a = addChild(m, r); m = a.data; ids.push(a.newId); }
  m = addChild(m, ids[2]).data; m = addChild(m, ids[2]).data;
  return { ...m, layout };
}
const dist = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.height / 2) - (b.y + b.height / 2));

console.log('--- radial: ramos em círculo em volta da ideia central ---');
{
  const m = cincoRamos('radial');
  const nos = porId(layoutMindMap(m)); const raiz = nos[m.rootId];
  const ramos = filhosDaRaiz(m).map(id => nos[id]);
  const raios = ramos.map(n => Math.round(dist(n, raiz)));
  eq(raios.every(r => Math.abs(r - raios[0]) < 2), true, `os cinco ramos estão à mesma distância da raiz (${raios[0]}px)`);
  // Ângulos distintos: nenhum par de ramos no mesmo lugar.
  const angulos = ramos.map(n => Math.atan2((n.y + n.height / 2) - (raiz.y + raiz.height / 2), (n.x + n.width / 2) - (raiz.x + raiz.width / 2)));
  const pares = angulos.flatMap((a, i) => angulos.slice(i + 1).map(b => Math.abs(a - b)));
  eq(pares.every(d => d > 0.3), true, 'os ramos não se amontoam: ângulos distintos');
  const netos = getChildren(m, ramos[2].id).map(n => nos[n.id]);
  eq(netos.every(n => dist(n, raiz) > dist(ramos[2], raiz)), true, 'os netos ficam num anel mais afastado que o pai');
  eq(ramos.some(n => n.side === 'left') && ramos.some(n => n.side === 'right'), true, 'há ramos dos dois lados, como num mapa');
  // Ideia central comprida: o primeiro anel abre para não cobrir nem a raiz
  // nem o botão "+" que fica a ~40px à direita dela.
  const largo = cincoRamos('radial');
  const tamanhos: Record<string, { width: number; height: number }> = {};
  for (const id of Object.keys(largo.nodes)) tamanhos[id] = id === largo.rootId ? { width: 280, height: 44 } : { width: 150, height: 36 };
  const nosL = porId(layoutMindMap(largo, tamanhos)); const raizL = nosL[largo.rootId];
  const zona = { x: raizL.x - 44, y: raizL.y - 8, width: raizL.width + 88, height: raizL.height + 16 };
  const encosta = (n: typeof raizL) => n.x < zona.x + zona.width && n.x + n.width > zona.x && n.y < zona.y + zona.height && n.y + n.height > zona.y;
  eq(filhosDaRaiz(largo).map(id => nosL[id]).some(encosta), false, 'com raiz de 280px nenhum ramo encosta nela nem no botão "+"');
}

console.log('--- linha do tempo: eventos em ordem, alternando o lado do eixo ---');
{
  const m = cincoRamos('timeline');
  const nos = porId(layoutMindMap(m)); const raiz = nos[m.rootId];
  const ev = filhosDaRaiz(m).map(id => nos[id]);
  eq(ev.every(n => n.x > raiz.x + raiz.width), true, 'todos os eventos ficam à direita do título');
  eq(ev.every((n, i) => i === 0 || n.x > ev[i - 1].x + ev[i - 1].width), true, 'em ordem, da esquerda para a direita, sem sobrepor');
  const centroY = raiz.y + raiz.height / 2;
  const lados = ev.map(n => (n.y + n.height / 2) < centroY ? 'acima' : 'abaixo');
  eq(lados, ['acima', 'abaixo', 'acima', 'abaixo', 'acima'], 'alternam acima e abaixo do eixo');
  const netos = getChildren(m, ev[2].id).map(n => nos[n.id]);
  eq(netos.every(n => (n.y + n.height) <= ev[2].y + 1), true, 'o que está dentro de um evento acima do eixo cresce para cima');
}

console.log('--- espinha de peixe: o efeito à direita, causas em espinhas alternadas ---');
{
  const m = cincoRamos('fishbone');
  const nos = porId(layoutMindMap(m)); const raiz = nos[m.rootId];
  const fam = filhosDaRaiz(m).map(id => nos[id]);
  eq(fam.every(n => n.x + n.width < raiz.x), true, 'toda família de causa fica à esquerda do efeito');
  const centroY = raiz.y + raiz.height / 2;
  const lados = fam.map(n => (n.y + n.height / 2) < centroY ? 'cima' : 'baixo');
  eq(lados, ['cima', 'baixo', 'cima', 'baixo', 'cima'], 'as espinhas alternam em cima e embaixo da coluna');
  // Famílias do mesmo lado avançam em direção à cabeça (índices maiores mais à direita).
  eq(fam[0].x < fam[2].x && fam[2].x < fam[4].x, true, 'as de cima avançam para a cabeça, na ordem');
  const causas = getChildren(m, fam[2].id).map(n => nos[n.id]);
  eq(causas.every(c => c.x + c.width <= fam[2].x + fam[2].width + 1), true, 'as causas penduram para trás da família, não para a frente');
  eq(estiloDaLigacao('fishbone'), 'espinha', 'a espinha liga pela costela, não de caixa a caixa');
  // A geometria da costela viaja no nó: toca a dorsal (y da raiz) e o rótulo
  // da família por baixo (acima do eixo) ou por cima (abaixo).
  eq(fam.every(n => !!n.costela && n.costela.encaixeY === raiz.y + raiz.height / 2), true, 'toda família carrega a costela, encaixada na altura da raiz');
  eq(Math.abs(fam[0].costela!.pontaY - (fam[0].y + fam[0].height)) < 0.01 && Math.abs(fam[0].costela!.pontaX - (fam[0].x + fam[0].width / 2)) < 0.01, true, 'família acima: a costela toca o rótulo no meio da borda de baixo');
  eq(Math.abs(fam[1].costela!.pontaY - fam[1].y) < 0.01, true, 'família abaixo: toca no meio da borda de cima');
  eq(fam.every(n => n.costela!.encaixeX > n.costela!.pontaX && n.costela!.encaixeX < raiz.x), true, 'o encaixe fica entre o rótulo e a cabeça: a costela inclina para trás');
  eq(fam.every(n => n.costela!.caudaX < Math.min(...[...fam, ...causas].map(q => q.x))), true, 'a dorsal passa de tudo o que está atrás');
  // Cada causa carrega a costela da família e fica a 36px dela, pela direita.
  const cost = fam[2].costela!;
  const xNaCostela = (y: number) => cost.encaixeX + (cost.pontaX - cost.encaixeX) * ((y - cost.encaixeY) / (cost.pontaY - cost.encaixeY));
  eq(causas.every(c => c.costela === cost), true, 'as causas carregam a costela da família');
  eq(causas.every(c => Math.abs(xNaCostela(c.y + c.height / 2) - (c.x + c.width + 36)) < 0.5), true, 'a borda direita de cada causa fica a 36px da costela');
  eq(causas.every((c, i) => i === 0 || c.y > causas[i - 1].y + causas[i - 1].height), true, 'as causas não se empilham');
  // Handles: a costela sai da dorsal (lado esquerdo da raiz) e toca o rótulo
  // por baixo ou por cima; a causa encosta pela direita.
  eq(handlesDaLigacao('fishbone', 'left', raiz, fam[0]), { sourceHandle: 'ls', targetHandle: 'b' }, 'família acima entra por baixo');
  eq(handlesDaLigacao('fishbone', 'left', raiz, fam[1]), { sourceHandle: 'ls', targetHandle: 't' }, 'família abaixo entra por cima');
  eq(handlesDaLigacao('fishbone', 'left', fam[2], causas[0]), { sourceHandle: 'bs', targetHandle: 'r' }, 'a causa encosta pela direita');
  // Muitas causas numa família: a costela cresce para elas caberem.
  let cheio = cincoRamos('fishbone'); const fam2 = filhosDaRaiz(cheio)[2];
  for (let i = 0; i < 4; i++) cheio = addChild(cheio, fam2).data;
  const nosC = porId(layoutMindMap(cheio)); const causasC = getChildren(cheio, fam2).map(n => nosC[n.id]);
  eq(causasC.length, 6, 'seis causas na família');
  eq(causasC.every((c, i) => i === 0 || c.y > causasC[i - 1].y + causasC[i - 1].height), true, 'com seis causas, a costela cresce e nenhuma cobre a outra');
}

console.log('--- matriz: cada ramo vira uma coluna ---');
{
  const m = cincoRamos('matrix');
  const nos = porId(layoutMindMap(m)); const raiz = nos[m.rootId];
  const cab = filhosDaRaiz(m).map(id => nos[id]);
  eq(cab.every(n => Math.abs(n.y - cab[0].y) < 1), true, 'os cabeçalhos ficam na mesma linha');
  eq(cab.every(n => n.y > raiz.y + raiz.height), true, 'abaixo do título');
  eq(cab.every((n, i) => i === 0 || n.x >= cab[i - 1].x + cab[i - 1].width), true, 'colunas lado a lado, sem sobrepor');
  const cel = getChildren(m, cab[2].id).map(n => nos[n.id]);
  eq(cel.every(c => c.y > cab[2].y + cab[2].height && Math.abs(c.x - cab[2].x) < 1), true, 'as células empilham abaixo do cabeçalho, na mesma coluna');
  eq(cel[1].y > cel[0].y + cel[0].height, true, 'uma célula abaixo da outra');
  eq(direcaoDoLayout('matrix'), 'vertical', 'a matriz liga por cima e por baixo, como o organograma');
}

console.log('--- as decisões por layout ---');
eq(['radial', 'timeline', 'fishbone'].map(l => direcaoDoLayout(l as never)), ['livre', 'livre', 'livre'], 'radial, linha do tempo e espinha ligam pelo lado que encara o pai');
eq(['org', 'timeline', 'fishbone', 'radial'].map(l => eixoDeIrmaos(l as never)), ['x', 'x', 'x', 'x'], 'onde os irmãos ficam lado a lado, antes/depois é pela horizontal');
eq(['map', 'logical', 'matrix', 'org-right'].map(l => eixoDeIrmaos(l as never)), ['y', 'y', 'y', 'y'], 'onde empilham, é pela vertical');
eq(['org', 'org-right', 'matrix', 'timeline'].map(l => estiloDaLigacao(l as never)), ['cotovelo', 'cotovelo', 'cotovelo', 'cotovelo'], 'hierarquia e sequência ligam em cotovelo');
eq(['map', 'logical', 'radial'].map(l => estiloDaLigacao(l as never)), ['curva', 'curva', 'curva'], 'associação liga em curva');
{
  // Livre: o lado é o que encara o pai, medido pelas caixas.
  const pai = { x: 0, y: 0, width: 100, height: 40 };
  const direita = { x: 300, y: 0, width: 80, height: 30 };
  const esquerda = { x: -300, y: 0, width: 80, height: 30 };
  const acima = { x: 10, y: -200, width: 80, height: 30 };
  const abaixo = { x: 10, y: 200, width: 80, height: 30 };
  eq(handlesDaLigacao('radial', 'right', pai, direita), { sourceHandle: 'rs', targetHandle: 'l' }, 'filho à direita: sai pela direita, entra pela esquerda');
  eq(handlesDaLigacao('radial', 'right', pai, esquerda), { sourceHandle: 'ls', targetHandle: 'r' }, 'filho à esquerda: o espelho');
  eq(handlesDaLigacao('radial', 'right', pai, acima), { sourceHandle: 'ts', targetHandle: 'b' }, 'filho acima: sai por cima, entra por baixo');
  eq(handlesDaLigacao('radial', 'right', pai, abaixo), { sourceHandle: 'bs', targetHandle: 't' }, 'filho abaixo: sai por baixo, entra por cima');
  // Linha do tempo: do título para o evento sai pela direita e entra pelo lado
  // que encara o eixo — os trechos horizontais dos cotovelos somam o eixo.
  const eventoAcima = { x: 300, y: -120, width: 80, height: 30 };
  const eventoAbaixo = { x: 300, y: 120, width: 80, height: 30 };
  eq(handlesDaLigacao('timeline', 'right', pai, eventoAcima), { sourceHandle: 'rs', targetHandle: 'b' }, 'linha do tempo: evento acima do eixo entra por baixo');
  eq(handlesDaLigacao('timeline', 'right', pai, eventoAbaixo), { sourceHandle: 'rs', targetHandle: 't' }, 'linha do tempo: evento abaixo do eixo entra por cima');
  eq(handlesDaLigacao('timeline', 'right', pai, acima), { sourceHandle: 'ts', targetHandle: 'b' }, 'linha do tempo: dentro do evento empilha em pé');
  eq(handlesDaLigacao('org', 'right'), { sourceHandle: 'bs', targetHandle: 't' }, 'vertical ignora o lado: sempre por baixo');
  eq(handlesDaLigacao('map', 'left'), { sourceHandle: 'ls', targetHandle: 'r' }, 'horizontal segue o lado do ramo');
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
  eq(['org', 'org-right', 'radial', 'timeline', 'fishbone', 'matrix'].every(l => aceitos.includes(l)), true, `o Set do servidor inclui os seis layouts novos (tem: ${aceitos.join(', ')})`);
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
  for (const layout of ['map', 'logical', 'org', 'org-right', 'radial', 'timeline', 'fishbone', 'matrix'] as const) {
    const desenhados = layoutMindMap({ ...saneado, layout }).length;
    if (desenhados !== nos.length) eq(desenhados, nos.length, `${modelo.nome} em ${layout}: todo nó é desenhado`);
  }
}
total++; console.log('PASS  todo modelo desenha todos os nós nos oito layouts');
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
