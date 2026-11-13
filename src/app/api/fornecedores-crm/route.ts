import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { enviarFornecedorAoCrm } from '@/lib/crm-integration';

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
    // Guarda de tenant no conflito: fornecedor carrega regras_faturamento,
    // que alimentam a geração de contas a pagar. Sobrescrever o fornecedor
    // de outro tenant alteraria as contas geradas nas vendas dele.
    await pool.query(
      `INSERT INTO ${TABLE} (${insertCols.join(', ')}, created_at, updated_at)
       VALUES (${insertVals.join(', ')}, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}
       WHERE ${TABLE}.tenant_id = EXCLUDED.tenant_id`,
      paramValues,
    );

    // O CRM recebe o cadastro como ficou, com o vínculo (se já houver).
    void enviarFornecedorAoCrm(tenantId, String(item.id));

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
