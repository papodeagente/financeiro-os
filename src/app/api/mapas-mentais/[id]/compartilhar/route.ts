import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession, type SessionPayload } from '@/lib/auth';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import { podeExportar } from '@/lib/permissoes';
import {
  gerarTokenCompartilhamento,
  idMapaMentalValido,
  MAPA_MENTAL_SHARE_SECRET_VERSION,
  novoIdMapaMental,
  origemMutacaoPermitida,
  requisicaoJson,
} from '@/lib/mapas-mentais-compartilhamento';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};
const MAX_BODY_BYTES = 2_048;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function tenantDaSessao(session: SessionPayload): string {
  return session.impersonatingTenantId || session.tenantId || '';
}

function dataIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function respostaCompartilhamento(token: string, allowCopy: boolean, createdAt: unknown) {
  const baseUrl = getCanonicalBaseUrl().replace(/\/+$/, '');
  const encodedToken = encodeURIComponent(token);
  return {
    publicUrl: `${baseUrl}/mapas-mentais/publico/${encodedToken}`,
    copyUrl: allowCopy
      ? `${baseUrl}/planejamento/mapas-mentais/importar/${encodedToken}`
      : null,
    allowCopy,
    createdAt: dataIso(createdAt),
  };
}

function tokenPersistidoValido(id: unknown, tokenHash: unknown, secret: unknown) {
  if (typeof id !== 'string' || typeof tokenHash !== 'string' || typeof secret !== 'string') return null;
  const derivado = gerarTokenCompartilhamento(id, secret);
  return derivado.tokenHash === tokenHash ? derivado : null;
}

