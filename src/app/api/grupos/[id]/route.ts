import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json(null, { status: 503 });
  await initDB();
  const { id } = await params;
  const { rows } = await pool.query('SELECT data FROM grupos WHERE id = $1', [id]);
  if (rows.length === 0) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(rows[0].data);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const { id } = await params;
  const grupo = await req.json();
  grupo.updated_at = new Date().toISOString();
  await pool.query(
    `INSERT INTO grupos (id, grp_id, origem_destino, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       grp_id = $2, origem_destino = $3, data = $4, updated_at = $6`,
    [id, grupo.grp_id || '', grupo.origem_destino || '',
     JSON.stringify(grupo), grupo.created_at, grupo.updated_at]
  );
  return NextResponse.json(grupo);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const { id } = await params;
  await pool.query('DELETE FROM grupos WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
