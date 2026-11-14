import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { levarSaldoParaProxima } from '@/lib/fatura-servidor';
import { montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Pagamento parcial: leva o que falta para a próxima fatura do pagante, como nota de débito explicada. Repetir não duplica.
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(e => levarSaldoParaProxima(e, tenantId, id, { usuario: usuarioDaFatura(sessao) }));
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
