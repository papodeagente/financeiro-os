import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { reabrirFatura } from '@/lib/fatura-servidor';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Reabrir fatura (direito reabrir_fatura) com motivo. Fatura recebida ou com cobrança valendo não reabre.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('reabrir_fatura');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = (await lerJson<{ motivo?: string }>(req)) ?? {};
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(e => reabrirFatura(e, tenantId, id, { usuario: usuarioDaFatura(sessao), motivo: String(corpo.motivo ?? '') }));
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
