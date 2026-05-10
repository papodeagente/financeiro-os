import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM, buildProdutoPayload } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();
  const { rows } = await pool.query('SELECT data FROM grupos WHERE tenant_id = $1 ORDER BY updated_at DESC', [tenantId]);
  return NextResponse.json(rows.map(r => r.data));
}

export async function POST(req: NextRequest) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const grupo = await req.json();
  grupo.updated_at = new Date().toISOString();
  await pool.query(
    `INSERT INTO grupos (id, tenant_id, grp_id, origem_destino, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       grp_id = $3, origem_destino = $4, data = $5, updated_at = $7`,
    [grupo.id, tenantId, grupo.grp_id || '', grupo.origem_destino || '',
     JSON.stringify(grupo), grupo.created_at, grupo.updated_at]
  );

  // CRM: publish the product (full snapshot — price tree, dates, hotels,
  // destinations) so it can be attached to a deal in the CRM.
  emitirEventoCRM('PRODUTO_PUBLICADO', buildProdutoPayload(grupo), { tenantId });

  return NextResponse.json(grupo);
}
