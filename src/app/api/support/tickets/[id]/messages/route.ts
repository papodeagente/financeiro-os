import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateId } from '@/lib/utils';

// POST /api/support/tickets/[id]/messages
// Usuário responde no thread do PRÓPRIO ticket.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { id } = await params;
    const body = await req.json();
    const mensagem = String(body.mensagem || '').trim();
    const anexos = Array.isArray(body.anexos) ? body.anexos : [];

    if (!mensagem && anexos.length === 0) {
      return NextResponse.json({ error: 'Mensagem ou anexo obrigatório' }, { status: 400 });
    }

    // Verifica que o ticket pertence ao tenant
    const { rows: t } = await pool.query(
      `SELECT id, status FROM support_tickets WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, session.tenantId],
    );
    if (t.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const msgId = generateId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO support_ticket_messages
           (id, ticket_id, tenant_id, from_type, from_id, from_nome, mensagem, anexos)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, $7::jsonb)`,
        [msgId, id, session.tenantId, session.userId, session.nome || '', mensagem, JSON.stringify(anexos)],
      );

      // Atualiza ticket: incrementa contagem, marca não-lida pro admin,
      // se ticket estava 'aguardando_usuario' ou 'resolvido', volta pra
      // 'em_andamento'.
      await client.query(
        `UPDATE support_tickets
            SET mensagens_count = mensagens_count + 1,
                ultima_msg_at = NOW(),
                updated_at = NOW(),
                tem_nao_lida_admin = true,
                status = CASE
                  WHEN status IN ('aguardando_usuario','resolvido','fechado') THEN 'em_andamento'
                  ELSE status
                END
          WHERE id = $1`,
        [id],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, id: msgId });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
