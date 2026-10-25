import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { resumoDoPedidoSites, type LinhaSites } from '@/lib/sites-resumo';

export async function GET(_req: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
  if (bloqueio) return NextResponse.json({ erro: bloqueio.erro }, { status: bloqueio.status });
  const { codigo } = await ctx.params;
  if (!codigo || codigo.length > 100) return NextResponse.json({ erro: 'Pedido inválido' }, { status: 400 });
  try {
    if (!pool) return NextResponse.json({ erro: 'Banco indisponível' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query<LinhaSites & { id: string }>(
      `SELECT id, tipo, dados, reserva_id, agregado_versao, criado_em
         FROM sites_eventos WHERE tenant_id = $1 AND pedido_codigo = $2
        ORDER BY criado_em, id`, [tenantId, codigo],
    );
    if (!rows.length) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 });
    return NextResponse.json({ codigo, resumo: resumoDoPedidoSites(rows), eventos: rows });
  } catch { return NextResponse.json({ erro: 'Falha ao carregar pedido' }, { status: 500 }); }
}
