import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const { mensagem, nome } = body;
    if (!mensagem?.trim()) {
      return NextResponse.json({ error: 'Mensagem obrigatoria' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';

    if (!proposta.feedbacks) proposta.feedbacks = [];
    proposta.feedbacks.push({
      data: new Date().toISOString(),
      mensagem: mensagem.trim(),
      nome: (nome || '').trim() || 'Cliente',
    });
    proposta.atualizado_em = new Date().toISOString();

    await pool.query(
      `UPDATE propostas SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

    if (tenantId) {
      const autorNome = (nome || '').trim() || proposta.cliente_nome || 'Cliente';
      const numero = proposta.numero || rows[0].id;
      const trecho = mensagem.trim().slice(0, 140);
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_FEEDBACK',
        titulo: `${autorNome} pediu alterações na proposta ${numero}`,
        descricao: trecho,
        link: `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          autor: autorNome,
          mensagem: mensagem.trim(),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
