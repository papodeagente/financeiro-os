import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      nome: session.nome,
      email: session.email,
      perfil: session.perfil,
      permissoes: session.permissoes,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      isSuperAdmin: session.isSuperAdmin || false,
      impersonatingTenantId: session.impersonatingTenantId || null,
      impersonatingTenantSlug: session.impersonatingTenantSlug || null,
    },
  });
}
