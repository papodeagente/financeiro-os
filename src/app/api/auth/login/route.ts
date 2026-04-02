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

    // Find user by email
    const { rows } = await pool.query(
      `SELECT data FROM usuarios WHERE data->>'email' = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const user = rows[0].data;

    if (!user.ativo) {
      return NextResponse.json({ error: 'Usuario inativo. Contate o administrador.' }, { status: 403 });
    }

    if (!user.senha_hash) {
      return NextResponse.json({ error: 'Usuario sem senha configurada. Contate o administrador.' }, { status: 401 });
    }

    // Verify password
    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    // Create JWT session
    const token = await createSession({
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      permissoes: user.permissoes || {},
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        permissoes: user.permissoes,
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
