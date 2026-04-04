import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';

export async function GET() {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const { rows } = await pool.query('SELECT data FROM grupos ORDER BY updated_at DESC');
  return NextResponse.json(rows.map(r => r.data));
}

export async function POST(req: NextRequest) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const grupo = await req.json();
  grupo.updated_at = new Date().toISOString();
  await pool.query(
    `INSERT INTO grupos (id, grp_id, origem_destino, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       grp_id = $2, origem_destino = $3, data = $4, updated_at = $6`,
    [grupo.id, grupo.grp_id || '', grupo.origem_destino || '',
     JSON.stringify(grupo), grupo.created_at, grupo.updated_at]
  );

  // CRM: emit product published
  emitirEventoCRM('PRODUTO_PUBLICADO', {
    grupo_id: grupo.id,
    origem_destino: grupo.origem_destino,
    data: grupo,
  });

  return NextResponse.json(grupo);
}
