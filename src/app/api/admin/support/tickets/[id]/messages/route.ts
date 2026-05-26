import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateId } from '@/lib/utils';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// POST /api/admin/support/tickets/[id]/messages — super admin responde
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuper();
    if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { id } = await params;
    const body = await req.json();
    const mensagem = String(body.mensagem || '').trim();
    const anexos = Array.isArray(body.anexos) ? body.anexos : [];
    const novoStatus = typeof body.status === 'string' ? body.status : null;

    if (!mensagem && anexos.length === 0) {
      return NextResponse.json({ error: 'Mensagem ou anexo obrigatório' }, { status: 400 });
    }

    const { rows: t } = await pool.query(
      `SELECT id, tenant_id FROM support_tickets WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (t.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const msgId = generateId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO support_ticket_messages
           (id, ticket_id, tenant_id, from_type, from_id, from_nome, mensagem, anexos)
         VALUES ($1, $2, $3, 'super_admin', $4, $5, $6, $7::jsonb)`,
        [msgId, id, t[0].tenant_id, session.userId, session.nome || 'Suporte', mensagem, JSON.stringify(anexos)],
      );

      // Atualiza ticket: marca resposta do admin + não-lida pro usuário,
      // muda status pra 'em_andamento' se ainda estava 'aberto'. Se admin
      // explicitamente passou status no body, aplica.
      const STATUS_VALIDOS = ['aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado'];
      const statusSet = novoStatus && STATUS_VALIDOS.includes(novoStatus)
        ? novoStatus
        : 'em_andamento';

      await client.query(
        `UPDATE support_tickets
            SET mensagens_count = mensagens_count + 1,
                ultima_msg_at = NOW(),
                updated_at = NOW(),
                tem_resposta_admin = true,
                tem_nao_lida_usuario = true,
                status = CASE
                  WHEN $2 = 'em_andamento' AND status IN ('aberto') THEN 'em_andamento'
                  ELSE $2
                END,
                resolved_at = CASE WHEN $2 = 'resolvido' THEN NOW() ELSE resolved_at END,
                closed_at = CASE WHEN $2 = 'fechado' THEN NOW() ELSE closed_at END
          WHERE id = $1`,
        [id, statusSet],
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
