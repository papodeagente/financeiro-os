import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { fecharFatura } from '@/lib/fatura-servidor';
import { montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Fechar fatura (direito fechar_fatura): trava os itens e libera a cobrança e a conferência do cliente. Repetir não muda nada.
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('fechar_fatura');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(e => fecharFatura(e, tenantId, id, { usuario: usuarioDaFatura(sessao) }));
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
