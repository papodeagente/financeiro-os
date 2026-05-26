import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/admin/support/tickets — super admin lista TODOS os tickets
// de todos os tenants, com filtros opcionais via querystring:
//   ?status=aberto&prioridade=alta&q=<busca-titulo>
async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

export async function GET(req: Request) {
  try {
    const session = await requireSuper();
    if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });

    await initDB();
    if (!pool) return NextResponse.json([]);

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const prioridade = url.searchParams.get('prioridade');
    const tenantFiltro = url.searchParams.get('tenant_id');
    const q = (url.searchParams.get('q') || '').trim();

    const where: string[] = [];
    const args: unknown[] = [];
    if (status) { args.push(status); where.push(`t.status = $${args.length}`); }
    if (prioridade) { args.push(prioridade); where.push(`t.prioridade = $${args.length}`); }
    if (tenantFiltro) { args.push(tenantFiltro); where.push(`t.tenant_id = $${args.length}`); }
    if (q) {
      args.push(`%${q}%`);
      where.push(`(t.titulo ILIKE $${args.length} OR t.numero ILIKE $${args.length} OR t.created_by_email ILIKE $${args.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT t.id, t.numero, t.titulo, t.status, t.prioridade, t.categoria,
              t.tenant_id, t.created_by_nome, t.created_by_email,
              t.mensagens_count, t.tem_nao_lida_admin, t.tem_resposta_admin,
              t.created_at, t.updated_at, t.ultima_msg_at,
              te.nome AS tenant_nome, te.slug AS tenant_slug
         FROM support_tickets t
         LEFT JOIN tenants te ON te.id = t.tenant_id
         ${whereSql}
         ORDER BY t.tem_nao_lida_admin DESC, COALESCE(t.ultima_msg_at, t.updated_at) DESC
         LIMIT 200`,
      args,
    );

    // Stats agregadas pra cabeçalho
    const { rows: stats } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'aberto')::int AS abertos,
         COUNT(*) FILTER (WHERE status = 'em_andamento')::int AS em_andamento,
         COUNT(*) FILTER (WHERE status = 'aguardando_usuario')::int AS aguardando_usuario,
         COUNT(*) FILTER (WHERE status = 'resolvido')::int AS resolvidos,
         COUNT(*) FILTER (WHERE status = 'fechado')::int AS fechados,
         COUNT(*) FILTER (WHERE tem_nao_lida_admin = true)::int AS nao_lidos
       FROM support_tickets`,
    );

    return NextResponse.json({ tickets: rows, stats: stats[0] || {} });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
