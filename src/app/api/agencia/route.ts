import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const { rows } = await pool.query('SELECT data FROM agencia LIMIT 1');
    return NextResponse.json(rows.length > 0 ? rows[0].data : null);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const data = await req.json();
    if (!pool) return NextResponse.json(data);
    await pool.query(
      `INSERT INTO agencia (id, data, updated_at) VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(data)]
    );
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
