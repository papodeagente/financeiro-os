import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { detalheDaFatura } from '@/lib/fornecedor-servidor';
import { contexto, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// Uma fatura do fornecedor com os itens (e o que cada cliente já pagou) e o sinal descontado.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const { id } = await ctx.params;
  try {
    const f = await detalheDaFatura(pool as unknown as ExecutorSQL, tenantId, id);
    if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(f);
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
