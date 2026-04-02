import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { createCrudHandlers } from '@/lib/crud-api';

const crud = createCrudHandlers('destinos', ['nome', 'pais']);
export const POST = crud.POST;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q) return crud.GET();

  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const { rows } = await pool.query(
      `SELECT data FROM destinos WHERE LOWER(nome) LIKE $1 OR LOWER(pais) LIKE $1 ORDER BY nome ASC LIMIT 20`,
      [`%${q.toLowerCase()}%`]
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
