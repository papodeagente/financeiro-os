import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { EntradaItem, EntradaVenda } from '@/lib/produtos-vendidos';

/**
 * Produtos vendidos que chegaram ao financeiro.
 *
 * Uma consulta só, com join, em vez de carregar as duas tabelas inteiras
 * para o navegador: a lista de itens cresce por venda, não por produto
 * cadastrado, então ela só aumenta.
 */
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    const { rows } = await pool.query(
      `SELECT i.id,
              i.venda_id,
              i.data                       AS item,
              v.data->>'numero'            AS numero,
              v.data->>'data_venda'        AS data_venda,
              v.data->>'status'            AS status,
              v.data->>'cliente_nome'      AS cliente_nome,
              v.data->>'vendedor_nome'     AS vendedor_nome
         FROM itens_venda i
         JOIN vendas_crm v
           ON v.id = i.venda_id AND v.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1
          AND COALESCE(i.status, 'ativo') <> 'cancelado'
        ORDER BY v.data->>'data_venda' DESC NULLS LAST, i.sequencia ASC`,
      [tenantId],
    );

    const itens: EntradaItem[] = rows.map(r => ({
      id: r.id as string,
      venda_id: r.venda_id as string,
      data: r.item ?? {},
    }));

    // As vendas vêm do mesmo join, sem segunda consulta. Deduplicadas por id.
    const mapaVendas = new Map<string, EntradaVenda>();
    for (const r of rows) {
      if (mapaVendas.has(r.venda_id as string)) continue;
      mapaVendas.set(r.venda_id as string, {
        id: r.venda_id as string,
        numero: (r.numero as string) || '',
        data_venda: (r.data_venda as string) || '',
        status: (r.status as string) || '',
        cliente_nome: (r.cliente_nome as string) || '',
        vendedor_nome: (r.vendedor_nome as string) || '',
      });
    }

    return NextResponse.json({ itens, vendas: [...mapaVendas.values()] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
