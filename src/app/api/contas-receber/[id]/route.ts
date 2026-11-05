import { recusaFinanceira, recusaExclusao, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { emTransacao, estornarBaixaDaConta, ErroMovimentoCaixa } from '@/lib/caixa-atomico';
import { editarConta, ErroEdicaoConta } from '@/lib/baixa-de-conta';

const TABLE = 'contas_receber';
const INDEX_COLS = ['venda_id', 'cliente_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e) {
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT detecta transição de status para sincronizar saldo da conta bancária:
//  PENDENTE→RECEBIDO  => credita o valor na conta escolhida (ou Caixa Geral)
//  RECEBIDO→PENDENTE  => estorna (débito) na conta que RECEBEU o dinheiro,
//                        que é prev.conta_bancaria_id — NUNCA a do payload novo
//  RECEBIDO→RECEBIDO  => se trocou a conta, debita o valor antigo na conta
//                        antiga e credita o novo na nova; se só mudou o valor,
//                        ajusta a diferença na mesma conta
// A baixa é idempotente: a linha fica travada durante a edição, e o segundo
// PUT de um duplo clique encontra a conta já baixada — credita o caixa uma vez só.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    }
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();
    // Linha travada, movimento calculado sobre o estado atual e caixa que não
    // se move desfaz tudo (ver src/lib/baixa-de-conta.ts).
    const gravado = await editarConta({
      tabela: TABLE,
      colunasIndice: INDEX_COLS,
      campo: 'valor_recebido',
      sinal: +1,
      id,
      tenantId,
      item: item as Record<string, unknown>,
    });
    return NextResponse.json(gravado);
  } catch (e) {
    if (e instanceof ErroEdicaoConta || e instanceof ErroMovimentoCaixa) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Se deletar uma conta RECEBIDA, reverte o saldo na conta que recebeu.
// O DELETE ... RETURNING garante que dois DELETEs concorrentes estornem
// uma vez só (o segundo não devolve linha).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();

    await emTransacao(async exec => {
      const { rows } = await exec.query(
        `DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2 RETURNING data`,
        [id, tenantId],
      );
      const data = rows[0]?.data as Record<string, unknown> | undefined;
      if (data) await estornarBaixaDaConta(tenantId, TABLE, data, exec);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
