import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// GET /api/admin/support/tickets/[id] — detalhes + thread (sem filtro de tenant)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuper();
    if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { id } = await params;

    const { rows: t } = await pool.query(
      `SELECT t.*, te.nome AS tenant_nome, te.slug AS tenant_slug
         FROM support_tickets t
         LEFT JOIN tenants te ON te.id = t.tenant_id
        WHERE t.id = $1
        LIMIT 1`,
      [id],
    );
    if (t.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { rows: msgs } = await pool.query(
      `SELECT id, from_type, from_id, from_nome, mensagem, anexos, created_at
         FROM support_ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC`,
      [id],
    );

    // Marca não-lidas do admin como lidas
    if (t[0].tem_nao_lida_admin) {
      await pool.query(
        `UPDATE support_tickets SET tem_nao_lida_admin = false WHERE id = $1`,
        [id],
      );
    }

    return NextResponse.json({ ticket: t[0], mensagens: msgs });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// PATCH /api/admin/support/tickets/[id] — muda status/prioridade
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuper();
    if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { id } = await params;
    const body = await req.json();
    const STATUS = ['aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado'];
    const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];

    const updates: string[] = [];
    const args: unknown[] = [];

    if (body.status && STATUS.includes(body.status)) {
      args.push(body.status);
      updates.push(`status = $${args.length}`);
      if (body.status === 'resolvido') updates.push(`resolved_at = NOW()`);
      if (body.status === 'fechado') updates.push(`closed_at = NOW()`);
      // Quando admin resolve/fecha, notifica usuário (tem_nao_lida)
      if (body.status === 'resolvido' || body.status === 'aguardando_usuario') {
        updates.push(`tem_nao_lida_usuario = true`);
      }
    }
    if (body.prioridade && PRIORIDADES.includes(body.prioridade)) {
      args.push(body.prioridade);
      updates.push(`prioridade = $${args.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    args.push(id);

    await pool.query(
      `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $${args.length}`,
      args,
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
