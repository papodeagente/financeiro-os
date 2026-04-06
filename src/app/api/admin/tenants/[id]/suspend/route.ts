import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { id } = await params;

    const { rows } = await pool.query('SELECT data FROM tenants WHERE id = $1', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tenant nao encontrado' }, { status: 404 });
    }

    const existing = rows[0].data;
    const updated = {
      ...existing,
      status: 'suspenso',
      suspended_at: new Date().toISOString(),
    };

    await pool.query(
      `UPDATE tenants SET status = 'suspenso', data = $2, updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(updated)]
    );

    return NextResponse.json({ ok: true, tenant: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
