import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { criarVendaDaPropostaPublica } from '@/lib/proposta-aceite-crm';

// Cliente clicou "Solicitar Alteracoes" na view publica da proposta:
// preenche nome/telefone/email + descricao da alteracao. NAO marca a
// proposta como aceita — apenas registra o feedback e cria uma
// negociacao (Venda CRM em ORCAMENTO) com a anotacao da alteracao.
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

    if (!nome) {
      return NextResponse.json({ error: 'Nome obrigatorio' }, { status: 400 });
    }
    if (!email && !telefone) {
      return NextResponse.json({ error: 'Informe telefone ou email para contato' }, { status: 400 });
    }
    if (!anotacao) {
      return NextResponse.json({ error: 'Descreva a alteracao desejada' }, { status: 400 });
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

    let vendaCriada: { vendaId: string; vendaNumero: string; valorTotal: number } | null = null;
    if (tenantId) {
      try {
        const result = await criarVendaDaPropostaPublica({
          pool,
          tenantId,
          propostaId: rows[0].id,
          proposta,
          nome,
          telefone,
          email,
          tipo: 'alteracao',
          anotacao,
          ip,
        });
        vendaCriada = result;
      } catch (e) {
        console.error('Falha ao criar venda CRM apos solicitacao de alteracao:', e);
      }
    }

    if (tenantId) {
      const cliente = proposta.cliente_nome || nome;
      const numero = proposta.numero || rows[0].id;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_FEEDBACK',
        titulo: `${cliente} solicitou alteracoes na proposta ${numero}`,
        descricao: anotacao.length > 100 ? `${anotacao.slice(0, 97)}...` : anotacao,
        link: vendaCriada ? `/vendas/${vendaCriada.vendaId}` : `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          cliente_nome: cliente,
          nome, telefone, email,
          anotacao,
          venda_id: vendaCriada?.vendaId || null,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      venda: vendaCriada,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
