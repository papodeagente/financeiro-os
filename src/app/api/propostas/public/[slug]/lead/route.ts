import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { acrescentarEventoPublico, type Consulta } from '@/lib/proposta-publica';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';

function normalizarTextoIdentidade(valor: string): string {
  return valor.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fingerprintLead(nome: string, email: string, telefone: string): string {
  const identidadeNormalizada = JSON.stringify({
    nome: normalizarTextoIdentidade(nome),
    email: normalizarTextoIdentidade(email),
    telefone: telefone.replace(/\D/g, ''),
  });
  return createHash('sha256').update(identidadeNormalizada).digest('hex');
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!permitirChamada(`acao:${ipDaRequisicao(req)}`, 20, 10 * 60_000)) {
      return NextResponse.json({ error: 'Muitas tentativas. Espere alguns minutos.' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const nomeLead = String(body?.nome ?? '').trim().slice(0, 200);
    const emailLead = String(body?.email ?? '').trim().slice(0, 200);
    const telefoneLead = String(body?.telefone ?? '').trim().slice(0, 40);
    const mensagemLead = String(body?.mensagem ?? '').trim().slice(0, 4000);
    if (!nomeLead || (!emailLead && !telefoneLead)) {
      return NextResponse.json({ error: 'Nome e email ou telefone obrigatorios' }, { status: 400 });
    }

    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const dataLead = new Date().toISOString();
    // Só acrescenta (FIN2-07). O visitante recebe um recibo sem dado de
    // ninguém; os interessados ficam para a agência (FIN2-06).
    const gravou = await acrescentarEventoPublico(pool as unknown as Consulta, r.id, 'leads', {
      nome: nomeLead,
      email: emailLead,
      telefone: telefoneLead,
      mensagem: mensagemLead,
      data: dataLead,
    });
    if (!gravou) return NextResponse.json({ error: 'Limite de contatos desta proposta atingido.' }, { status: 429 });

    if (r.tenantId) {
      const proposta = r.data;
      const numero = String(proposta.numero || r.id);
      const leadFingerprint = fingerprintLead(nomeLead, emailLead, telefoneLead);
      await criarNotificacao({
        tenantId: r.tenantId,
        tipo: 'PROPOSTA_LEAD',
        titulo: `${nomeLead} demonstrou interesse na proposta ${numero}`,
        descricao: mensagemLead || 'Um novo contato foi enviado pela proposta pública.',
        link: `/propostas/${r.id}`,
        vendedorId: String(proposta.vendedor_id || ''),
        chaveDeduplicacao: `proposta:${r.id}:lead:${leadFingerprint}`,
        data: {
          proposta_id: r.id,
          proposta_numero: numero,
          recebido_em: dataLead,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Erro' }, { status: 500 });
  }
}
