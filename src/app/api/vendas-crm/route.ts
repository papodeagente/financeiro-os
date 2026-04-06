import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

const TABLE = 'vendas_crm';
const INDEX_COLS = ['cliente_id', 'vendedor_id', 'status'];

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
    return NextResponse.json(rows.map(r => r.data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const item = await req.json();
    if (!pool) return NextResponse.json(item);

    const tenantId = await getTenantId();
    const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
    const insertCols = ['id', 'tenant_id', 'data'];
    const insertVals = ['$1', '$2', '$3'];
    const updateSets = ['data = $3', 'updated_at = NOW()'];

    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 4;
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      insertCols.push(col);
      insertVals.push(`$${paramNum}`);
      updateSets.push(`${col} = $${paramNum}`);
    });

    await pool.query(
      `INSERT INTO ${TABLE} (${insertCols.join(', ')}, created_at, updated_at)
       VALUES (${insertVals.join(', ')}, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}`,
      paramValues
    );

    // CRM: emit sale created
    emitirEventoCRM('VENDA_CRIADA', {
      venda_id: item.id,
      cliente_id: item.cliente_id,
      vendedor_id: item.vendedor_id,
      grupo_id: item.grupo_id,
      proposta_id: item.proposta_id,
      valor_total: item.valor_total,
    });

    return NextResponse.json(item);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
