/**
 * Atalhos por endereço: a visão geral leva direto ao que se resolve.
 *
 *   ?nova=1              abre o formulário de lançamento
 *   ?status=ATRASADO     já abre a lista filtrada
 *   ?sem_fornecedor=1    contas a pagar sem fornecedor
 *
 * Lido no navegador, depois da primeira renderização (a página é gerada
 * estática). O `nova` sai do endereço depois de usado: recarregar a página
 * não pode reabrir um formulário que a pessoa já fechou.
 */
export function lerAtalhos(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function consumirAtalho(chave: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(chave)) return;
  url.searchParams.delete(chave);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
