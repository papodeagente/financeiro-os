import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 6) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { rows } = await pool.query(
      `SELECT data FROM propostas WHERE id LIKE $1 LIMIT 1`,
      [`${slug}%`]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0].data);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
