// Monta o link público da proposta.
//
// O domínio personalizado por agência foi removido do produto: a ativação
// dependia de emitir certificado SSL por domínio no servidor, e essa etapa
// deixou de existir. O link volta a ser sempre o domínio canônico, e o path
// /p/<slug> continua identificando a proposta.

// Base server-side.
//
// COOLIFY_URL pode vir como LISTA separada por vírgula quando a app tem mais
// de um domínio — canonical-hosts.ts já trata isso, e ignorar aqui produzia
// `https://fin.enturos.com,https://abc.sslip.io/p/xyz` como link do cliente.
export function getDefaultPublicBase(): string {
  const primeiro = (v: string | undefined) => v?.split(',')[0]?.trim() || '';
  return (
    primeiro(process.env.PUBLIC_APP_URL)
    || primeiro(process.env.COOLIFY_URL)
    || (process.env.COOLIFY_FQDN ? `https://${process.env.COOLIFY_FQDN.split(',')[0].trim()}` : '')
    || 'https://fin.enturos.com'
  ).replace(/\/+$/, '');
}

/**
 * Conserta um link já gravado que aponte para outro host.
 *
 * POR QUE PRECISA EXISTIR. As propostas criadas enquanto o domínio
 * personalizado existia gravaram `link_publico` naquele host, e esse valor
 * continua no banco. As telas copiam o campo gravado, não reconstroem o link —
 * então o produto seguiria ENTREGANDO ao cliente um endereço que vai morrer
 * junto com o certificado. Normalizar na leitura conserta sozinho, sem
 * migração e sem tocar no que já está salvo.
 *
 * `baseAtual` é a origem de onde a tela está rodando (window.location.origin
 * no cliente). Link de outra origem é reconstruído; link da própria origem
 * passa intacto.
 */
export function normalizarPropostaLink(
  linkGravado: string | null | undefined,
  propostaId: string,
  baseAtual?: string,
): string {
  const base = (baseAtual || getDefaultPublicBase()).replace(/\/+$/, '');
  const link = String(linkGravado ?? '').trim();
  if (!link) return buildPropostaLink(propostaId, base);
  try {
    if (new URL(link).origin === new URL(base).origin) return link;
  } catch {
    // Link gravado fora de forma: reconstruir é mais seguro que repassar.
  }
  return buildPropostaLink(propostaId, base);
}

// Monta link público da proposta.
//   - propostaId: id da proposta (slug usado em /p/[slug])
//   - fallbackBase: opcional, base a usar no cliente
//     (ex.: window.location.origin), onde process.env não existe
export function buildPropostaLink(propostaId: string, fallbackBase?: string): string {
  const base = (fallbackBase || getDefaultPublicBase()).replace(/\/+$/, '');
  return `${base}/p/${propostaId}`;
}
