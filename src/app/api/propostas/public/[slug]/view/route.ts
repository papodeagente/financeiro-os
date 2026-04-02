import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
    // Only update if still in ENVIADO status
    if (proposta.status === 'ENVIADO') {
      proposta.status = 'VISUALIZADO';
      proposta.atualizado_em = new Date().toISOString();
      await pool.query(
        `UPDATE propostas SET data = $1, status = 'VISUALIZADO', updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(proposta), rows[0].id]
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
