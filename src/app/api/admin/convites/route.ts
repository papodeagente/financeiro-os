import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateId } from '@/lib/utils';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// Gera codigo URL-safe alfa-numerico em uppercase. Ex: "K7Q3P9M2".
function gerarCodigo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 (confusao)
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// GET /api/admin/convites — lista todos os convites com contadores.
export async function GET() {
  const session = await requireSuper();
  if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const { rows } = await pool.query(
      `SELECT id, codigo, nome, descricao, plano_slug, duracao_dias,
              max_usos, usos_atuais, expira_em, ativo, tag, created_at, updated_at
       FROM convites
       ORDER BY created_at DESC`,
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// POST /api/admin/convites — cria convite.
// Body: { nome, descricao?, plano_slug, duracao_dias, max_usos?, expira_em?, tag? }
export async function POST(req: Request) {
  const session = await requireSuper();
  if (!session) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const body = await req.json();
    if (!body.nome) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!body.plano_slug) return NextResponse.json({ error: 'Plano obrigatório' }, { status: 400 });
    const duracaoDias = Math.max(1, Number(body.duracao_dias) || 365);

    // Garante codigo unico — tenta ate achar um livre (max 5 tentativas).
    let codigo = '';
    for (let i = 0; i < 5; i++) {
      codigo = gerarCodigo();
      const { rows } = await pool.query('SELECT 1 FROM convites WHERE codigo = $1 LIMIT 1', [codigo]);
      if (rows.length === 0) break;
    }

    const id = generateId();
    await pool.query(
      `INSERT INTO convites
         (id, codigo, nome, descricao, plano_slug, duracao_dias,
          max_usos, expira_em, ativo, criado_por, tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10)`,
      [
        id, codigo,
        body.nome, body.descricao || '',
        body.plano_slug, duracaoDias,
        body.max_usos ? Number(body.max_usos) : null,
        body.expira_em || null,
        session.userId || '',
        body.tag || '',
      ],
    );
    return NextResponse.json({ ok: true, id, codigo });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
