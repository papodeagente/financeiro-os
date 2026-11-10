import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { COOKIE_NAME, getSession } from '@/lib/auth';
import { papelDaSessao, TENANT_DA_PLATAFORMA } from '@/lib/plataforma';
import { ErroEquipe, trocarMinhaSenha, type Executor } from '@/lib/equipe-da-plataforma';
import { esquecerSessaoEmCache } from '@/lib/sessao-viva';
import { registrarEventoAuditoria } from '@/lib/audit';

/**
 * POST { senha_atual, senha_nova } — quem é da plataforma troca a própria
 * senha (Minha conta). Todas as sessões caem, esta inclusive: a pessoa entra
 * de novo com a senha nova.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !papelDaSessao(session) || session.impersonatingTenantId) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  }
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    const corpo = await req.json().catch(() => ({}));
    await trocarMinhaSenha(pool as unknown as Executor, session.userId, corpo ?? {});
    esquecerSessaoEmCache({ userId: session.userId, isSuperAdmin: true });
    await registrarEventoAuditoria({
      tenantId: TENANT_DA_PLATAFORMA,
      session,
      acao: 'EDITAR',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: session.userId,
      descricao: 'Trocou a própria senha da plataforma.',
    });
    const resposta = NextResponse.json({ ok: true });
    resposta.cookies.set(COOKIE_NAME, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });
    return resposta;
  } catch (e) {
    if (e instanceof ErroEquipe) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[admin/auth/senha]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível trocar a senha. Nada foi gravado.' }, { status: 500 });
  }
}
