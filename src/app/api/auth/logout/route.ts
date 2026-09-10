import { NextResponse } from 'next/server';
import { COOKIE_NAME, getSession } from '@/lib/auth';
import { registrarEventoAuditoria } from '@/lib/audit';

export async function POST() {
  try {
    const session = await getSession();
    if (session) {
      await registrarEventoAuditoria({
        session,
        acao: 'LOGOUT',
        modulo: 'Segurança',
        entidade: session.isSuperAdmin ? 'super_admins' : 'usuarios',
        entidadeId: session.userId,
        descricao: 'Saiu do sistema.',
      });
    }
  } catch {
    return NextResponse.json({ error: 'Não foi possível registrar a saída. Tente novamente.' }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
