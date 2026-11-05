import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { acrescentarEventoPublico, marcarVisualizada, type Consulta } from '@/lib/proposta-publica';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool) return NextResponse.json({ ok: false });
    if (!permitirChamada(`view:${ipDaRequisicao(req)}:${slug}`, 30, 10 * 60_000)) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) return NextResponse.json({ ok: false });

    const body = await req.json().catch(() => ({}));
    const bruto = typeof body?.tempo_segundos === 'number' ? body.tempo_segundos : 0;
    const tempo = Math.max(0, Math.min(Math.round(bruto), 24 * 3600));
    const dataVisualizacao = new Date().toISOString();

    // Mutações parciais e atômicas (FIN2-07): a visualização só acrescenta
    // ao histórico e só leva ENVIADO a VISUALIZADO. Nunca regrava o registro
    // inteiro, então não apaga um aceite que chegue ao mesmo tempo.
    const db = pool as unknown as Consulta;
    await acrescentarEventoPublico(db, r.id, 'visualizacoes', { data: dataVisualizacao, tempo_segundos: tempo });
    await marcarVisualizada(db, r.id);

    if (r.tenantId) {
      const proposta = r.data;
      const cliente = String(proposta.cliente_nome || 'Cliente');
      const numero = String(proposta.numero || r.id);
      const diaUtc = dataVisualizacao.slice(0, 10);
      await criarNotificacao({
        tenantId: r.tenantId,
        tipo: 'PROPOSTA_VISUALIZADA',
        titulo: `${cliente} visualizou a proposta ${numero}`,
        descricao: 'A proposta pública foi acessada pelo cliente.',
        link: `/propostas/${r.id}`,
        vendedorId: String(proposta.vendedor_id || ''),
        chaveDeduplicacao: `proposta:${r.id}:visualizada:${diaUtc}`,
        data: {
          proposta_id: r.id,
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
