/**
 * Com qual conta do CRM a conta do ecossistema pode se integrar (Bruno,
 * 05/11/2026): "o financeiro tem que estar integrado apenas com a tenant
 * 150002 do CRM", a conta da Entur (a conta operadora da Área Comercial).
 *
 * A conta do CRM está no fim do endereço que o Financeiro chama
 * (`…/api/integracao-financeiro/webhook/<conta>`). Para a conta do
 * ecossistema (perfil-da-conta.ts), qualquer outro endereço deixa a
 * integração RECUSADA: nada sai, nenhuma consulta roda e nenhum evento que
 * chegue é aceito (crm-integration.ts, getCrmConfig). As agências seguem
 * livres para se integrar com a conta delas.
 *
 * Só regra: nada de banco, nada de rede.
 */

/** A conta da Entur no CRM. A variável de ambiente existe só para teste e homologação. */
export const CRM_DO_ECOSSISTEMA = Number(process.env.CRM_TENANT_DO_ECOSSISTEMA) || 150002;

/** A conta do CRM no fim do endereço da integração, ou null. */
export function contaDoCrmNaUrl(url: unknown): number | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let caminho: string;
  try {
    caminho = new URL(url.trim()).pathname;
  } catch {
    return null;
  }
  const m = caminho.match(/\/api\/integracao-financeiro\/webhook\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

/** O endereço da integração com a conta da Entur, para a tela sugerir. */
export function urlDoCrmDoEcossistema(base = 'https://crm.enturos.com'): string {
  return `${base.replace(/\/+$/, '')}/api/integracao-financeiro/webhook/${CRM_DO_ECOSSISTEMA}`;
}

/**
 * null quando a integração pode valer; senão o motivo, em palavras. Só a
 * conta do ecossistema tem restrição. Sem endereço ainda não há integração a
 * recusar (a tela pede para preencher).
 */
export function motivoDaRecusa(perfil: 'agencia' | 'ecossistema', url: unknown): string | null {
  if (perfil !== 'ecossistema') return null;
  if (typeof url !== 'string' || !url.trim()) return null;
  const conta = contaDoCrmNaUrl(url);
  if (conta === CRM_DO_ECOSSISTEMA) return null;
  return `O financeiro da Entur só se integra com a conta ${CRM_DO_ECOSSISTEMA} do CRM${conta ? `, e o endereço aponta para a conta ${conta}` : ''}. Use ${urlDoCrmDoEcossistema()}.`;
}
