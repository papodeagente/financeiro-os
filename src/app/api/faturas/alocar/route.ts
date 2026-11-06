import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { alocarItens } from '@/lib/fatura-servidor';
import { lerJson, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// "Montar faturas agora": junta pela regra os itens a faturar ainda soltos. Idempotente.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await lerJson<{ venda_id?: string; pessoa_id?: string }>(req)) ?? {};
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(await getSession());
  try {
    const r = await emTransacao(e => alocarItens(e, tenantId, {
      venda_id: typeof corpo.venda_id === 'string' ? corpo.venda_id : undefined,
      pessoa_id: typeof corpo.pessoa_id === 'string' ? corpo.pessoa_id : undefined,
    }, { usuario }));
    return NextResponse.json(r);
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
