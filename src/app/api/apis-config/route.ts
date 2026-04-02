import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

const CONFIG_ID = 'apis-config-singleton';

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = $1`, [CONFIG_ID]);
    return NextResponse.json(rows.length > 0 ? rows[0].data : null);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const data = await req.json();
    if (!pool) return NextResponse.json(data);
    await pool.query(
      `INSERT INTO config_apis (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [CONFIG_ID, JSON.stringify(data)]
    );
    return NextResponse.json(data);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
