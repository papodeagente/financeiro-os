/**
 * O nome que a pessoa reconhece para cada plataforma de pagamento, e a
 * etiqueta que diz de onde veio um recebimento.
 *
 * Pedido do Bruno (05/10/2026): "Ao receber um pagamento pelas integrações,
 * coloque uma etiqueta dizendo de qual plataforma veio." A conta a receber
 * criada pela integração já grava `plataforma_origem` (o id: hotmart, asaas,
 * pagarme); faltava a tela mostrar.
 *
 * Arquivo sem dependência de adapter: roda no navegador sem puxar código de
 * servidor (credencial, cofre).
 */

export const NOME_DA_PLATAFORMA: Readonly<Record<string, string>> = {
  hotmart: 'Hotmart',
  asaas: 'Asaas',
  pagarme: 'Pagar.me',
};

/** O id da plataforma de onde a conta veio, ou null se não veio de integração. */
export function plataformaDaConta(conta: { plataforma_origem?: unknown } | null | undefined): string | null {
  const id = String(conta?.plataforma_origem ?? '').trim().toLowerCase();
  return id || null;
}

/** "Hotmart", "Pagar.me". Plataforma que ainda não está na lista aparece com inicial maiúscula. */
export function nomeDaPlataforma(id: string): string {
  const chave = String(id ?? '').trim().toLowerCase();
  if (!chave) return '';
  return NOME_DA_PLATAFORMA[chave] ?? chave.charAt(0).toUpperCase() + chave.slice(1);
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A descrição sem o " · hotmart" que a integração acrescenta, para quando a
 * etiqueta já está do lado dizendo a mesma coisa. O "(2/3)" da parcela fica.
 */
export function descricaoSemPlataforma(descricao: string, plataforma: string | null): string {
  const texto = String(descricao ?? '');
  if (!plataforma) return texto;
  const nomes = [plataforma, nomeDaPlataforma(plataforma)].map(escapar).join('|');
  return texto.replace(new RegExp(`\\s*·\\s*(?:${nomes})(?=\\s*(?:\\(\\d+/\\d+\\))?\\s*$)`, 'i'), '').trim();
}

/** Para onde só cabe texto (fluxo de caixa, exportação): "Pacote Gramado (2/3) · Hotmart". */
export function descricaoComPlataforma(descricao: string, plataforma: string | null): string {
  const limpa = descricaoSemPlataforma(descricao, plataforma);
  if (!plataforma) return limpa;
  return limpa ? `${limpa} · ${nomeDaPlataforma(plataforma)}` : nomeDaPlataforma(plataforma);
}
