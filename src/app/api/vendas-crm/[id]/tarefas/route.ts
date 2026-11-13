import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';

// GET /api/vendas-crm/[id]/tarefas
// Lista tarefas da negociacao com filtros opcionais via querystring:
//   ?status=pendente|em_andamento|concluida|cancelada
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const where: string[] = [`tenant_id = $1`, `venda_id = $2`];
    const args: unknown[] = [tenantId, id];
    if (status) {
      where.push(`status = $${args.length + 1}`);
      args.push(status);
    }
    const { rows } = await pool.query(
      `SELECT id, venda_id, cliente_id, responsavel_id, titulo, descricao,
              status, prioridade, origem, data_vencimento, data, created_at, updated_at
       FROM negociacao_tarefas
       WHERE ${where.join(' AND ')}
       ORDER BY (CASE status WHEN 'pendente' THEN 0 WHEN 'em_andamento' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END),
                created_at DESC
       LIMIT 200`,
      args,
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// POST /api/vendas-crm/[id]/tarefas
// Cria tarefa manual.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 500 });
    const tenantId = await getTenantId();
    const body = await req.json();
    const titulo = String(body.titulo || '').trim();
    if (!titulo) return NextResponse.json({ error: 'Título obrigatório' }, { status: 400 });
    const tarefaId = generateId();
    await pool.query(
      `INSERT INTO negociacao_tarefas
         (id, tenant_id, venda_id, cliente_id, responsavel_id, titulo, descricao,
          status, prioridade, origem, data_vencimento, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               COALESCE($8, 'pendente'), COALESCE($9, 'normal'),
               'manual', $10, '{}'::jsonb)`,
      [
        tarefaId, tenantId, id,
        body.cliente_id || null,
        String(body.responsavel_id || ''),
        titulo,
        String(body.descricao || ''),
        body.status || null,
        body.prioridade || null,
        body.data_vencimento || null,
      ],
    );
    return NextResponse.json({ ok: true, id: tarefaId });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// PATCH /api/vendas-crm/[id]/tarefas
// Atualiza status/prioridade/data de uma tarefa especifica.
// Body: { tarefa_id, status?, prioridade?, data_vencimento? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 500 });
    const tenantId = await getTenantId();
    const body = await req.json();
    const tarefaId = String(body.tarefa_id || '');
    if (!tarefaId) return NextResponse.json({ error: 'tarefa_id obrigatório' }, { status: 400 });

    const sets: string[] = [`updated_at = NOW()`];
    const args: unknown[] = [tarefaId, tenantId, id];
    if (typeof body.status === 'string') {
      sets.push(`status = $${args.length + 1}`);
      args.push(body.status);
    }
    if (typeof body.prioridade === 'string') {
      sets.push(`prioridade = $${args.length + 1}`);
      args.push(body.prioridade);
    }
    if (body.data_vencimento !== undefined) {
      sets.push(`data_vencimento = $${args.length + 1}`);
      args.push(body.data_vencimento || null);
    }
    await pool.query(
      `UPDATE negociacao_tarefas
       SET ${sets.join(', ')}
       WHERE id = $1 AND tenant_id = $2 AND venda_id = $3`,
      args,
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
