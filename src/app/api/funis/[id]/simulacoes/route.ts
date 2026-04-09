import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

/**
 * GET /api/funis/[id]/simulacoes
 *
 * Lista as últimas 50 simulações de um funil, ordenadas por data DESC.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM funis_simulacoes
       WHERE funil_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [id, tenantId],
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
