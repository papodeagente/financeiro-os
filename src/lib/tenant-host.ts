// Server-only helpers para mapear hostname → tenant_id usando
// Agencia.custom_proposta_domain. Não importar em middleware (usa
// pool de Postgres, incompatível com edge runtime).

import pool from './db';
import { isCanonicalHost, extractHost } from './canonical-hosts';

// Lookup do tenant cujo Agencia.custom_proposta_domain bate com o host.
// Retorna null se host canônico, vazio, ou não cadastrado.
export async function getTenantByCustomDomain(host: string): Promise<string | null> {
  const h = host.trim().toLowerCase();
  if (!h || isCanonicalHost(h)) return null;
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT tenant_id FROM agencia
     WHERE LOWER(TRIM(BOTH '/' FROM REGEXP_REPLACE(data->>'custom_proposta_domain', '^https?://', '', 'i'))) = $1
     LIMIT 1`,
    [h],
  );
  return rows.length > 0 ? rows[0].tenant_id : null;
}

// Validador unificado: dado o request e o tenant_id da proposta, retorna
// true se o host atual está autorizado a servir essa proposta.
//   - Host canônico (fin.enturos.com): sempre autorizado.
//   - Host customizado: precisa bater com o tenant do Agencia.
export async function isHostAuthorizedForProposta(
  req: Request,
  propostaTenantId: string | null | undefined,
): Promise<boolean> {
  const host = extractHost(req);
  if (!host) return true; // sem host header — assume canônico (CLI/local)
  if (isCanonicalHost(host)) return true;
  if (!propostaTenantId) return false;
  const tenant = await getTenantByCustomDomain(host);
  if (!tenant) return false; // hostname não cadastrado em nenhuma agencia
  return tenant === propostaTenantId;
}

// Versão que retorna 404-like resultado pra usar nas rotas API.
// Já checa que o slug existe E que o tenant do hostname (se custom)
// bate com o tenant da proposta.
export async function resolvePropostaForHost(
  req: Request,
  slug: string,
): Promise<{ ok: false } | { ok: true; data: unknown; tenantId: string }> {
  if (!pool) return { ok: false };
  if (!/^[\w-]+$/.test(slug) || slug.length < 10) return { ok: false };

  const { rows } = await pool.query(
    `SELECT tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
    [slug],
  );
  if (rows.length === 0) return { ok: false };
  const row = rows[0];

  const authorized = await isHostAuthorizedForProposta(req, row.tenant_id);
  if (!authorized) return { ok: false };

  return { ok: true, data: row.data, tenantId: row.tenant_id };
}
