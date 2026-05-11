import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { buildProdutoPayload } from '@/lib/crm-integration';
import type { GrupoViagem } from '@/lib/types';

// Mostra exatamente o que o Financeiro enviaria como payload de
// PRODUTO_PUBLICADO para este grupo. Util para debugar
// preco_custo/preco_venda/margem zerados sem precisar disparar evento.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const { id: grupoId } = await params;

    const { rows } = await pool.query(
      `SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`,
      [grupoId, tenantId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Grupo nao encontrado' }, { status: 404 });
    }
    const grupo: GrupoViagem = rows[0].data;

    let payload: Record<string, unknown> | null = null;
    let buildError: string | null = null;
    try {
      payload = buildProdutoPayload(grupo);
    } catch (e) {
      buildError = e instanceof Error ? e.message : 'desconhecido';
    }

    // Resumo focado nos campos-chave do CRM
    const resumo = payload ? {
      preco_custo: payload.preco_custo,
      preco_venda: payload.preco_venda,
      margem: payload.margem,
      margem_percentual: payload.margem_percentual,
      moeda: payload.moeda,
      qtd_fornecedores: Array.isArray(payload.fornecedores) ? payload.fornecedores.length : 0,
    } : null;

    return NextResponse.json({
      grupo_id: grupoId,
      tenant_id: tenantId,
      build_error: buildError,
      resumo_headline: resumo,
      payload_completo: payload,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
