import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM, buildProdutoPayload } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json(null, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { id } = await params;
  const { rows } = await pool.query('SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (rows.length === 0) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(rows[0].data);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { id } = await params;
  const grupo = await req.json();
  grupo.updated_at = new Date().toISOString();
  await pool.query(
    `INSERT INTO grupos (id, tenant_id, grp_id, origem_destino, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       grp_id = $3, origem_destino = $4, data = $5, updated_at = $7`,
    [id, tenantId, grupo.grp_id || '', grupo.origem_destino || '',
     JSON.stringify(grupo), grupo.created_at, grupo.updated_at]
  );

  // CRM: re-publish the full product snapshot on every meaningful update.
  if (grupo.periodos?.length > 0) {
    emitirEventoCRM(
      'PRODUTO_PUBLICADO',
      { ...buildProdutoPayload(grupo), atualizado: true },
      { tenantId },
    );
  }

  return NextResponse.json(grupo);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { id } = await params;
  await pool.query('DELETE FROM grupos WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

  // CRM: signal that the product is no longer available.
  emitirEventoCRM('PRODUTO_DESPUBLICADO', { grupo_id: id }, { tenantId });

  return NextResponse.json({ ok: true });
}
