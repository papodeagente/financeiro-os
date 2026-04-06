import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool || !id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const tenantId = await getTenantId();
    const body = await req.json();
    const { nome_aceite } = body;
    if (!nome_aceite?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatorio' }, { status: 400 });
    }

    const { rows } = await pool.query(`SELECT id, data FROM propostas WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;

    if (proposta.status === 'ACEITO') {
      return NextResponse.json({ error: 'Proposta ja foi aceita' }, { status: 400 });
    }
    if (proposta.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    // Get IP from headers
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
      `UPDATE propostas SET data = $1, status = 'ACEITO', updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(proposta), id, tenantId]
    );

    return NextResponse.json({ ok: true, status: 'ACEITO' });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
