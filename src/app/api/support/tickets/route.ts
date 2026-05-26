import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateId } from '@/lib/utils';

// ============================================================
// Tickets de suporte — escopo do USUÁRIO (próprio tenant).
// ============================================================
// GET   /api/support/tickets         — lista os tickets do tenant atual
// POST  /api/support/tickets         — cria novo ticket

const STATUS_VALIDOS = ['aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado'];
const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];
const CATEGORIAS = ['bug', 'duvida', 'sugestao', 'outro'];

async function nextTicketNumber(tenantId: string): Promise<string> {
  if (!pool) return 'BUG-0001';
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM support_tickets WHERE tenant_id = $1`,
    [tenantId],
  );
  const n = (rows[0]?.n || 0) + 1;
  return `T-${String(n).padStart(4, '0')}`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json([]);

    const { rows } = await pool.query(
      `SELECT id, numero, titulo, descricao, status, prioridade, categoria,
              created_by_nome, mensagens_count, tem_resposta_admin,
              tem_nao_lida_usuario, created_at, updated_at, ultima_msg_at
         FROM support_tickets
        WHERE tenant_id = $1
        ORDER BY COALESCE(ultima_msg_at, updated_at) DESC`,
      [session.tenantId],
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const body = await req.json();
    const titulo = String(body.titulo || '').trim();
    const descricao = String(body.descricao || '').trim();
    const categoria = CATEGORIAS.includes(body.categoria) ? body.categoria : 'bug';
    const prioridade = PRIORIDADES.includes(body.prioridade) ? body.prioridade : 'normal';
    const anexos = Array.isArray(body.anexos) ? body.anexos : [];
    const url_origem = String(body.url_origem || '').slice(0, 500);
    const user_agent = String(body.user_agent || '').slice(0, 500);

    if (!titulo) return NextResponse.json({ error: 'Título obrigatório' }, { status: 400 });
    if (!descricao) return NextResponse.json({ error: 'Descrição obrigatória' }, { status: 400 });

    const id = generateId();
    const numero = await nextTicketNumber(session.tenantId);

    await pool.query(
      `INSERT INTO support_tickets
         (id, tenant_id, numero, titulo, descricao, status, prioridade, categoria,
          created_by, created_by_nome, created_by_email, url_origem, user_agent,
          anexos, mensagens_count, tem_nao_lida_admin)
       VALUES ($1, $2, $3, $4, $5, 'aberto', $6, $7, $8, $9, $10, $11, $12, $13::jsonb, 0, true)`,
      [
        id, session.tenantId, numero, titulo.slice(0, 200), descricao,
        prioridade, categoria,
        session.userId, session.nome || '', session.email || '',
        url_origem, user_agent,
        JSON.stringify(anexos),
      ],
    );

    return NextResponse.json({ ok: true, id, numero });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

export { STATUS_VALIDOS, PRIORIDADES, CATEGORIAS };
