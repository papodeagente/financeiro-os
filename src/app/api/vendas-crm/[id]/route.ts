import { vendaAutorizada } from '@/lib/venda-autorizada';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeVerTodasVendas, podeExcluir } from '@/lib/permissoes';
import { emTransacao, estornarBaixaDaConta, type ExecutorSQL } from '@/lib/caixa-atomico';
import { cancelarContasDaVenda } from '@/lib/venda-cancelamento';

const TABLE = 'vendas_crm';
const INDEX_COLS = ['cliente_id', 'vendedor_id', 'status'];

const TABELAS_CONTAS = ['contas_receber', 'contas_pagar'] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    // Vendedor só vê a própria venda — 404 (mesmo comportamento de não-existente)
    const acesso = await vendaAutorizada(id);
    if (acesso instanceof NextResponse) return acesso;
    return NextResponse.json(acesso.venda);
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

    const acesso = await vendaAutorizada(id);
    if (acesso instanceof NextResponse) return acesso;
    const { tenantId, sessao, venda: anterior } = acesso;
    // Quem só vê as próprias vendas não passa a venda para outra pessoa
    // (nem tira dela): o vendedor_id fica o que estava.
    if (!podeVerTodasVendas(sessao)) {
      (item as Record<string, unknown>).vendedor_id = anterior.vendedor_id ?? '';
    }
    const prevStatus = (anterior.status as string | undefined) ?? null;

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
      // Mesma regra do cancelamento que chega do CRM (venda-cancelamento.ts).
      await cancelarContasDaVenda(pool as unknown as ExecutorSQL, id, tenantId);
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
