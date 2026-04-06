import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const grupos = await req.json();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const grupo of grupos) {
      grupo.updated_at = grupo.updated_at || new Date().toISOString();
      await client.query(
        `INSERT INTO grupos (id, tenant_id, grp_id, origem_destino, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           grp_id = $3, origem_destino = $4, data = $5, updated_at = $7`,
        [grupo.id, tenantId, grupo.grp_id || '', grupo.origem_destino || '',
         JSON.stringify(grupo), grupo.created_at, grupo.updated_at]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return NextResponse.json({ synced: grupos.length });
}
