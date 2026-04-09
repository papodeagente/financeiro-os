import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { createCrudHandlers } from '@/lib/crud-api';

const crud = createCrudHandlers('itens_venda', ['venda_id', 'fornecedor_id', 'status']);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const vendaId = searchParams.get('venda_id');

  if (!vendaId) return crud.GET();

  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM itens_venda WHERE venda_id = $1 AND tenant_id = $2 ORDER BY sequencia ASC`,
      [vendaId, tenantId],
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = crud.POST;
