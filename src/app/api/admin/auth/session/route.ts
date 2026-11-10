import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { papelDaSessao } from '@/lib/plataforma';

export async function GET() {
  try {
    const session = await getSession();
    const papel = papelDaSessao(session);

    if (!session || !papel) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      session: {
        userId: session.userId,
        nome: session.nome,
        email: session.email,
        perfil: session.perfil,
        isSuperAdmin: session.isSuperAdmin === true,
        papel,
        impersonatingTenantId: session.impersonatingTenantId || null,
        impersonatingTenantSlug: session.impersonatingTenantSlug || null,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
