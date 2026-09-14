import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import {
  hashTokenCompartilhamento,
  prepararMapaCompartilhado,
  tokenPertenceAoCompartilhamento,
} from '@/lib/mapas-mentais-compartilhamento';

const PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS });
}

function dataIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const tokenHash = hashTokenCompartilhamento(token);
    if (!tokenHash) return json({ error: 'Link inválido' }, 400);
    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);

    const { rows } = await pool.query(
      `SELECT m.id, m.nome, m.data, c.id AS compartilhamento_id,
              c.allow_copy, c.created_at, s.secret_value
         FROM mapas_mentais_compartilhamentos c
         JOIN mapas_mentais m
           ON m.id = c.mapa_id AND m.tenant_id = c.tenant_id
         JOIN mapas_mentais_compartilhamento_segredos s
           ON s.version = c.secret_version
        WHERE c.token_hash = $1 AND c.revoked_at IS NULL
        LIMIT 1`,
      [tokenHash],
    );
    if (rows.length === 0) return json({ error: 'Link não encontrado ou revogado' }, 404);
    if (!tokenPertenceAoCompartilhamento(
      token,
      rows[0].compartilhamento_id,
      rows[0].secret_value,
    )) {
      return json({ error: 'Link não encontrado ou revogado' }, 404);
    }

    const mapa = prepararMapaCompartilhado(rows[0].data, rows[0].id, rows[0].nome);
    if (!mapa) return json({ error: 'Link não encontrado ou revogado' }, 404);
    const baseUrl = getCanonicalBaseUrl().replace(/\/+$/, '');
    const encodedToken = encodeURIComponent(token);
    const allowCopy = rows[0].allow_copy === true;
    return json({
      mapa,
      allowCopy,
      publicUrl: `${baseUrl}/mapas-mentais/publico/${encodedToken}`,
      copyUrl: allowCopy
        ? `${baseUrl}/planejamento/mapas-mentais/importar/${encodedToken}`
        : null,
      createdAt: dataIso(rows[0].created_at),
    });
  } catch {
    return json({ error: 'Não foi possível abrir o mapa compartilhado' }, 500);
  }
}
