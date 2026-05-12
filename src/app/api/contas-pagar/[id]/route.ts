import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { aplicarMovimentoCaixa } from '@/lib/caixa-helpers';

const TABLE = 'contas_pagar';
const INDEX_COLS = ['fornecedor_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT detecta transição de status para sincronizar saldo:
//  PENDENTE→PAGO  => debita o valor do Caixa Geral (ou conta escolhida)
//  PAGO→PENDENTE  => reverte (crédito)
//  PAGO→PAGO       => recalcula diferença se valor_pago mudou
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();

    // Estado anterior
    const { rows: prevRows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const prev = (prevRows[0]?.data ?? {}) as Record<string, unknown>;
    const prevStatus = String(prev.status ?? '');
    const prevValor = Number(prev.valor_pago) || Number(prev.valor_final) || 0;

    // Persiste
    const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
    const setClauses = ['data = $3', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      setClauses.push(`${col} = $${i + 4}`);
    });
    await pool.query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`, paramValues);

    // Sincroniza saldo (pagamento = débito)
    const novoStatus = String(item.status ?? '');
    const novoValor = Number(item.valor_pago) || Number(item.valor_final) || 0;
    const contaId = (item.conta_bancaria_id as string | null | undefined) || null;
    if (prevStatus !== 'PAGO' && novoStatus === 'PAGO') {
      await aplicarMovimentoCaixa(tenantId, contaId, -novoValor);
    } else if (prevStatus === 'PAGO' && novoStatus !== 'PAGO') {
      await aplicarMovimentoCaixa(tenantId, contaId, +prevValor);
    } else if (prevStatus === 'PAGO' && novoStatus === 'PAGO' && prevValor !== novoValor) {
      await aplicarMovimentoCaixa(tenantId, contaId, -(novoValor - prevValor));
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

    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const data = (rows[0]?.data ?? {}) as Record<string, unknown>;
    if (String(data.status ?? '') === 'PAGO') {
      const valor = Number(data.valor_pago) || Number(data.valor_final) || 0;
      await aplicarMovimentoCaixa(tenantId, (data.conta_bancaria_id as string | null) || null, +valor);
    }
    await pool.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
