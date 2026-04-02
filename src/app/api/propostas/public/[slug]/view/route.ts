import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug) return NextResponse.json({ ok: false });

    // Find the proposta
    const { rows } = await pool.query(
      `SELECT id, data FROM propostas WHERE id LIKE $1 LIMIT 1`,
      [`${slug}%`]
    );
    if (rows.length === 0) return NextResponse.json({ ok: false });

    const proposta = rows[0].data;
    const body = await req.json().catch(() => ({}));
    const tempo = typeof body.tempo_segundos === 'number' ? body.tempo_segundos : 0;

    // Record view
    if (!proposta.visualizacoes) proposta.visualizacoes = [];
    proposta.visualizacoes.push({
      data: new Date().toISOString(),
      tempo_segundos: tempo,
    });

    // Update status if still ENVIADO
    if (proposta.status === 'ENVIADO') {
      proposta.status = 'VISUALIZADO';
    }
    proposta.atualizado_em = new Date().toISOString();

    await pool.query(
      `UPDATE propostas SET data = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(proposta), proposta.status, rows[0].id]
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
