import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeVerVenda, podeExcluir } from '@/lib/permissoes';
import { emTransacao, estornarBaixaDaConta, STATUS_BAIXADOS } from '@/lib/caixa-atomico';

const TABLE = 'vendas_crm';
const INDEX_COLS = ['cliente_id', 'vendedor_id', 'status'];

const TABELAS_CONTAS = ['contas_receber', 'contas_pagar'] as const;
const STATUS_BAIXADOS_SQL = [...STATUS_BAIXADOS];

// Cancela as contas auto_geradas da venda que ainda estão em aberto.
// Contas já baixadas (RECEBIDO/PARCIAL/PAGO) NÃO são tocadas: o dinheiro já
// se moveu e cancelar sem estorno deixaria o saldo bancário mentindo — para
// desfazer uma baixa, o caminho é o endpoint da própria conta.
async function cancelarContasDaVenda(vendaId: string, tenantId: string): Promise<void> {
  for (const tabela of TABELAS_CONTAS) {
    await pool!.query(
      `UPDATE ${tabela}
          SET data = jsonb_set(data, '{status}', '"CANCELADO"'::jsonb, true),
              status = 'CANCELADO',
              updated_at = NOW()
        WHERE tenant_id = $1
          AND data->>'origem_venda_id' = $2
          AND data->>'auto_gerado' = 'true'
          AND NOT (COALESCE(data->>'status', '') = ANY($3::text[]))
          AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
      [tenantId, vendaId, STATUS_BAIXADOS_SQL],
    );
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const session = await getSession();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const venda = rows[0].data;
    // Vendedor só vê a própria venda — 404 (mesmo comportamento de não-existente)
    if (session && !podeVerVenda(session, venda.vendedor_id || '')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(venda);
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
    if (!pool) return NextResponse.json(item);

    const tenantId = await getTenantId();
    // Get previous status
    const { rows: prev } = await pool.query(`SELECT status FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const prevStatus = prev.length > 0 ? prev[0].status : null;

    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const setClauses = ['data = $2', 'updated_at = NOW()'];

    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 3;
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      setClauses.push(`${col} = $${paramNum}`);
    });

    paramValues.push(tenantId);
    const tenantParamNum = paramValues.length;
    await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamNum}`,
      paramValues
    );

    // CRM: emit sale cancelled.
    // A UI grava CANCELADO em maiúsculo — comparar minúsculo fixo deixava o
    // cancelamento passar batido (evento não emitido, contas em aberto vivas).
    const statusAnterior = String(prevStatus ?? '').toLowerCase();
    const statusNovo = String(item.status ?? '').toLowerCase();
    if (statusNovo === 'cancelado' && statusAnterior !== 'cancelado') {
      // Contas geradas por esta venda que ainda estão em aberto morrem junto,
      // senão continuam inflando "a receber/a pagar" pra sempre.
      await cancelarContasDaVenda(id, tenantId);
      emitirEventoCRM('VENDA_CANCELADA', {
        venda_id: id,
        motivo: item.motivo ?? 'nao informado',
        cancelado_por: item.cancelado_por ?? '',
      }, { tenantId });
    }

    return NextResponse.json(item);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const session = await getSession();
    // Só ADMIN pode excluir (OPERADOR/VENDEDOR bloqueados)
    if (!podeExcluir(session)) {
      return NextResponse.json({ error: 'Sem permissão para excluir' }, { status: 403 });
    }
    if (pool) {
      const tenantId = await getTenantId();
      // Excluir a venda sem levar junto as contas auto_geradas deixava órfãs
      // PENDENTE inflando os KPIs pra sempre. As baixadas são estornadas na
      // conta bancária que recebeu/pagou antes de sumir.
      await emTransacao(async exec => {
        for (const tabela of TABELAS_CONTAS) {
          const { rows } = await exec.query(
            `DELETE FROM ${tabela}
              WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'
              RETURNING data`,
            [tenantId, id],
          );
          for (const r of rows) {
            await estornarBaixaDaConta(tenantId, tabela, r.data as Record<string, unknown>, exec);
          }
        }
        await exec.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
