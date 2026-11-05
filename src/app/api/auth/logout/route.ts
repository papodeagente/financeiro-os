import { NextResponse } from 'next/server';
import { COOKIE_NAME, getSession } from '@/lib/auth';
import { registrarEventoAuditoria } from '@/lib/audit';
import { revogarSessoes } from '@/lib/sessao-viva';

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
      // Sair invalida o token, e não só o cookie deste navegador: um token
      // copiado antes continuaria valendo até vencer.
      try {
        await revogarSessoes(session);
      } catch (e) {
        console.error('[logout] não revogou as sessões:', e instanceof Error ? e.message : e);
      }
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
