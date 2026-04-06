import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();

    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      session: {
        userId: session.userId,
        nome: session.nome,
        email: session.email,
        perfil: session.perfil,
        isSuperAdmin: session.isSuperAdmin,
        impersonatingTenantId: session.impersonatingTenantId || null,
        impersonatingTenantSlug: session.impersonatingTenantSlug || null,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
