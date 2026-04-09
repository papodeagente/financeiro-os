import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

/**
 * GET /api/funis/templates
 *
 * Retorna todos os templates de funil disponíveis. Templates são globais
 * (tenant_id = '') — seed pré-carregado por initDB() — mais os templates
 * salvos pelo próprio tenant.
 */
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM funis_templates
       WHERE tenant_id = '' OR tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId],
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
