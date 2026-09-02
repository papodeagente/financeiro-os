import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import {
  aplicarMovimentoCaixaAtomico,
  atualizarContaComGuarda,
  calcularMovimentos,
  emTransacao,
  estornarBaixaDaConta,
  type ExecutorSQL,
} from '@/lib/caixa-atomico';

const TABLE = 'contas_receber';
const INDEX_COLS = ['venda_id', 'cliente_id', 'status'];

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

// PUT detecta transição de status para sincronizar saldo da conta bancária:
//  PENDENTE→RECEBIDO  => credita o valor na conta escolhida (ou Caixa Geral)
//  RECEBIDO→PENDENTE  => estorna (débito) na conta que RECEBEU o dinheiro,
//                        que é prev.conta_bancaria_id — NUNCA a do payload novo
//  RECEBIDO→RECEBIDO  => se trocou a conta, debita o valor antigo na conta
//                        antiga e credita o novo na nova; se só mudou o valor,
//                        ajusta a diferença na mesma conta
// A baixa é idempotente: o UPDATE tem guarda (versão da linha + status ainda
// diferente do alvo) e o movimento de caixa só acontece se ele afetou linha —
// duplo clique / PUT concorrente credita o caixa uma vez só.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();

    // Estado anterior + versão da linha (xmin) para a guarda otimista
    const { rows: prevRows } = await pool.query(
      `SELECT data, xmin::text AS versao FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const prev = (prevRows[0]?.data ?? {}) as Record<string, unknown>;
    const versaoAnterior = (prevRows[0]?.versao as string | undefined) ?? null;
    const prevStatus = String(prev.status ?? '');
    const novoStatus = String(item.status ?? '');

    // Movimentos derivados do VALOR BAIXADO (não do status): é isso que faz a
    // baixa PARCIAL — e a evolução de uma parcial — creditar o caixa na medida
    // certa. Aplicados só se a guarda otimista segurar.
    const movimentos = calcularMovimentos(prev, item as Record<string, unknown>, 'valor_recebido', +1);

    const params_ = {
      tabela: TABLE,
      colunasIndice: INDEX_COLS,
      id,
      tenantId,
      item: item as Record<string, unknown>,
    };

    // Edição sem efeito no caixa (descrição, vencimento, etc.) → update direto
    if (movimentos.length === 0) {
      await atualizarContaComGuarda({
        ...params_,
        exec: pool as unknown as ExecutorSQL,
        versaoAnterior: null,
        statusAlvo: null,
      });
      return NextResponse.json(item);
    }

    const aplicado = await emTransacao(async exec => {
      const ok = await atualizarContaComGuarda({
        ...params_,
        exec,
        versaoAnterior,
        statusAlvo: prevStatus !== novoStatus ? novoStatus : null,
      });
      if (!ok) return false;
      // Ordem fixa por conta: duas trocas de conta simultâneas travariam uma
      // na outra se cada transação bloqueasse as linhas em ordem diferente.
      movimentos.sort((a, b) => String(a.conta).localeCompare(String(b.conta)));
      for (const mov of movimentos) {
        await aplicarMovimentoCaixaAtomico(tenantId, mov.conta, mov.delta, exec);
      }
      return true;
    });

    if (!aplicado) {
      // Outra requisição já baixou/alterou esta conta: devolve o estado atual
      // sem creditar de novo.
      const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      return NextResponse.json(rows[0]?.data ?? item);
    }

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Se deletar uma conta RECEBIDA, reverte o saldo na conta que recebeu.
// O DELETE ... RETURNING garante que dois DELETEs concorrentes estornem
// uma vez só (o segundo não devolve linha).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
