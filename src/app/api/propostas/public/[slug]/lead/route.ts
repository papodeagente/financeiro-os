import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const { nome, email, telefone, mensagem } = body;
    if (!nome?.trim() || (!email?.trim() && !telefone?.trim())) {
      return NextResponse.json({ error: 'Nome e email ou telefone obrigatorios' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;
    if (!proposta.leads) proposta.leads = [];
    proposta.leads.push({
      nome: nome.trim(),
      email: (email || '').trim(),
      telefone: (telefone || '').trim(),
      mensagem: (mensagem || '').trim(),
      data: new Date().toISOString(),
    });
    proposta.atualizado_em = new Date().toISOString();

    await pool.query(
      `UPDATE propostas SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
