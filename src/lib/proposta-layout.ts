// Helpers de layout pra renderizacao de propostas com suporte a
// blocos lado-a-lado (cols=2). Usado tanto no editor (canvas) quanto
// na view publica /p/[slug].

import type { SecaoProposta } from './crm-types';

// Agrupa secoes consecutivas em "rows" pra renderizacao:
//   - cols=1 (ou undefined): row contendo 1 secao (full-width)
//   - cols=N (2/3/4): agrupa ate N secoes consecutivas com o mesmo cols
//     em uma row lado-a-lado (50%/33%/25% cada)
//   - secoes cols=N orfas (sem N-1 vizinhos do mesmo cols): renderiza
//     sozinhas ocupando o espaco da row (mantem cols como style hint)
//
// Preserva ordem original. Backwards compat — sem cols ou todos cols=1
// retorna 1 row por secao (comportamento atual).
export function groupIntoRows(secoes: SecaoProposta[]): SecaoProposta[][] {
  const rows: SecaoProposta[][] = [];
  let i = 0;
  while (i < secoes.length) {
    const s = secoes[i];
    const n = s.cols && s.cols > 1 ? s.cols : 1;
    if (n === 1) {
      rows.push([s]);
      i++;
      continue;
    }
    // Tenta agrupar ate N secoes consecutivas com cols === n
    const group: SecaoProposta[] = [s];
    let j = i + 1;
    while (j < secoes.length && group.length < n && secoes[j].cols === n) {
      group.push(secoes[j]);
      j++;
    }
    rows.push(group);
    i = j;
  }
  return rows;
}

// Helper: verifica se uma secao deve ser oculta no viewport dado.
// Aplicado em editor (com overlay visual indicando "oculto em X") e
// em /p/[slug] (nao renderiza).
export function isHiddenInViewport(
  secao: SecaoProposta,
  viewport: 'desktop' | 'tablet' | 'mobile',
): boolean {
  return secao.responsive?.hideOn?.includes(viewport) ?? false;
}
