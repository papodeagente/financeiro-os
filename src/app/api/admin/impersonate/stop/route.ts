import { NextResponse } from 'next/server';
import { getSession, createSession, COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    // Create a new JWT without impersonation fields
    const token = await createSession({
      userId: session.userId,
      nome: session.nome,
      email: session.email,
      perfil: 'SUPER_ADMIN',
      permissoes: {},
      tenantId: '__platform__',
      tenantSlug: '__platform__',
      isSuperAdmin: true,
    });

    const response = NextResponse.json({
      ok: true,
      redirect: '/admin/dashboard',
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
