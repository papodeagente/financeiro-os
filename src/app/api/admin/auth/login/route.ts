import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { verifyPassword, createSession, COOKIE_NAME, type SessionPayload } from '@/lib/auth';
import { registrarEventoAuditoria } from '@/lib/audit';

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
    const registrarFalha = (motivo: string) => registrarEventoAuditoria({
      tenantId: '__platform__',
      session: null,
      origem: 'PUBLICO',
      acao: 'LOGIN_FALHOU',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: user.id,
      descricao: `Tentativa de acesso administrativo recusada: ${motivo}.`,
    });

    if (!user.senha_hash) {
      await registrarFalha('conta sem senha configurada');
      return NextResponse.json({ error: 'Conta sem senha configurada' }, { status: 401 });
    }

    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      await registrarFalha('credenciais inválidas');
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const session: SessionPayload = {
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: 'SUPER_ADMIN',
      permissoes: {},
      tenantId: '__platform__',
      tenantSlug: '__platform__',
      isSuperAdmin: true,
    };
    const token = await createSession(session);
    await registrarEventoAuditoria({
      tenantId: '__platform__',
      session,
      acao: 'LOGIN',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: user.id,
      descricao: 'Entrou na administração da plataforma.',
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