async function sessaoAutorizada() {
  const session = await getSession();
  const tenantId = session ? tenantDaSessao(session) : '';
  return session && tenantId ? { session, tenantId } : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await sessaoAutorizada();
    if (!auth) return json({ error: 'Não autenticado' }, 401);
    if (!podeExportar(auth.session)) return json({ error: 'Sem permissão para compartilhar ou exportar' }, 403);
    const { id } = await params;
    if (!idMapaMentalValido(id)) return json({ error: 'ID inválido' }, 400);
    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);

    const { rows } = await pool.query(
      `SELECT c.id, c.token_hash, c.allow_copy, c.created_at, s.secret_value
         FROM mapas_mentais m
         LEFT JOIN mapas_mentais_compartilhamentos c
           ON c.mapa_id = m.id
          AND c.tenant_id = m.tenant_id
          AND c.revoked_at IS NULL
         LEFT JOIN mapas_mentais_compartilhamento_segredos s
           ON s.version = c.secret_version
        WHERE m.id = $1 AND m.tenant_id = $2
        LIMIT 1`,
      [id, auth.tenantId],
    );
    if (rows.length === 0) return json({ error: 'Mapa não encontrado' }, 404);
    const active = rows[0].created_at !== null && rows[0].created_at !== undefined;
    if (!active) {
      return json({
        active: false,
        publicUrl: null,
        copyUrl: null,
        allowCopy: false,
        createdAt: null,
      });
    }
    const derivado = tokenPersistidoValido(rows[0].id, rows[0].token_hash, rows[0].secret_value);
    if (!derivado) {
      return json({ error: 'O compartilhamento precisa ser revogado e criado novamente' }, 409);
    }
    return json({ active: true, ...respostaCompartilhamento(
      derivado.token,
      rows[0].allow_copy === true,
      rows[0].created_at,
    ) });
  } catch {
    return json({ error: 'Não foi possível consultar o compartilhamento' }, 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await sessaoAutorizada();
    if (!auth) return json({ error: 'Não autenticado' }, 401);
    if (!podeExportar(auth.session)) return json({ error: 'Sem permissão para compartilhar ou exportar' }, 403);
    if (!origemMutacaoPermitida(req, getCanonicalBaseUrl())) {
      return json({ error: 'Origem da requisição não permitida' }, 403);
    }
    if (!requisicaoJson(req)) return json({ error: 'Content-Type deve ser application/json' }, 415);
    const { id } = await params;
    if (!idMapaMentalValido(id)) return json({ error: 'ID inválido' }, 400);

    const declaredLength = req.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
      return json({ error: 'Payload muito grande' }, 413);
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return json({ error: 'Payload muito grande' }, 413);
      }
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Payload inválido' }, 400);
    }
    const keys = Object.keys(body);
    if (keys.some(key => key !== 'allowCopy')) return json({ error: 'Payload inválido' }, 400);
    const allowCopyRaw = (body as { allowCopy?: unknown }).allowCopy;
    if (allowCopyRaw !== undefined && typeof allowCopyRaw !== 'boolean') {
      return json({ error: 'allowCopy deve ser booleano' }, 400);
    }
    const allowCopy = allowCopyRaw === true;

    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);
    const client = await pool.connect();
    let createdAt: unknown;
    let token = '';
    let status = 200;
    try {
      await client.query('BEGIN');
      const mapa = await client.query(
        `SELECT id FROM mapas_mentais WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, auth.tenantId],
      );
      if (mapa.rows.length === 0) {
        await client.query('ROLLBACK');
        return json({ error: 'Mapa não encontrado' }, 404);
      }

      const existente = await client.query(
        `SELECT c.id, c.token_hash, c.allow_copy, c.created_at, s.secret_value
           FROM mapas_mentais_compartilhamentos c
           JOIN mapas_mentais_compartilhamento_segredos s
             ON s.version = c.secret_version
          WHERE c.mapa_id = $1 AND c.tenant_id = $2 AND c.revoked_at IS NULL
          LIMIT 1
          FOR UPDATE OF c`,
        [id, auth.tenantId],
      );
      if (existente.rows.length > 0) {
        const derivado = tokenPersistidoValido(
          existente.rows[0].id,
          existente.rows[0].token_hash,
          existente.rows[0].secret_value,
        );
        if (!derivado) {
          await client.query('ROLLBACK');
          return json({ error: 'O compartilhamento precisa ser revogado e criado novamente' }, 409);
        }
        token = derivado.token;
        createdAt = existente.rows[0].created_at;
        if (existente.rows[0].allow_copy !== allowCopy) {
          await client.query(
            `UPDATE mapas_mentais_compartilhamentos
                SET allow_copy = $1
              WHERE id = $2`,
            [allowCopy, existente.rows[0].id],
          );
        }
      } else {
        const shareId = novoIdMapaMental();
        const segredo = await client.query(
          `SELECT secret_value
             FROM mapas_mentais_compartilhamento_segredos
            WHERE version = $1`,
          [MAPA_MENTAL_SHARE_SECRET_VERSION],
        );
        if (segredo.rows.length === 0) throw new Error('Segredo de compartilhamento indisponível.');
        const derivado = gerarTokenCompartilhamento(shareId, segredo.rows[0].secret_value);
        token = derivado.token;
        const inserted = await client.query(
          `INSERT INTO mapas_mentais_compartilhamentos
             (id, tenant_id, mapa_id, token_hash, secret_version, allow_copy, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING created_at`,
          [
            shareId,
            auth.tenantId,
            id,
            derivado.tokenHash,
            MAPA_MENTAL_SHARE_SECRET_VERSION,
            allowCopy,
            auth.session.userId,
          ],
        );
        createdAt = inserted.rows[0]?.created_at;
        status = 201;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return json(respostaCompartilhamento(token, allowCopy, createdAt), status);
  } catch {
    return json({ error: 'Não foi possível criar o compartilhamento' }, 500);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await sessaoAutorizada();
    if (!auth) return json({ error: 'Não autenticado' }, 401);
    if (!podeExportar(auth.session)) return json({ error: 'Sem permissão para compartilhar ou exportar' }, 403);
    if (!origemMutacaoPermitida(_req, getCanonicalBaseUrl())) {
      return json({ error: 'Origem da requisição não permitida' }, 403);
    }
    const { id } = await params;
    if (!idMapaMentalValido(id)) return json({ error: 'ID inválido' }, 400);
    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mapa = await client.query(
        `SELECT id FROM mapas_mentais WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, auth.tenantId],
      );
      if (mapa.rows.length === 0) {
        await client.query('ROLLBACK');
        return json({ error: 'Mapa não encontrado' }, 404);
      }
      await client.query(
        `UPDATE mapas_mentais_compartilhamentos
            SET revoked_at = NOW()
          WHERE mapa_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
        [id, auth.tenantId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return json({ ok: true });
  } catch {
    return json({ error: 'Não foi possível revogar o compartilhamento' }, 500);
  }
}
