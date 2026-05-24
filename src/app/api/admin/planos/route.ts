import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateId } from '@/lib/utils';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// GET /api/admin/planos — lista TODOS planos (inclui inativos).
export async function GET() {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const { rows } = await pool.query(
      `SELECT id, slug, nome, descricao, preco_mensal, preco_anual, moeda,
              destaque, ordem, ativo, limites, features, created_at, updated_at
       FROM planos
       ORDER BY ordem ASC, preco_mensal ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// POST /api/admin/planos — cria plano novo.
export async function POST(req: Request) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const body = await req.json();
    const id = body.id || generateId();
    await pool.query(
      `INSERT INTO planos
         (id, slug, nome, descricao, preco_mensal, preco_anual, moeda,
          destaque, ordem, ativo, limites, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, String(body.slug || '').toLowerCase(),
        body.nome || '', body.descricao || '',
        Number(body.preco_mensal) || 0, Number(body.preco_anual) || 0,
        body.moeda || 'BRL',
        !!body.destaque, Number(body.ordem) || 0,
        body.ativo !== false,
        JSON.stringify(body.limites || {}),
        JSON.stringify(body.features || []),
      ],
    );
    return NextResponse.json({ ok: true, id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
