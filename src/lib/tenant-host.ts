// Server-only: quem pode servir uma proposta pública.
//
// O domínio personalizado por agência foi removido do produto, então só o
// host canônico serve proposta. Esta verificação continua existindo mesmo com
// o middleware já redirecionando host estranho: ela é a segunda tranca, e uma
// rota que escape do matcher do middleware não pode ficar sem nenhuma.

import pool from './db';
import { isCanonicalHost, extractHost } from './canonical-hosts';
import { resolverPropostaPublica, type Consulta } from './proposta-publica';

// Host autorizado a servir proposta pública.
//   - Sem header de host (CLI, chamada interna): autorizado.
//   - Host canônico: autorizado.
//   - Qualquer outro: não.
export function isHostAuthorizedForProposta(req: Request): boolean {
  const host = extractHost(req);
  if (!host) return true; // sem host header — assume canônico (CLI/local)
  return isCanonicalHost(host);
}

// Carrega a proposta pelo endereço público (token, ou id só para propostas
// antigas dentro do prazo), já checando que o host pode servi-la. `data` é o
// registro inteiro, para uso do servidor; para o navegador, use paraPublico.
export async function resolvePropostaForHost(
  req: Request,
  slug: string,
): Promise<{ ok: false } | { ok: true; id: string; data: Record<string, unknown>; tenantId: string; linkPublico: string | null }> {
  if (!pool) return { ok: false };
  if (!isHostAuthorizedForProposta(req)) return { ok: false };
  const r = await resolverPropostaPublica(pool as unknown as Consulta, slug);
  if (!r) return { ok: false };
  return { ok: true, id: r.id, data: r.data, tenantId: r.tenantId, linkPublico: r.linkPublico };
}
