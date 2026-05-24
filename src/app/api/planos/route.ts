import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

// GET /api/planos
// Endpoint PUBLICO. Lista planos ativos pra landing/signup.
// Nao requer auth — adicionado em PUBLIC_PATHS do middleware.
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const { rows } = await pool.query(
      `SELECT id, slug, nome, descricao, preco_mensal, preco_anual, moeda,
              destaque, ordem, limites, features
       FROM planos
       WHERE ativo = TRUE
       ORDER BY ordem ASC, preco_mensal ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
