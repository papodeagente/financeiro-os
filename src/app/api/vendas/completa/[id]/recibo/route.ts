import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { lerReciboDaVenda } from '@/lib/recibo-da-venda-servidor';

// Recibo da venda (E7): GET ?pagante=<chave> → { recibo, pagantes }; sem pagamento recebido → 422 { error, pagantes }.
// Quem vê a venda vê o recibo (o vendedor sem "ver vendas de todos" só as dele).
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  try {
    const pagante = new URL(req.url).searchParams.get('pagante');
    const r = await lerReciboDaVenda(pool as unknown as ExecutorSQL, acesso.tenantId, id, { pagante, hoje: hojeISO() });
    if (!r) return NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404, headers: HEADERS });
    if (!r.ok) return NextResponse.json({ error: r.motivo, pagantes: r.pagantes }, { status: 422, headers: HEADERS });
    return NextResponse.json({ recibo: r.recibo, pagantes: r.pagantes }, { headers: HEADERS });
  } catch (e) {
    console.error('[recibo-venda] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível montar o recibo. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
