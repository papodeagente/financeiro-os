/**
 * Transparência sobre qualquer cor do sistema.
 *
 * Concatenar alfa em hex (`cor + '20'`) só funciona quando a cor é hex. Com
 * token (`var(--fin-accent)`) vira CSS inválido e o navegador descarta a
 * regra em silêncio: foi assim que o anel do EmptyState nunca apareceu.
 * color-mix aceita hex, token e qualquer outra cor.
 */
export function comAlfa(cor: string, porcento: number): string {
  const p = Math.max(0, Math.min(100, Math.round(porcento)));
  return `color-mix(in srgb, ${cor} ${p}%, transparent)`;
}
