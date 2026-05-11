import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM, normalizeCnpj } from '@/lib/crm-integration';

const TABLE = 'fornecedores_crm';
const INDEX_COLS = ['nome_fantasia', 'cnpj', 'categoria'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { id } = await params;
    const { rows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();

    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const setClauses = ['data = $2', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 3;
      paramValues.push(item[col] ?? '');
      setClauses.push(`${col} = $${paramNum}`);
    });
    paramValues.push(tenantId);
    const tenantParamNum = paramValues.length;
    await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamNum}`,
      paramValues,
    );

    // CRM: same FORNECEDOR_CADASTRADO event (handler é upsert idempotente)
    try {
      emitirEventoCRM('FORNECEDOR_CADASTRADO', {
        fornecedor_id: id,
        external_id: `entur_fornecedor_${id}`,
        nome_fantasia: item.nome_fantasia ?? '',
        razao_social: item.razao_social ?? '',
        cnpj: normalizeCnpj(item.cnpj),
        tipo: item.tipo ?? 'OUTROS',
        telefone: item.telefone ?? '',
        email: item.email ?? '',
        whatsapp: item.whatsapp ?? '',
        contato_principal: item.contato_principal ?? '',
        endereco_completo: item.endereco_completo ?? '',
        cidade: item.cidade ?? '',
        estado: item.estado ?? '',
        regras_faturamento: item.regras_faturamento ?? null,
        atualizado: true,
      }, { tenantId });
    } catch (e) {
      console.error('[FORNECEDOR_CADASTRADO] falha ao emitir', e);
    }

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();
    await pool.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
