import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const { id } = await params;
    const { status } = await req.json();

    const validStatuses = ['PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'RESERVA', 'VENDA'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Status invalido' }, { status: 400 });
    }

    const { rows } = await pool.query(`SELECT data FROM grupos WHERE id = $1`, [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Grupo nao encontrado' }, { status: 404 });

    const grupoData = { ...rows[0].data, status_pipeline: status };
    await pool.query(
      `UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(grupoData), id]
    );

    return NextResponse.json({ ok: true, status });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
