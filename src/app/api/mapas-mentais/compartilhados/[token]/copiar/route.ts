import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import {
  duplicarMapaCompartilhado,
  hashTokenCompartilhamento,
  novoIdMapaMental,
  origemMutacaoPermitida,
  requisicaoJson,
  tokenPertenceAoCompartilhamento,
} from '@/lib/mapas-mentais-compartilhamento';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};
const MAX_BODY_BYTES = 64;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const session = await getSession();
    const tenantId = session?.impersonatingTenantId || session?.tenantId || '';
    if (!session || !tenantId) return json({ error: 'Não autenticado' }, 401);
    if (!origemMutacaoPermitida(_req, getCanonicalBaseUrl())) {
      return json({ error: 'Origem da requisição não permitida' }, 403);
    }
    if (!requisicaoJson(_req)) return json({ error: 'Content-Type deve ser application/json' }, 415);

    const declaredLength = _req.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
      return json({ error: 'Payload muito grande' }, 413);
    }
    try {
      const rawBody = await _req.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return json({ error: 'Payload muito grande' }, 413);
      }
      const body = JSON.parse(rawBody);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
        return json({ error: 'Payload inválido' }, 400);
      }
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    const { token } = await params;
    const tokenHash = hashTokenCompartilhamento(token);
    if (!tokenHash) return json({ error: 'Link inválido' }, 400);
    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT m.id, m.nome, m.data, c.id AS compartilhamento_id, s.secret_value
           FROM mapas_mentais_compartilhamentos c
           JOIN mapas_mentais m
             ON m.id = c.mapa_id AND m.tenant_id = c.tenant_id
           JOIN mapas_mentais_compartilhamento_segredos s
             ON s.version = c.secret_version
          WHERE c.token_hash = $1
            AND c.revoked_at IS NULL
            AND c.allow_copy = TRUE
          LIMIT 1
          FOR UPDATE OF c`,
        [tokenHash],
      );
      if (source.rows.length === 0) {
        await client.query('ROLLBACK');
        return json({ error: 'Link não encontrado, revogado ou sem permissão de cópia' }, 404);
      }
      if (!tokenPertenceAoCompartilhamento(
        token,
        source.rows[0].compartilhamento_id,
        source.rows[0].secret_value,
      )) {
        await client.query('ROLLBACK');
        return json({ error: 'Link não encontrado, revogado ou sem permissão de cópia' }, 404);
      }

      const novoId = novoIdMapaMental();
      const novo = duplicarMapaCompartilhado(
        source.rows[0].data,
        source.rows[0].id,
        source.rows[0].nome,
        novoId,
      );
      if (!novo) {
        await client.query('ROLLBACK');
        return json({ error: 'Link não encontrado, revogado ou sem permissão de cópia' }, 404);
      }

      await client.query(
        `INSERT INTO mapas_mentais
           (id, tenant_id, nome, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
        [novo.id, tenantId, novo.nome, JSON.stringify(novo)],
      );
      await client.query('COMMIT');
      return json({ id: novo.id, redirectUrl: `/planejamento/mapas-mentais/${novo.id}` }, 201);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return json({ error: 'Não foi possível copiar o mapa' }, 500);
  }
}
