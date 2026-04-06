import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json([]);
    await initDB();
    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const mes = url.searchParams.get('mes');
    if (mes) {
      const { rows } = await pool.query('SELECT data FROM planejamento_custos WHERE mes = $1 AND tenant_id = $2', [mes, tenantId]);
      return NextResponse.json(rows.length > 0 ? rows[0].data : null);
    }
    const { rows } = await pool.query('SELECT data FROM planejamento_custos WHERE tenant_id = $1 ORDER BY mes DESC', [tenantId]);
    return NextResponse.json(rows.map(r => r.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const item = await req.json();
    await pool.query(
      `INSERT INTO planejamento_custos (id, tenant_id, mes, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET mes = $3, data = $4, updated_at = NOW()`,
      [item.id, tenantId, item.mes || '', JSON.stringify(item)]
    );
    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
