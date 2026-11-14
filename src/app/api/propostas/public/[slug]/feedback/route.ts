import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { acrescentarEventoPublico, type Consulta } from '@/lib/proposta-publica';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!permitirChamada(`acao:${ipDaRequisicao(req)}`, 20, 10 * 60_000)) {
      return NextResponse.json({ error: 'Muitas tentativas. Espere alguns minutos.' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const mensagem = String(body?.mensagem ?? '').trim().slice(0, 4000);
    const nome = String(body?.nome ?? '').trim().slice(0, 200);
    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem obrigatoria' }, { status: 400 });
    }

    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const feedbackId = randomUUID();
    const dataFeedback = new Date().toISOString();
    const gravou = await acrescentarEventoPublico(pool as unknown as Consulta, r.id, 'feedbacks', {
      id: feedbackId,
      data: dataFeedback,
      mensagem,
      nome: nome || 'Cliente',
    });
    if (!gravou) return NextResponse.json({ error: 'Limite de comentários desta proposta atingido.' }, { status: 429 });

    if (r.tenantId) {
      const proposta = r.data;
      const autorNome = nome || String(proposta.cliente_nome || 'Cliente');
      const numero = String(proposta.numero || r.id);
      await criarNotificacao({
        tenantId: r.tenantId,
        tipo: 'PROPOSTA_FEEDBACK',
        titulo: `${autorNome} pediu alterações na proposta ${numero}`,
        descricao: mensagem.slice(0, 140),
        link: `/propostas/${r.id}`,
        vendedorId: String(proposta.vendedor_id || ''),
        chaveDeduplicacao: `proposta:${r.id}:feedback:${feedbackId}`,
        data: {
          proposta_id: r.id,
          proposta_numero: numero,
          feedback_id: feedbackId,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Erro' }, { status: 500 });
  }
}
