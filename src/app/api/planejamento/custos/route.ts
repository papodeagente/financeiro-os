import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json([]);
    await initDB();
    const url = new URL(req.url);
    const mes = url.searchParams.get('mes');
    if (mes) {
      const { rows } = await pool.query('SELECT data FROM planejamento_custos WHERE mes = $1', [mes]);
      return NextResponse.json(rows.length > 0 ? rows[0].data : null);
    }
    const { rows } = await pool.query('SELECT data FROM planejamento_custos ORDER BY mes DESC');
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
    const item = await req.json();
    await pool.query(
      `INSERT INTO planejamento_custos (id, mes, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET mes = $2, data = $3, updated_at = NOW()`,
      [item.id, item.mes || '', JSON.stringify(item)]
    );
    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
