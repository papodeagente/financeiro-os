import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import type { Orcamento } from '@/lib/crm-types';

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const { proposta_id, grupo_id } = await req.json();
    if (!proposta_id) return NextResponse.json({ error: 'proposta_id obrigatorio' }, { status: 400 });

    // Load proposta
    const { rows: propRows } = await pool.query(`SELECT data FROM propostas WHERE id = $1`, [proposta_id]);
    if (propRows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    const proposta = propRows[0].data;

    // Generate orcamento number
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) as c FROM orcamentos`);
    const num = `ORC-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;

    const id = generateId();
    const secoes = proposta.secoes || [];

    // Extract items from SERVICO sections
    const itens = secoes
      .filter((s: { tipo: string }) => s.tipo === 'SERVICO')
      .map((s: { conteudo: { titulo?: string; descricao?: string; imagem?: string; valor?: number; detalhes?: string[] } }) => ({
        titulo: s.conteudo.titulo || '',
        descricao: s.conteudo.descricao || '',
        imagem: s.conteudo.imagem || '',
        valor: s.conteudo.valor || 0,
        observacoes: (s.conteudo.detalhes || []).join('\n'),
      }));

    // Extract payment options from VALORES sections
    const valoresSecao = secoes.find((s: { tipo: string }) => s.tipo === 'VALORES');
    const opcoes_pagamento = valoresSecao?.conteudo?.opcoes?.map((op: { titulo: string; valor_total: number; parcelas: { forma: string; valor_parcela: number; valor_total: number }[] }) => ({
      descricao: op.titulo || '',
      valor_total: op.valor_total || 0,
      parcelas: op.parcelas?.[0] ? Math.max(1, Math.round(op.parcelas[0].valor_total / (op.parcelas[0].valor_parcela || 1))) : 1,
      valor_parcela: op.parcelas?.[1]?.valor_parcela || op.parcelas?.[0]?.valor_parcela || op.valor_total || 0,
    })) || [];

    // Extract inclusos from INCLUSOS sections
    const inclusosSecao = secoes.find((s: { tipo: string }) => s.tipo === 'INCLUSOS');
    const inclusos: string[] = inclusosSecao?.conteudo?.inclusos || [];
    const nao_inclusos: string[] = inclusosSecao?.conteudo?.nao_inclusos || [];

    // Extract roteiro from ROTEIRO_DIA sections
    const roteiroSecao = secoes.find((s: { tipo: string }) => s.tipo === 'ROTEIRO_DIA');
    const roteiro = (roteiroSecao?.conteudo?.dias || []).map((d: { numero: number; titulo: string; descricao: string; imagem?: string }) => ({
      dia: d.numero,
      titulo: d.titulo || '',
      descricao: d.descricao || '',
      imagem: d.imagem || '',
    }));

    const orcamento: Orcamento = {
      id,
      numero: num,
      data_criacao: new Date().toISOString().split('T')[0],
      validade: proposta.cabecalho?.validade || '',
      cliente_id: proposta.cliente_id || '',
      vendedor_id: proposta.vendedor_id || '',
      template: {
        logo_agencia: '',
        cores: {
          primaria: proposta.visual?.cor_primaria || '#004aad',
          secundaria: proposta.visual?.cor_secundaria || '#0a0a14',
          texto: proposta.visual?.cor_texto || '#1a1a2e',
        },
        titulo: proposta.cabecalho?.titulo || '',
        subtitulo: proposta.cabecalho?.subtitulo || '',
        imagem_capa: proposta.visual?.imagem_capa || '',
        mensagem_abertura: proposta.cabecalho?.mensagem_abertura || '',
        mensagem_rodape: proposta.rodape?.mensagem || '',
        redes_sociais: {},
        whatsapp_vendedor: proposta.rodape?.whatsapp_vendedor || '',
      },
      itens,
      opcoes_pagamento,
      inclusos,
      nao_inclusos,
      roteiro,
      status: 'RASCUNHO',
      link_publico: '',
      data_visualizacao: null,
      venda_id: null,
    };

    await pool.query(
      `INSERT INTO orcamentos (id, numero, cliente_id, grupo_id, proposta_id, status, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, num, proposta.cliente_id || '', grupo_id || '', proposta_id, 'RASCUNHO', JSON.stringify(orcamento)]
    );

    // Update grupo pipeline status
    if (grupo_id) {
      const { rows: grupoRows } = await pool.query(`SELECT data FROM grupos WHERE id = $1`, [grupo_id]);
      if (grupoRows.length > 0) {
        const grupoData = { ...grupoRows[0].data, orcamento_id: id, status_pipeline: 'ORCAMENTO' };
        await pool.query(`UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(grupoData), grupo_id]);
      }
    }

    return NextResponse.json({ id, numero: num });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
