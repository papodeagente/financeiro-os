import { recusaFinanceira, recusaExclusao, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { emTransacao, estornarBaixaDaConta, ErroMovimentoCaixa } from '@/lib/caixa-atomico';
import { editarConta, ErroEdicaoConta } from '@/lib/baixa-de-conta';
import { prepararDimensoesDaConta } from '@/lib/dimensoes';
import { getSession } from '@/lib/auth';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { conferirEdicaoDoTitulo, type SessaoDaBaixa } from '@/lib/baixas-porteiro';
import { tituloForaDasEmpresas, type ExecutorEmpresas } from '@/lib/empresas-servidor';

const TABLE = 'contas_pagar';
const INDEX_COLS = ['fornecedor_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    // Título de empresa não liberada para a pessoa (E7): como se não existisse.
    if (await tituloForaDasEmpresas(pool as unknown as ExecutorEmpresas, await getSession(), TABLE, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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

// PUT detecta transição de status para sincronizar saldo (pagamento = débito):
//  PENDENTE→PAGO  => debita o valor da conta escolhida (ou Caixa Geral)
//  PAGO→PENDENTE  => estorna (crédito) na conta que PAGOU o dinheiro, que é
//                    prev.conta_bancaria_id — NUNCA a do payload novo
//  PAGO→PAGO      => se trocou a conta, devolve o valor antigo à conta antiga
//                    e debita o novo na nova; se só mudou o valor, ajusta a
//                    diferença na mesma conta
// A baixa é idempotente: a linha fica travada durante a edição, e o segundo
// PUT de um duplo clique encontra a conta já baixada — debita o caixa uma vez só.
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
    // Rateio preenchido fecha 100% e o valor em centavos (05/11/2026).
    const rateioInvalido = prepararDimensoesDaConta(item as Record<string, unknown>);
    if (rateioInvalido) return NextResponse.json({ error: rateioInvalido }, { status: 400 });
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();
    // Título de empresa não liberada para a pessoa (E7): como se não existisse.
    if (await tituloForaDasEmpresas(pool as unknown as ExecutorEmpresas, await getSession(), TABLE, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Perfis de acesso (05/11/2026): baixa pela edição segue as mesmas regras da liquidação.
    const barrado = await conferirEdicaoDoTitulo(
      pool as unknown as ExecutorSQL, ((await getSession()) ?? {}) as SessaoDaBaixa, tenantId, TABLE, id, item as Record<string, unknown>);
    if (barrado) return NextResponse.json({ error: barrado.message, ...(barrado.pedir ? { pedir_aprovacao: barrado.pedir } : {}) }, { status: barrado.status });
    // Linha travada, movimento calculado sobre o estado atual e caixa que não
    // se move desfaz tudo (ver src/lib/baixa-de-conta.ts).
    const gravado = await editarConta({
      tabela: TABLE,
      colunasIndice: INDEX_COLS,
      campo: 'valor_pago',
      sinal: -1,
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

// Se deletar uma conta PAGA, devolve o valor à conta que pagou.
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
    // Título de empresa não liberada para a pessoa (E7): como se não existisse.
    if (await tituloForaDasEmpresas(pool as unknown as ExecutorEmpresas, await getSession(), TABLE, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

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
