// Server-only: quem pode servir uma proposta pública.
//
// O domínio personalizado por agência foi removido do produto, então só o
// host canônico serve proposta. Esta verificação continua existindo mesmo com
// o middleware já redirecionando host estranho: ela é a segunda tranca, e uma
// rota que escape do matcher do middleware não pode ficar sem nenhuma.

import pool from './db';
import { isCanonicalHost, extractHost } from './canonical-hosts';

// Host autorizado a servir proposta pública.
//   - Sem header de host (CLI, chamada interna): autorizado.
//   - Host canônico: autorizado.
//   - Qualquer outro: não.
export function isHostAuthorizedForProposta(req: Request): boolean {
  const host = extractHost(req);
  if (!host) return true; // sem host header — assume canônico (CLI/local)
  return isCanonicalHost(host);
}

// Carrega a proposta pelo slug, já checando que o host pode servi-la.
export async function resolvePropostaForHost(
  req: Request,
  slug: string,
): Promise<{ ok: false } | { ok: true; data: unknown; tenantId: string }> {
  if (!pool) return { ok: false };
  if (!/^[\w-]+$/.test(slug) || slug.length < 10) return { ok: false };
  if (!isHostAuthorizedForProposta(req)) return { ok: false };

  const { rows } = await pool.query(
    `SELECT tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
    [slug],
  );
  if (rows.length === 0) return { ok: false };

  return { ok: true, data: rows[0].data, tenantId: rows[0].tenant_id };
}
