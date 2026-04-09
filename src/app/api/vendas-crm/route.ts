import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';
import { gerarContasVenda, type ItemVendaInput, type FornecedorInfo } from '@/lib/venda-financeiro';

const TABLE = 'vendas_crm';
const INDEX_COLS = ['cliente_id', 'vendedor_id', 'status'];

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
    return NextResponse.json(rows.map(r => r.data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const body = await req.json();
    if (!pool) return NextResponse.json(body.venda || body);

    const tenantId = await getTenantId();

    // Detecta fluxo: se body.itens existe → novo fluxo transacional
    const hasItens = Array.isArray(body.itens) && body.itens.length > 0;

    if (hasItens) {
      return await postComItens(body, tenantId);
    } else {
      return await postLegado(body, tenantId);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================
// Fluxo legado (sem itens — comportamento existente)
// ============================================================

async function postLegado(item: Record<string, unknown>, tenantId: string) {
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

  await pool!.query(
    `INSERT INTO ${TABLE} (${insertCols.join(', ')}, created_at, updated_at)
     VALUES (${insertVals.join(', ')}, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}`,
    paramValues,
  );

  emitirEventoCRM('VENDA_CRIADA', {
    venda_id: item.id,
    cliente_id: item.cliente_id,
    vendedor_id: item.vendedor_id,
    grupo_id: item.grupo_id,
    proposta_id: item.proposta_id,
    valor_total: item.valor_total,
  });

  return NextResponse.json(item);
}

// ============================================================
// Fluxo com itens + geração automática de contas (transacional)
// ============================================================

interface PostComItensBody {
  venda: Record<string, unknown>;
  itens: ItemVendaInput[];
  cliente_nome: string;
}

async function postComItens(body: PostComItensBody, tenantId: string) {
  const { venda, itens, cliente_nome } = body;
  const client = await pool!.connect();

  try {
    await client.query('BEGIN');

    // 1. Upsert venda
    const vendaData = {
      ...venda,
      itens_count: itens.length,
      contas_geradas: true,
      contas_geradas_em: new Date().toISOString(),
    };

    const vendaParams: unknown[] = [venda.id, tenantId, JSON.stringify(vendaData)];
    const vendaCols = ['id', 'tenant_id', 'data'];
    const vendaVals = ['$1', '$2', '$3'];
    const vendaUpdates = ['data = $3', 'updated_at = NOW()'];

    INDEX_COLS.forEach((col, i) => {
      const pn = i + 4;
      vendaParams.push(venda[col] ?? '');
      vendaCols.push(col);
      vendaVals.push(`$${pn}`);
      vendaUpdates.push(`${col} = $${pn}`);
    });

    await client.query(
      `INSERT INTO ${TABLE} (${vendaCols.join(', ')}, created_at, updated_at)
       VALUES (${vendaVals.join(', ')}, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${vendaUpdates.join(', ')}`,
      vendaParams,
    );

    // 2. Upsert itens
    for (const item of itens) {
      await client.query(
        `INSERT INTO itens_venda (id, tenant_id, venda_id, fornecedor_id, sequencia, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           venda_id = $3, fornecedor_id = $4, sequencia = $5, status = $6, data = $7::jsonb, updated_at = NOW()`,
        [item.id, tenantId, item.venda_id, item.fornecedor_id, item.sequencia, item.status, JSON.stringify(item.data)],
      );
    }

    // 3. Fetch fornecedores relevantes
    const fornecedorIds = [...new Set(itens.map(i => i.fornecedor_id).filter(Boolean))];
    const fornecedores: FornecedorInfo[] = [];
    if (fornecedorIds.length > 0) {
      const placeholders = fornecedorIds.map((_, i) => `$${i + 2}`).join(',');
      const { rows } = await client.query(
        `SELECT data FROM fornecedores_crm WHERE tenant_id = $1 AND id IN (${placeholders})`,
        [tenantId, ...fornecedorIds],
      );
      for (const r of rows) {
        const f = r.data;
        fornecedores.push({
          id: f.id,
          nome_fantasia: f.nome_fantasia,
          regras_faturamento: f.regras_faturamento,
        });
      }
    }

    // 4. Gerar contas
    const resultado = gerarContasVenda({
      venda: vendaData as never,
      itens,
      fornecedores,
      cliente_nome: cliente_nome || '',
    });

    // 5. Deletar contas auto_gerado=true anteriores (idempotência)
    await client.query(
      `DELETE FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
      [tenantId, venda.id],
    );
    await client.query(
      `DELETE FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
      [tenantId, venda.id],
    );

    // 6. Insert contas a receber
    for (const cr of resultado.contas_receber) {
      await client.query(
        `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
        [cr.id, tenantId, cr.venda_id || '', cr.cliente_id || '', cr.status, JSON.stringify(cr)],
      );
    }

    // 7. Insert contas a pagar
    for (const cp of resultado.contas_pagar) {
      await client.query(
        `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
        [cp.id, tenantId, cp.fornecedor_id || '', cp.status, JSON.stringify(cp)],
      );
    }

    await client.query('COMMIT');

    // Fire-and-forget CRM event (after commit)
    emitirEventoCRM('VENDA_CRIADA', {
      venda_id: venda.id,
      cliente_id: venda.cliente_id,
      vendedor_id: venda.vendedor_id,
      grupo_id: venda.grupo_id,
      valor_total: venda.valor_final,
      itens_count: itens.length,
      contas_receber: resultado.contas_receber.length,
      contas_pagar: resultado.contas_pagar.length,
    });

    return NextResponse.json({
      venda: vendaData,
      itens,
      resumo: resultado.resumo,
      contas_receber_count: resultado.contas_receber.length,
      contas_pagar_count: resultado.contas_pagar.length,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
