import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { reabrirVenda } from '@/lib/venda-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';

// Reabrir venda (direito `reabrir_venda`), com motivo. Nenhuma conta muda.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('reabrir_venda');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = (await req.json().catch(() => ({}))) as { motivo?: string };
  try {
    await emTransacao(e => reabrirVenda(e, acesso.tenantId, id, { usuario: usuarioDa(acesso.sessao), motivo: String(corpo?.motivo ?? '') }));
    return NextResponse.json(await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao));
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
