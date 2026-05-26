import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { processarEventoPropostaPublica } from '@/lib/proposta-aceite-crm';
import { isHostAuthorizedForProposta } from '@/lib/tenant-host';

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
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const nome = String(body.nome || body.nome_aceite || '').trim();
    const telefone = String(body.telefone || '').trim();
    const email = String(body.email || '').trim();
    const requestId = String(body.request_id || '').trim();

    if (!nome) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!telefone) return NextResponse.json({ error: 'Telefone obrigatório' }, { status: 400 });
    if (!email) return NextResponse.json({ error: 'E-mail obrigatório' }, { status: 400 });
    if (!validarEmail(email)) return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    if (!validarTelefone(telefone)) return NextResponse.json({ error: 'Telefone inválido (10-15 dígitos)' }, { status: 400 });

    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';

    // Se a request veio por dominio customizado, esse dominio precisa
    // pertencer ao mesmo tenant da proposta. Senao, 404 (nao vaza nada).
    if (!(await isHostAuthorizedForProposta(req, tenantId))) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    }

    if (proposta.status === 'RECUSADO') {
      return NextResponse.json({ error: 'Proposta foi recusada' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const baseUrl = req.headers.get('origin') || `https://${req.headers.get('host') || 'fin.enturos.com'}`;
    const propostaUrl = proposta.link_publico || `${baseUrl}/p/${slug}`;

    // Marca proposta como ACEITO + registra dados do aceite (mesmo se
    // ja estiver aceita, sobrescreve com dados mais recentes — pode ser
    // re-aceite com info corrigida).
    if (proposta.status !== 'ACEITO') {
      proposta.status = 'ACEITO';
      proposta.atualizado_em = new Date().toISOString();
    }
    proposta.aceite = {
      nome_aceite: nome,
      data_aceite: new Date().toISOString(),
      ip_aceite: ip,
      telefone,
      email,
    };
    await pool.query(
      `UPDATE propostas SET data = $1, status = 'ACEITO', updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

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
        propostaId: rows[0].id,
        propostaUrl,
        proposta,
        nome, telefone, email,
        tipo: 'aceite',
        ip,
        requestId,
      });
    }

    if (tenantId && resultado && !resultado.duplicado && resultado.syncStatus === 'ok') {
      const cliente = proposta.cliente_nome || nome;
      const numero = proposta.numero || rows[0].id;
      const descricao = resultado.matchedExisting
        ? `Aceite na negociação existente ${resultado.vendaNumero}. Tarefa criada para o responsável.`
        : `Aceite registrado. Nova negociação ${resultado.vendaNumero} criada no CRM com tarefa.`;
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_ACEITA',
        titulo: `${cliente} aceitou a proposta ${numero}`,
        descricao,
        link: resultado.vendaId ? `/vendas/${resultado.vendaId}` : `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          cliente_nome: cliente,
          nome_aceite: nome,
          telefone, email,
          venda_id: resultado.vendaId,
          venda_numero: resultado.vendaNumero,
          tarefa_id: resultado.tarefaId,
          matched_existing: resultado.matchedExisting,
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
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
