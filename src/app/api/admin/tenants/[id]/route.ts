import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
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

    const tenant = rows[0].data;

    // Get stats in parallel
    const [usersRes, gruposRes, vendasRes] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM usuarios WHERE tenant_id = $1', [id]),
      pool.query('SELECT COUNT(*) as cnt FROM grupos WHERE tenant_id = $1', [id]),
      pool.query('SELECT COUNT(*) as cnt FROM vendas_crm WHERE tenant_id = $1', [id]),
    ]);

    return NextResponse.json({
      ...tenant,
      stats: {
        userCount: parseInt(usersRes.rows[0].cnt, 10),
        grupoCount: parseInt(gruposRes.rows[0].cnt, 10),
        vendaCount: parseInt(vendasRes.rows[0].cnt, 10),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
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
    const body = await req.json();

    const { rows } = await pool.query('SELECT data FROM tenants WHERE id = $1', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tenant nao encontrado' }, { status: 404 });
    }

    const existing = rows[0].data;
    const updated = { ...existing, ...body, id, updated_at: new Date().toISOString() };

    await pool.query(
      `UPDATE tenants SET
        nome = $2,
        cnpj = $3,
        plano = $4,
        status = $5,
        data = $6,
        updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        updated.nome || existing.nome,
        updated.cnpj || existing.cnpj,
        updated.plano || existing.plano,
        updated.status || existing.status,
        JSON.stringify(updated),
      ]
    );

    return NextResponse.json({ ok: true, tenant: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
