import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession, createSession, COOKIE_NAME } from '@/lib/auth';

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

    const { id: tenantId } = await params;

    // Look up the tenant
    const { rows: tenantRows } = await pool.query(
      'SELECT data FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (tenantRows.length === 0) {
      return NextResponse.json({ error: 'Tenant nao encontrado' }, { status: 404 });
    }

    const tenant = tenantRows[0].data;

    if (tenant.status !== 'ativo') {
      return NextResponse.json({ error: 'Tenant suspenso' }, { status: 403 });
    }

    // Look up the first admin user of this tenant
    const { rows: userRows } = await pool.query(
      `SELECT data FROM usuarios WHERE tenant_id = $1 AND data->>'perfil' = 'ADMIN' LIMIT 1`,
      [tenantId]
    );

    if (userRows.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum admin encontrado neste tenant' },
        { status: 404 }
      );
    }

    const adminUser = userRows[0].data;

    // Create impersonation JWT
    const token = await createSession({
      userId: session.userId,
      nome: session.nome,
      email: session.email,
      perfil: 'SUPER_ADMIN',
      permissoes: adminUser.permissoes || {},
      tenantId: tenantId,
      tenantSlug: tenant.slug,
      isSuperAdmin: true,
      impersonatingTenantId: tenantId,
      impersonatingTenantSlug: tenant.slug,
    });

    const response = NextResponse.json({
      ok: true,
      redirect: '/dashboard',
      tenant: { id: tenantId, slug: tenant.slug, nome: tenant.nome },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
