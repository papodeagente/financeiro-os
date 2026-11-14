import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { processarEventoPropostaPublica } from '@/lib/proposta-aceite-crm';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { acrescentarEventoPublico, type Consulta } from '@/lib/proposta-publica';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';

function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function validarTelefone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

// Cliente clicou "Solicitar Alteracoes" na view publica da proposta:
// preenche nome/telefone/email + descricao da alteracao. NAO marca a
// proposta como aceita — apenas registra o feedback e cria/atualiza
// uma negociacao (Venda CRM) no CRM com anotacao + tarefa.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!permitirChamada(`acao:${ipDaRequisicao(req)}`, 20, 10 * 60_000)) {
      return NextResponse.json({ error: 'Muitas tentativas. Espere alguns minutos.' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const nome = String(body?.nome || '').trim().slice(0, 200);
    const telefone = String(body?.telefone || '').trim().slice(0, 40);
    const email = String(body?.email || '').trim().slice(0, 200);
    const anotacao = String(body?.anotacao || body?.mensagem || '').trim().slice(0, 4000);
    const requestId = String(body?.request_id || '').trim().slice(0, 100);

    if (!nome) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!telefone) return NextResponse.json({ error: 'Telefone obrigatório' }, { status: 400 });
    if (!email) return NextResponse.json({ error: 'E-mail obrigatório' }, { status: 400 });
    if (!anotacao) return NextResponse.json({ error: 'Descreva a alteração desejada' }, { status: 400 });
    if (!validarEmail(email)) return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    if (!validarTelefone(telefone)) return NextResponse.json({ error: 'Telefone inválido (10-15 dígitos)' }, { status: 400 });

    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    const proposta = r.data;
    const tenantId = r.tenantId;

    if (proposta.status === 'ACEITO') {
      return NextResponse.json({ error: 'Proposta já foi aceita' }, { status: 400 });
    }
    if (proposta.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    const ip = ipDaRequisicao(req);
    const propostaUrl = r.linkPublico || String(proposta.link_publico || '');

    // Só acrescenta ao histórico (FIN2-07).
    const gravou = await acrescentarEventoPublico(pool as unknown as Consulta, r.id, 'feedbacks', {
      id: `fb-${Date.now()}`,
      tipo: 'ALTERACAO',
      mensagem: anotacao,
      nome, telefone, email,
      data: new Date().toISOString(),
      ip,
    });
    if (!gravou) return NextResponse.json({ error: 'Limite de pedidos desta proposta atingido.' }, { status: 429 });

    let resultado: Awaited<ReturnType<typeof processarEventoPropostaPublica>> | undefined;
    if (tenantId) {
      resultado = await processarEventoPropostaPublica({
        pool,
        tenantId,
        propostaId: r.id,
        propostaUrl,
        proposta: proposta as never,
        nome, telefone, email,
        tipo: 'alteracao',
        anotacao,
        ip,
        requestId,
      });
    }

    if (tenantId && resultado && !resultado.duplicado) {
      const cliente = String(proposta.cliente_nome || nome);
      const numero = String(proposta.numero || r.id);
      const sincronizado = resultado.syncStatus === 'ok';
      const descricao = !sincronizado
        ? 'Solicitação registrada com segurança. A sincronização com o CRM ficou pendente e precisa ser reprocessada.'
        : resultado.matchedExisting
          ? `Alteração registrada na negociação ${resultado.vendaNumero}. Tarefa atribuída ao responsável.`
          : `Nova negociação ${resultado.vendaNumero} criada para registrar a solicitação. Tarefa atribuída.`;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_FEEDBACK',
        titulo: `${cliente} solicitou alterações na proposta ${numero}`,
        descricao,
        link: sincronizado && resultado.vendaId
          ? `/vendas/${resultado.vendaId}`
          : `/propostas/${r.id}`,
        vendedorId: String(proposta.vendedor_id || ''),
        chaveDeduplicacao: `proposta:${r.id}:alteracao:${resultado.eventoId}`,
        data: {
          proposta_id: r.id,
          proposta_numero: numero,
          venda_id: resultado.vendaId,
          venda_numero: resultado.vendaNumero,
          tarefa_id: resultado.tarefaId,
          matched_existing: resultado.matchedExisting,
          evento_id: resultado.eventoId,
          sync_status: resultado.syncStatus,
          sync_pendente: !sincronizado,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      venda_id: resultado?.vendaId || null,
      venda_numero: resultado?.vendaNumero || null,
      matched_existing_negotiation: resultado?.matchedExisting || false,
      duplicado: resultado?.duplicado || false,
      sync_status: resultado?.syncStatus || 'ok',
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
