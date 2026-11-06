import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { fecharVenda } from '@/lib/venda-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';

// Fechar venda (direito `fechar_venda`). { confirmar: true } aceita produto com receita zero.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('fechar_venda');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = (await req.json().catch(() => ({}))) as { confirmar?: boolean };
  try {
    await emTransacao(e => fecharVenda(e, acesso.tenantId, id, { usuario: usuarioDa(acesso.sessao), confirmar: corpo?.confirmar === true }));
    return NextResponse.json(await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao));
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
