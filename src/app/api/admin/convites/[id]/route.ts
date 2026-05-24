import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// GET /api/admin/convites/[id] — detalhes + lista de usos.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { id } = await params;
    const { rows: cs } = await pool.query(`SELECT * FROM convites WHERE id = $1 LIMIT 1`, [id]);
    if (cs.length === 0) return NextResponse.json({ error: 'Convite não encontrado' }, { status: 404 });
    const { rows: usos } = await pool.query(
      `SELECT u.id, u.tenant_id, u.usuario_id, u.nome_cliente, u.email_cliente,
              u.ip, u.user_agent, u.used_at,
              t.nome as tenant_nome, t.slug as tenant_slug
       FROM convite_usos u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.convite_id = $1
       ORDER BY u.used_at DESC`,
      [id],
    );
    return NextResponse.json({ convite: cs[0], usos });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// PATCH /api/admin/convites/[id] — atualiza campos.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { id } = await params;
    const body = await req.json();
    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [id];
    const push = (col: string, v: unknown) => { sets.push(`${col} = $${args.length + 1}`); args.push(v); };

    if (typeof body.nome === 'string') push('nome', body.nome);
    if (typeof body.descricao === 'string') push('descricao', body.descricao);
    if (typeof body.plano_slug === 'string') push('plano_slug', body.plano_slug);
    if (body.duracao_dias !== undefined) push('duracao_dias', Math.max(1, Number(body.duracao_dias) || 365));
    if (body.max_usos !== undefined) push('max_usos', body.max_usos === null ? null : Number(body.max_usos));
    if (body.expira_em !== undefined) push('expira_em', body.expira_em || null);
    if (typeof body.ativo === 'boolean') push('ativo', body.ativo);
    if (typeof body.tag === 'string') push('tag', body.tag);

    await pool.query(`UPDATE convites SET ${sets.join(', ')} WHERE id = $1`, args);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// DELETE — soft delete (ativo=false) pra preservar historico de usos.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { id } = await params;
    await pool.query(`UPDATE convites SET ativo = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
