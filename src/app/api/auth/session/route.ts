import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Enriquece com foto do usuario (campo nao esta no JWT pra evitar
  // resetar sessao quando o user atualiza o avatar).
  let foto = '';
  try {
    await initDB();
    if (pool && session.userId) {
      const { rows } = await pool.query(
        `SELECT data->>'foto' AS foto FROM usuarios WHERE data->>'id' = $1 AND tenant_id = $2 LIMIT 1`,
        [session.userId, session.tenantId || ''],
      );
      if (rows.length > 0) foto = rows[0].foto || '';
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      nome: session.nome,
      email: session.email,
      foto,
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
