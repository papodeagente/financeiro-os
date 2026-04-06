import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const [
      totalTenantsRes,
      activeTenantsRes,
      totalUsersRes,
      planDistRes,
      recentTenantsRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM tenants'),
      pool.query("SELECT COUNT(*) as cnt FROM tenants WHERE status = 'ativo'"),
      pool.query('SELECT COUNT(*) as cnt FROM usuarios'),
      pool.query('SELECT plano, COUNT(*) as cnt FROM tenants GROUP BY plano'),
      pool.query('SELECT data FROM tenants ORDER BY created_at DESC LIMIT 5'),
    ]);

    const planDistribution: Record<string, number> = {};
    for (const row of planDistRes.rows) {
      planDistribution[row.plano] = parseInt(row.cnt, 10);
    }

    return NextResponse.json({
      totalTenants: parseInt(totalTenantsRes.rows[0].cnt, 10),
      activeTenants: parseInt(activeTenantsRes.rows[0].cnt, 10),
      totalUsers: parseInt(totalUsersRes.rows[0].cnt, 10),
      planDistribution,
      recentTenants: recentTenantsRes.rows.map((r: { data: Record<string, unknown> }) => r.data),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
