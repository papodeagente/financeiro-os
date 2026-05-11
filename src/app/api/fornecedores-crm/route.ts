import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM, normalizeCnpj } from '@/lib/crm-integration';

const TABLE = 'fornecedores_crm';
const INDEX_COLS = ['nome_fantasia', 'cnpj', 'categoria'];

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return NextResponse.json(rows.map(r => r.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const item = await req.json();
    if (!item || !item.id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 });
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();

    const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
    const insertCols = ['id', 'tenant_id', 'data'];
    const insertVals = ['$1', '$2', '$3'];
    const updateSets = ['data = $3', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 4;
      paramValues.push(item[col] ?? '');
      insertCols.push(col);
      insertVals.push(`$${paramNum}`);
      updateSets.push(`${col} = $${paramNum}`);
    });
    await pool.query(
      `INSERT INTO ${TABLE} (${insertCols.join(', ')}, created_at, updated_at)
       VALUES (${insertVals.join(', ')}, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}`,
      paramValues,
    );

    // CRM: notify supplier cadastro so the CRM can upsert in their catalog.
    // The CRM-side dedup is por (tenant_id, external_id) ou cnpj.
    try {
      emitirEventoCRM('FORNECEDOR_CADASTRADO', {
        fornecedor_id: item.id,
        external_id: `entur_fornecedor_${item.id}`,
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
