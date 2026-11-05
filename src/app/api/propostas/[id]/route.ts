import { recusaExclusao } from '@/lib/guarda-rota';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { comLink, garantirLinkPublico, renovarLinkPublico, type Consulta } from '@/lib/proposta-publica';
import { limparHtmlDaProposta } from '@/lib/html-seguro';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

const TABLE = 'propostas';
const INDEX_COLS = ['numero', 'cliente_id', 'vendedor_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data, link_publico_url FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(comLink(rows[0].data as Record<string, unknown>, rows[0].link_publico_url));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!item || typeof item !== 'object' || Array.isArray(item)) return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    // Texto rico limpo ao gravar (FIN-07).
    limparHtmlDaProposta(item);
    if (!pool) return NextResponse.json(item);

    const tenantId = await getTenantId();
    // Get previous status to detect changes
    const { rows: prev } = await pool.query(`SELECT status FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const prevStatus = prev.length > 0 ? prev[0].status : null;

    // O que o CLIENTE escreve pela página pública (aceite, interessados,
    // comentários, visualizações) não vem da tela do editor: a tela salva
    // sozinha a cada segundo e meio com o estado de quando abriu, e regravar
    // tudo apagava um aceite ou um contato que chegasse nesse meio-tempo
    // (FIN2-07). Esses campos ficam com o valor do banco, e o status não
    // volta de ACEITO/VISUALIZADO para um anterior por causa de tela velha.
    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const statusSql = `(CASE
        WHEN ${TABLE}.data->>'status' = 'ACEITO' AND $2::jsonb->>'status' IN ('RASCUNHO','ENVIADO','VISUALIZADO') THEN 'ACEITO'
        WHEN ${TABLE}.data->>'status' = 'VISUALIZADO' AND $2::jsonb->>'status' = 'ENVIADO' THEN 'VISUALIZADO'
        ELSE COALESCE($2::jsonb->>'status', '') END)`;
    const setClauses = [
      `data = $2::jsonb || jsonb_build_object(
          'aceite', COALESCE(NULLIF(${TABLE}.data->'aceite', 'null'::jsonb), $2::jsonb->'aceite', 'null'::jsonb),
          'leads', COALESCE(${TABLE}.data->'leads', '[]'::jsonb),
          'feedbacks', COALESCE(${TABLE}.data->'feedbacks', '[]'::jsonb),
          'visualizacoes', COALESCE(${TABLE}.data->'visualizacoes', '[]'::jsonb),
          'status', ${statusSql})`,
      'updated_at = NOW()',
    ];

    for (const col of INDEX_COLS) {
      if (col === 'status') { setClauses.push(`status = ${statusSql}`); continue; }
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      setClauses.push(`${col} = $${paramValues.length}`);
    }

    paramValues.push(tenantId);
    const tenantParamNum = paramValues.length;
    const { rows: gravadas } = await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamNum} RETURNING data`,
      paramValues
    );
    if (gravadas.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const salvo = gravadas[0].data as Record<string, unknown>;
    const linkPublico = await garantirLinkPublico(pool as unknown as Consulta, tenantId, id);

    // CRM emission based on status change
    const newStatus = salvo.status;
    if (newStatus && newStatus !== prevStatus) {
      if (newStatus === 'ENVIADO') {
        emitirEventoCRM('PROPOSTA_ENVIADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          // Id INTEIRO: resolvePropostaForHost recusa slug com menos de 10
          // caracteres, e generateId produz ~15. Truncado em 8, este link
          // nunca abriu — ia para o card do contato no CRM e dava 404.
          link_publico: linkPublico,
        }, { tenantId });
      } else if (newStatus === 'ACEITO') {
        emitirEventoCRM('PROPOSTA_ACEITA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          aceite_timestamp: new Date().toISOString(),
          grupo_id: item.grupo_id,
        }, { tenantId });
      } else if (newStatus === 'REJEITADO') {
        emitirEventoCRM('PROPOSTA_REJEITADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          motivo: item.motivo ?? null,
        }, { tenantId });
      }
    }

    return NextResponse.json(comLink(salvo, linkPublico));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Troca o link público: o anterior para de abrir na hora (revogação).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'DB offline' }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    if (body?.acao !== 'trocar_link') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
    const tenantId = await getTenantId();
    const link = await renovarLinkPublico(pool as unknown as Consulta, tenantId, id);
    if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ link_publico: link });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = await recusaExclusao();
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (pool) {
      const tenantId = await getTenantId();
      await pool.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
