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
  // O número da conta segue o mesmo caminho da foto, e pela mesma razão:
  // fora do JWT, ninguém precisa sair e entrar de novo para vê-lo.
  let tenantNumero: number | null = null;
  try {
    await initDB();
    if (pool && session.userId) {
      const { rows } = await pool.query(
        `SELECT data->>'foto' AS foto FROM usuarios WHERE data->>'id' = $1 AND tenant_id = $2 LIMIT 1`,
        [session.userId, session.tenantId || ''],
      );
      if (rows.length > 0) foto = rows[0].foto || '';
    }
    // Impersonando, o número é o da conta que está sendo vista — é dela que
    // a tela inteira está falando.
    const tenantDaVez = session.impersonatingTenantId || session.tenantId || '';
    if (pool && tenantDaVez) {
      const { rows } = await pool.query(
        `SELECT numero FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantDaVez],
      );
      const n = Number(rows[0]?.numero);
      if (Number.isFinite(n) && n > 0) tenantNumero = n;
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
      tenantNumero,
      isSuperAdmin: session.isSuperAdmin || false,
      impersonatingTenantId: session.impersonatingTenantId || null,
      impersonatingTenantSlug: session.impersonatingTenantSlug || null,
    },
  });
}
