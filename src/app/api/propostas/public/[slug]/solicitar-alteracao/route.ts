import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { processarEventoPropostaPublica } from '@/lib/proposta-aceite-crm';

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
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const nome = String(body.nome || '').trim();
    const telefone = String(body.telefone || '').trim();
    const email = String(body.email || '').trim();
    const anotacao = String(body.anotacao || body.mensagem || '').trim();
    const requestId = String(body.request_id || '').trim();

    if (!nome) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!telefone) return NextResponse.json({ error: 'Telefone obrigatório' }, { status: 400 });
    if (!email) return NextResponse.json({ error: 'E-mail obrigatório' }, { status: 400 });
    if (!anotacao) return NextResponse.json({ error: 'Descreva a alteração desejada' }, { status: 400 });
    if (!validarEmail(email)) return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    if (!validarTelefone(telefone)) return NextResponse.json({ error: 'Telefone inválido (10-15 dígitos)' }, { status: 400 });

    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';

    if (proposta.status === 'ACEITO') {
      return NextResponse.json({ error: 'Proposta já foi aceita' }, { status: 400 });
    }
    if (proposta.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const baseUrl = req.headers.get('origin') || `https://${req.headers.get('host') || 'fin.enturos.com'}`;
    const propostaUrl = proposta.link_publico || `${baseUrl}/p/${slug}`;

    // Registra o feedback no array de feedbacks da proposta (pra historico)
    if (!Array.isArray(proposta.feedbacks)) proposta.feedbacks = [];
    proposta.feedbacks.push({
      id: `fb-${Date.now()}`,
      tipo: 'ALTERACAO',
      mensagem: anotacao,
      nome, telefone, email,
      data: new Date().toISOString(),
      ip,
    });
    proposta.atualizado_em = new Date().toISOString();
    await pool.query(
      `UPDATE propostas SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

    let resultado: Awaited<ReturnType<typeof processarEventoPropostaPublica>> | undefined;
    if (tenantId) {
      resultado = await processarEventoPropostaPublica({
        pool,
        tenantId,
        propostaId: rows[0].id,
        propostaUrl,
        proposta,
        nome, telefone, email,
        tipo: 'alteracao',
        anotacao,
        ip,
        requestId,
      });
    }

    if (tenantId && resultado && !resultado.duplicado && resultado.syncStatus === 'ok') {
      const cliente = proposta.cliente_nome || nome;
      const numero = proposta.numero || rows[0].id;
      const descricao = resultado.matchedExisting
        ? `Alteração registrada na negociação ${resultado.vendaNumero}. Tarefa atribuída ao responsável.`
        : `Nova negociação ${resultado.vendaNumero} criada para registrar a solicitação. Tarefa atribuída.`;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_FEEDBACK',
        titulo: `${cliente} solicitou alterações na proposta ${numero}`,
        descricao,
        link: resultado.vendaId ? `/vendas/${resultado.vendaId}` : `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          cliente_nome: cliente,
          nome, telefone, email,
          anotacao,
          venda_id: resultado.vendaId,
          venda_numero: resultado.vendaNumero,
          tarefa_id: resultado.tarefaId,
          matched_existing: resultado.matchedExisting,
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
