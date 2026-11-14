import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaExclusao, recusaFinanceira, respostaPeriodoFechado, recusaModulo } from '@/lib/guarda-rota';
import { contasPermitidas, pode, type ExecutorPermissoes } from '@/lib/permissoes-servidor';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { ErroDoLote, executarLote, lerPedido, type QuemPedeLote } from '@/lib/contas-em-lote';

/**
 * Ações em lote da lista Contas a Pagar/Receber (05/11/2026).
 *
 *   POST { modo: 'previa' | 'gravar', acao: 'reagendar' | 'recategorizar' | 'excluir',
 *          itens: [{ tabela, id }], assinatura?, nova_data? | dias?, categoria_id?, centro_custo_id? }
 *
 * A prévia diz o que muda e o que fica de fora, conta por conta. Gravar
 * recebe só as contas prontas e a assinatura da prévia, numa transação.
 * Liquidar em lote é sempre POST /api/baixas.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const gravar = corpo?.modo === 'gravar';
    const recusa = await recusaFinanceira(gravar ? 'escrever' : 'ler');
    if (recusa) return recusa;
    const pedido = lerPedido(corpo);
    // Excluir pede o perfil que exclui, já na prévia: a tela não oferece o que não vai poder fazer.
    if (pedido.acao === 'excluir') {
      const semExcluir = await recusaExclusao();
      if (semExcluir) return semExcluir;
    } else if (!gravar) {
      const semEditar = await recusaFinanceira('escrever');
      if (semEditar) return semEditar;
    }
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const tenantId = await getTenantId();
    const sessao = await getSession();
    const hoje = hojeISO();
    const assinatura = typeof corpo?.assinatura === 'string' ? corpo.assinatura : undefined;

    const quemNo = async (exec: ExecutorSQL): Promise<QuemPedeLote> => ({
      pode: acao => pode(sessao, acao, { exec: exec as unknown as ExecutorPermissoes }),
      contasLiberadas: await contasPermitidas(sessao, exec as unknown as ExecutorPermissoes),
      usuario: { id: sessao?.userId ?? null, nome: sessao?.nome ?? null },
    });

    if (!gravar) {
      const exec = pool as unknown as ExecutorSQL;
      return NextResponse.json(await executarLote(exec, tenantId, pedido, await quemNo(exec), hoje, { gravar: false }));
    }
    const r = await emTransacao(async exec => executarLote(exec, tenantId, pedido, await quemNo(exec), hoje, { gravar: true, assinatura }));
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErroDoLote) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    console.error('[contas-pagar-receber/lote]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível concluir. Nada foi alterado.' }, { status: 500 });
  }
}
