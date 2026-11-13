import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { enviarFornecedorAoCrm, enviarRemocaoDeFornecedorAoCrm } from '@/lib/crm-integration';

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

    // O CRM recebe o cadastro como ficou, com o vínculo (se já houver).
    void enviarFornecedorAoCrm(tenantId, id);

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
    const { rows } = await pool.query(
      `DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2 RETURNING crm_supplier_id`,
      [id, tenantId],
    );
    // Apagado aqui, desativado no CRM: negociações antigas citam o fornecedor.
    if (rows.length > 0) {
      void enviarRemocaoDeFornecedorAoCrm(tenantId, {
        id,
        crmSupplierId: rows[0].crm_supplier_id == null ? null : String(rows[0].crm_supplier_id),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
