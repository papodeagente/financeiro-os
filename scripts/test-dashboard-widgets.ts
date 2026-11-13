/**
 * Catálogo dos widgets do Dashboard financeiro (src/lib/dashboard-widgets.ts).
 * A escolha vem do navegador e do banco: precisa sair sempre válida, sem id
 * inventado, sem repetição e na ordem que a pessoa deu.
 */
import {
  CATALOGO, IDS_DOS_WIDGETS, WIDGETS_PADRAO, normalizarSelecao, widgetsEscondidos,
} from '../src/lib/dashboard-widgets.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

eq(IDS_DOS_WIDGETS.every(id => CATALOGO[id]?.id === id), true, 'todo id do catálogo tem ficha com o mesmo id');
eq(new Set(IDS_DOS_WIDGETS).size, IDS_DOS_WIDGETS.length, 'nenhum id repetido no catálogo');
eq(WIDGETS_PADRAO.every(id => IDS_DOS_WIDGETS.includes(id)), true, 'o padrão só usa widgets do catálogo');
eq(IDS_DOS_WIDGETS.length >= 15, true, 'todos os itens do dashboard viraram widget (15)');

eq(normalizarSelecao(null), null, 'nunca escolheu → null (usa o padrão)');
eq(normalizarSelecao('serie'), null, 'texto solto não é escolha');
eq(normalizarSelecao({ a: 1 }), null, 'objeto não é escolha');
eq(normalizarSelecao([]), [], 'lista vazia é escolha válida (tudo oculto)');
eq(normalizarSelecao(['cascata', 'serie']), ['cascata', 'serie'], 'mantém a ordem dada');
eq(normalizarSelecao(['serie', 'serie', 'cascata']), ['serie', 'cascata'], 'tira repetição');
eq(normalizarSelecao(['serie', 'inventado', 3, null, 'agenda']), ['serie', 'agenda'], 'descarta id inventado e o que não é texto');

eq(widgetsEscondidos(['serie']).includes('serie'), false, 'escondidos não inclui o que está ligado');
eq(widgetsEscondidos([]).length, IDS_DOS_WIDGETS.length, 'sem nada ligado, todos ficam disponíveis');

console.log(`\n${total - falhas}/${total} testes do catálogo de widgets passaram`);
if (falhas > 0) process.exit(1);
