import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { bloqueioFinanceiro } from '@/lib/permissoes';

export async function GET() {
  const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
  if (bloqueio) return NextResponse.json({ erro: bloqueio.erro }, { status: bloqueio.status });
  try {
    if (!pool) return NextResponse.json({ erro: 'Banco indisponível' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT id, tipo, pedido_codigo AS "pedidoCodigo", pedido_id AS "pedidoId",
              reserva_id AS "reservaId", criado_em AS "criadoEm", recebido_em AS "recebidoEm",
              dados
         FROM sites_eventos WHERE tenant_id = $1
        ORDER BY recebido_em DESC LIMIT 100`, [tenantId],
    );
    return NextResponse.json({ eventos: rows });
  } catch {
    return NextResponse.json({ erro: 'Falha ao carregar eventos' }, { status: 500 });
  }
}
