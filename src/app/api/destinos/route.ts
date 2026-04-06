import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { createCrudHandlers } from '@/lib/crud-api';
import { getTenantId } from '@/lib/tenant';

const crud = createCrudHandlers('destinos', ['nome', 'pais']);
export const POST = crud.POST;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q) return crud.GET();

  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM destinos WHERE tenant_id = $1 AND (LOWER(nome) LIKE $2 OR LOWER(pais) LIKE $2) ORDER BY nome ASC LIMIT 20`,
      [tenantId, `%${q.toLowerCase()}%`]
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
