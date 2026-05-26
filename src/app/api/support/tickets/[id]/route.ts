import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/support/tickets/[id]
// Detalhes do ticket + thread completa de mensagens. Escopo do tenant
// (usuário só vê os próprios; super admin tem outro endpoint).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { id } = await params;

    const { rows: t } = await pool.query(
      `SELECT * FROM support_tickets WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, session.tenantId],
    );
    if (t.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { rows: msgs } = await pool.query(
      `SELECT id, from_type, from_id, from_nome, mensagem, anexos, created_at
         FROM support_ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC`,
      [id],
    );

    // Marca não-lidas do usuário como lidas (ele acabou de abrir).
    if (t[0].tem_nao_lida_usuario) {
      await pool.query(
        `UPDATE support_tickets SET tem_nao_lida_usuario = false WHERE id = $1`,
        [id],
      );
    }

    return NextResponse.json({ ticket: t[0], mensagens: msgs });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
