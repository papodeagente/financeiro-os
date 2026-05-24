import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

// GET /api/marketing/login — endpoint PUBLICO consumido por /login pra
// renderizar imagem + link da campanha ativa. Sem auth — adicionado em
// PUBLIC_PATHS do middleware.
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ image_url: '', link_url: '', alt: '', ativo: false });
    const { rows } = await pool.query(
      `SELECT data FROM saas_config WHERE key = 'login_campanha' LIMIT 1`,
    );
    if (rows.length === 0) {
      return NextResponse.json({ image_url: '', link_url: '', alt: '', ativo: false });
    }
    return NextResponse.json(rows[0].data || {});
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
