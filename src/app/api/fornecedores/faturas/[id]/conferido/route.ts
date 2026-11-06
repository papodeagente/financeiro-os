import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { marcarItemConferido } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor, texto } from '@/lib/fornecedor-rota';

// Marca um item da fatura do fornecedor como conferido (ou tira a marca). Não muda valores.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('gerar_fatura_fornecedor');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId, usuario } = await contexto();
  const { id } = await ctx.params;
  const c = await corpo(req);
  try {
    return NextResponse.json(await emTransacao(e => marcarItemConferido(e, tenantId, id, texto(c.conta_pagar_id), c.conferido !== false, usuario)));
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
