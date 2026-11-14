import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { descricaoDaRegra } from '@/lib/fatura-regras';
import { carregarRegra, desativarRegra, salvarRegra } from '@/lib/fatura-servidor';
import { lerJson, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Uma regra de faturamento: GET, PUT { regra } e DELETE (desliga; as faturas que ela montou ficam).
// Mudar a regra não mexe nas faturas abertas: a tela oferece "Recalcular vencimentos" com a prévia.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  try {
    const regra = await carregarRegra(pool as unknown as ExecutorSQL, await getTenantId(), id);
    if (!regra) return NextResponse.json({ error: 'Regra não encontrada.', codigo: 'NAO_ACHOU' }, { status: 404 });
    return NextResponse.json({ regra, descricao_curta: descricaoDaRegra(regra) });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = await lerJson<{ regra?: Record<string, unknown> }>(req);
  if (!corpo?.regra) return NextResponse.json({ error: 'Mande a regra.', codigo: 'DADOS' }, { status: 400 });
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(await getSession());
  try {
    const regra = await emTransacao(e => salvarRegra(e, tenantId, { ...corpo.regra, id }, usuario));
    return NextResponse.json({ regra, descricao_curta: descricaoDaRegra(regra) });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const tenantId = await getTenantId();
  try {
    await emTransacao(e => desativarRegra(e, tenantId, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
