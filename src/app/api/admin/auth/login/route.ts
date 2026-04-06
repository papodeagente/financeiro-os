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

    const { rows } = await pool.query(
      `SELECT data FROM super_admins WHERE data->>'email' = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const user = rows[0].data;

    if (!user.senha_hash) {
      return NextResponse.json({ error: 'Conta sem senha configurada' }, { status: 401 });
    }

    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const token = await createSession({
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: 'SUPER_ADMIN',
      permissoes: {},
      tenantId: '__platform__',
      tenantSlug: '__platform__',
      isSuperAdmin: true,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: 'SUPER_ADMIN',
      },
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
