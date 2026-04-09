import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    // Fetch venda, itens, contas in parallel
    const [vendaRes, itensRes, crRes, cpRes] = await Promise.all([
      pool.query(
        `SELECT data FROM vendas_crm WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT data FROM itens_venda WHERE venda_id = $1 AND tenant_id = $2 ORDER BY sequencia ASC`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
        [tenantId, id],
      ),
      pool.query(
        `SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
        [tenantId, id],
      ),
    ]);

    if (vendaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 });
    }

    const venda = vendaRes.rows[0].data;
    const itens = itensRes.rows.map(r => r.data);
    const contas_receber = crRes.rows.map(r => r.data);
    const contas_pagar = cpRes.rows.map(r => r.data);

    // Resumo
    const total_receber = contas_receber.reduce((s, c) => s + (c.valor_final || 0), 0);
    const total_recebido = contas_receber
      .filter(c => c.status === 'RECEBIDO')
      .reduce((s, c) => s + (c.valor_recebido || c.valor_final || 0), 0);
    const total_pagar = contas_pagar.reduce((s, c) => s + (c.valor_final || 0), 0);
    const total_pago = contas_pagar
      .filter(c => c.status === 'PAGO')
      .reduce((s, c) => s + (c.valor_pago || c.valor_final || 0), 0);

    return NextResponse.json({
      venda,
      itens,
      contas_receber,
      contas_pagar,
      resumo: {
        total_receber,
        total_recebido,
        total_pendente_receber: total_receber - total_recebido,
        total_pagar,
        total_pago,
        total_pendente_pagar: total_pagar - total_pago,
        lucro_previsto: total_receber - total_pagar,
        lucro_realizado: total_recebido - total_pago,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
