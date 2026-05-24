import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// PATCH /api/admin/planos/[id] — atualiza campos do plano. Aceita
// body parcial: { nome?, descricao?, preco_mensal?, ..., features?, limites? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { id } = await params;
    const body = await req.json();

    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [id];
    const pushSet = (col: string, val: unknown) => {
      sets.push(`${col} = $${args.length + 1}`);
      args.push(val);
    };

    if (typeof body.nome === 'string') pushSet('nome', body.nome);
    if (typeof body.descricao === 'string') pushSet('descricao', body.descricao);
    if (body.preco_mensal !== undefined) pushSet('preco_mensal', Number(body.preco_mensal) || 0);
    if (body.preco_anual !== undefined) pushSet('preco_anual', Number(body.preco_anual) || 0);
    if (typeof body.moeda === 'string') pushSet('moeda', body.moeda);
    if (typeof body.destaque === 'boolean') pushSet('destaque', body.destaque);
    if (body.ordem !== undefined) pushSet('ordem', Number(body.ordem) || 0);
    if (typeof body.ativo === 'boolean') pushSet('ativo', body.ativo);
    if (body.limites !== undefined) pushSet('limites', JSON.stringify(body.limites));
    if (body.features !== undefined) pushSet('features', JSON.stringify(body.features));

    await pool.query(`UPDATE planos SET ${sets.join(', ')} WHERE id = $1`, args);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// DELETE /api/admin/planos/[id] — soft delete (marca ativo=false). Plano
// nao e removido fisicamente pra preservar historico em assinaturas.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { id } = await params;
    await pool.query(`UPDATE planos SET ativo = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
