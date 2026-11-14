import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { contasPermitidas } from '@/lib/permissoes-servidor';
import { lerReciboDaFatura } from '@/lib/recibo-da-venda-servidor';

// Recibo consolidado da fatura ao cliente (E7): GET → ReciboDaFatura; sem recebimento → 422 { error }.
// A fatura baixada numa conta bancária que a pessoa não enxerga some, como nas listas.
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
  const { id } = await ctx.params;
  try {
    const sessao = await getSession();
    const r = await lerReciboDaFatura(pool as unknown as ExecutorSQL, await getTenantId(), id, hojeISO());
    if (!r) return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404, headers: HEADERS });
    const liberadas = await contasPermitidas(sessao);
    if (liberadas !== null && r.conta_bancaria_id && !liberadas.includes(r.conta_bancaria_id)) {
      return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404, headers: HEADERS });
    }
    if (!r.resultado.ok) return NextResponse.json({ error: r.resultado.motivo }, { status: 422, headers: HEADERS });
    return NextResponse.json(r.resultado.recibo, { headers: HEADERS });
  } catch (e) {
    console.error('[recibo-fatura] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível montar o recibo. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
