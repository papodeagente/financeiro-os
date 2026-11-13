import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { isHostAuthorizedForProposta } from '@/lib/tenant-host';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ ok: false });
    }

    // Find the proposta
    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ ok: false });

    if (!isHostAuthorizedForProposta(req)) {
      return NextResponse.json({ ok: false });
    }

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';
    const body = await req.json().catch(() => ({}));
    const tempo = typeof body.tempo_segundos === 'number' ? body.tempo_segundos : 0;
    const agora = new Date();
    const dataVisualizacao = agora.toISOString();

    // Record view
    if (!proposta.visualizacoes) proposta.visualizacoes = [];
    proposta.visualizacoes.push({
      data: dataVisualizacao,
      tempo_segundos: tempo,
    });

    // Update status if still ENVIADO
    if (proposta.status === 'ENVIADO') {
      proposta.status = 'VISUALIZADO';
    }
    proposta.atualizado_em = dataVisualizacao;

    await pool.query(
      `UPDATE propostas SET data = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(proposta), proposta.status, rows[0].id]
    );

    if (tenantId) {
      const cliente = proposta.cliente_nome || 'Cliente';
      const numero = proposta.numero || rows[0].id;
      const diaUtc = dataVisualizacao.slice(0, 10);
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_VISUALIZADA',
        titulo: `${cliente} visualizou a proposta ${numero}`,
        descricao: 'A proposta pública foi acessada pelo cliente.',
        link: `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        chaveDeduplicacao: `proposta:${rows[0].id}:visualizada:${diaUtc}`,
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          visualizada_em: dataVisualizacao,
          tempo_segundos: tempo,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
