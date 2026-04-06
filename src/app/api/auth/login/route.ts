import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { verifyPassword, createSession, COOKIE_NAME } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, senha } = await req.json();
    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha sao obrigatorios' }, { status: 400 });
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    // Find user by email, JOIN with tenants for tenant context
    const { rows } = await pool.query(
      `SELECT u.data, u.tenant_id, t.slug as tenant_slug, t.status as tenant_status, t.nome as tenant_nome
       FROM usuarios u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.data->>'email' = $1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const row = rows[0];
    const user = row.data;

    if (!user.ativo) {
      return NextResponse.json({ error: 'Usuario inativo. Contate o administrador.' }, { status: 403 });
    }

    // Check tenant status
    if (row.tenant_status && row.tenant_status !== 'ativo') {
      return NextResponse.json({ error: 'Agencia suspensa. Contate o suporte.' }, { status: 403 });
    }

    if (!user.senha_hash) {
      return NextResponse.json({ error: 'Usuario sem senha configurada. Contate o administrador.' }, { status: 401 });
    }

    // Verify password
    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    // Create JWT session with tenant context
    const token = await createSession({
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      permissoes: user.permissoes || {},
      tenantId: row.tenant_id || '',
      tenantSlug: row.tenant_slug || '',
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        permissoes: user.permissoes,
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        tenantNome: row.tenant_nome,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
