import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { processarEventoPropostaPublica } from '@/lib/proposta-aceite-crm';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { registrarAceite, type Consulta } from '@/lib/proposta-publica';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';

// Validacoes server-side (espelham client mas nao confiam nele).
function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function validarTelefone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!permitirChamada(`acao:${ipDaRequisicao(req)}`, 20, 10 * 60_000)) {
      return NextResponse.json({ error: 'Muitas tentativas. Espere alguns minutos.' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const nome = String(body?.nome || body?.nome_aceite || '').trim().slice(0, 200);
    const telefone = String(body?.telefone || '').trim().slice(0, 40);
    const email = String(body?.email || '').trim().slice(0, 200);
    const requestId = String(body?.request_id || '').trim().slice(0, 100);

    if (!nome) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!telefone) return NextResponse.json({ error: 'Telefone obrigatório' }, { status: 400 });
    if (!email) return NextResponse.json({ error: 'E-mail obrigatório' }, { status: 400 });
    if (!validarEmail(email)) return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    if (!validarTelefone(telefone)) return NextResponse.json({ error: 'Telefone inválido (10-15 dígitos)' }, { status: 400 });

    // Só o host canônico serve proposta pública; endereço inválido, vencido
    // ou trocado recebe 404, que não vaza sequer a existência da proposta.
    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    const tenantId = r.tenantId;

    if (r.data.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    const ip = ipDaRequisicao(req);
    const propostaUrl = r.linkPublico || String(r.data.link_publico || '');

    // Aceite como troca condicional (FIN2-07): vale o primeiro. Um segundo
    // aceite não regrava nome, IP e data do primeiro; reenvio do MESMO
    // pedido (mesmo request_id, ex.: rede caiu na resposta) só refaz o
    // registro no CRM, que é idempotente.
    const aceite = {
      nome_aceite: nome,
      data_aceite: new Date().toISOString(),
      ip_aceite: ip,
      telefone,
      email,
      request_id: requestId,
    };
    const valeu = await registrarAceite(pool as unknown as Consulta, r.id, aceite);
    let proposta: Record<string, unknown> = { ...r.data, status: 'ACEITO', aceite };
    if (!valeu) {
      const { rows } = await pool.query(`SELECT data FROM propostas WHERE id = $1`, [r.id]);
      const atual = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const aceiteAtual = (atual.aceite ?? null) as Record<string, unknown> | null;
      const mesmoPedido = !!requestId && atual.status === 'ACEITO' && aceiteAtual?.request_id === requestId;
      if (!mesmoPedido) {
        return NextResponse.json(
          { error: atual.status === 'ACEITO' ? 'Esta proposta já foi aceita.' : 'Esta proposta não pode mais ser aceita.' },
          { status: 409 },
        );
      }
      proposta = atual;
    }

    // ============ PROCESSA EVENTO COM CRM ============
    // Helper unico:
    //   1. Idempotencia via request_id (proposta_id + request_id UNIQUE)
    //   2. Persistencia local em proposta_eventos_publicos
    //   3. Busca negociacao ativa (ORCAMENTO/RESERVADO/CONFIRMADO) por
    //      tel/email normalizados
    //   4. Cria anotacao + tarefa (negociacao existente) OU
    //      cria cliente + venda + anotacao + tarefa (sem negociacao)
    let resultado: Awaited<ReturnType<typeof processarEventoPropostaPublica>> | undefined;
    if (tenantId) {
      resultado = await processarEventoPropostaPublica({
        pool,
        tenantId,
        propostaId: r.id,
        propostaUrl,
        proposta: proposta as never,
        nome, telefone, email,
        tipo: 'aceite',
        ip,
        requestId,
      });
    }

    if (tenantId && resultado && !resultado.duplicado) {
      const cliente = String(proposta.cliente_nome || nome);
      const numero = String(proposta.numero || r.id);
      const sincronizado = resultado.syncStatus === 'ok';
      const descricao = !sincronizado
        ? 'Aceite registrado com segurança. A sincronização com o CRM ficou pendente e precisa ser reprocessada.'
        : resultado.matchedExisting
          ? `Aceite na negociação existente ${resultado.vendaNumero}. Tarefa criada para o responsável.`
          : `Aceite registrado. Nova negociação ${resultado.vendaNumero} criada no CRM com tarefa.`;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_ACEITA',
        titulo: `${cliente} aceitou a proposta ${numero}`,
        descricao,
        link: sincronizado && resultado.vendaId
          ? `/vendas/${resultado.vendaId}`
          : `/propostas/${r.id}`,
        vendedorId: String(proposta.vendedor_id || ''),
        chaveDeduplicacao: `proposta:${r.id}:aceite:${resultado.eventoId}`,
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
      status: 'ACEITO',
      venda_id: resultado?.vendaId || null,
      venda_numero: resultado?.vendaNumero || null,
      matched_existing_negotiation: resultado?.matchedExisting || false,
      duplicado: resultado?.duplicado || false,
      sync_status: resultado?.syncStatus || 'ok',
    });
  } catch (e: unknown) {
    console.error('[proposta-aceite]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro ao registrar o aceite' }, { status: 500 });
  }
}
