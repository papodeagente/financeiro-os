import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/auth/me — perfil completo do usuário atual (com foto)
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const { rows } = await pool.query(
      `SELECT data FROM usuarios WHERE data->>'id' = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId || ''],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const u = rows[0].data || {};
    return NextResponse.json({
      id: u.id,
      nome: u.nome || '',
      email: u.email || '',
      foto: u.foto || '',
      perfil: u.perfil || '',
      telefone: u.telefone || '',
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// PATCH /api/auth/me — atualiza dados básicos (nome, foto, telefone)
export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const body = await req.json();
    const nome = typeof body.nome === 'string' ? body.nome.trim() : undefined;
    const foto = typeof body.foto === 'string' ? body.foto.trim() : undefined;
    const telefone = typeof body.telefone === 'string' ? body.telefone.trim() : undefined;

    const { rows } = await pool.query(
      `SELECT data FROM usuarios WHERE data->>'id' = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId || ''],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const cur = rows[0].data || {};
    const updated = {
      ...cur,
      ...(nome !== undefined ? { nome } : {}),
      ...(foto !== undefined ? { foto } : {}),
      ...(telefone !== undefined ? { telefone } : {}),
    };

    await pool.query(
      `UPDATE usuarios SET data = $1, updated_at = NOW() WHERE data->>'id' = $2 AND tenant_id = $3`,
      [JSON.stringify(updated), session.userId, session.tenantId || ''],
    );

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        nome: updated.nome || '',
        email: updated.email || '',
        foto: updated.foto || '',
        perfil: updated.perfil || '',
        telefone: updated.telefone || '',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
