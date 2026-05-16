// Helpers de layout pra renderizacao de propostas com suporte a
// blocos lado-a-lado (cols=2). Usado tanto no editor (canvas) quanto
// na view publica /p/[slug].

import type { SecaoProposta } from './crm-types';

// Agrupa secoes consecutivas em "rows" pra renderizacao:
//   - cols=1 (ou undefined): row contendo 1 secao (full-width)
//   - cols=2: tenta parear com a proxima cols=2 — 2 secoes lado-a-lado
//   - cols=2 orfa (sem par): renderiza full-width sozinha
//
// Preserva ordem original. Backwards compat — sem cols ou todos cols=1
// retorna 1 row por secao (comportamento atual).
export function groupIntoRows(secoes: SecaoProposta[]): SecaoProposta[][] {
  const rows: SecaoProposta[][] = [];
  let pending: SecaoProposta | null = null;
  for (const s of secoes) {
    if (s.cols === 2) {
      if (pending) {
        rows.push([pending, s]);
        pending = null;
      } else {
        pending = s;
      }
    } else {
      if (pending) {
        rows.push([pending]);
        pending = null;
      }
      rows.push([s]);
    }
  }
  if (pending) rows.push([pending]);
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
