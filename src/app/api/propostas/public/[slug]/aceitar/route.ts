import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const { nome_aceite } = body;
    if (!nome_aceite?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatorio' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';

    if (proposta.status === 'ACEITO') {
      return NextResponse.json({ error: 'Proposta ja foi aceita' }, { status: 400 });
    }
    if (proposta.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';

    proposta.status = 'ACEITO';
    proposta.aceite = {
      nome_aceite: nome_aceite.trim(),
      data_aceite: new Date().toISOString(),
      ip_aceite: ip,
    };
    proposta.atualizado_em = new Date().toISOString();

    await pool.query(
      `UPDATE propostas SET data = $1, status = 'ACEITO', updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

    if (tenantId) {
      const cliente = proposta.cliente_nome || nome_aceite.trim();
      const numero = proposta.numero || rows[0].id;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_ACEITA',
        titulo: `${cliente} aceitou a proposta ${numero}`,
        descricao: `Aceite registrado por ${nome_aceite.trim()}`,
        link: `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          cliente_nome: cliente,
          nome_aceite: nome_aceite.trim(),
        },
      });
    }

    return NextResponse.json({ ok: true, status: 'ACEITO' });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
