import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { excluirPlano, salvarPlano } from '@/lib/comissao-funcoes-servidor';

// Planos de comissão em matriz (faixa de meta × produto × função).
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as { plano?: unknown } | null;
  if (!corpo?.plano) return NextResponse.json({ error: 'Diga qual plano gravar.', codigo: 'DADOS' }, { status: 400 });
  try {
    return NextResponse.json(await salvarPlano(ctx.exec, ctx.tenantId, corpo.plano));
  } catch (e) { return respostaDeErroDaComissao(e); }
}

export async function DELETE(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    await excluirPlano(ctx.exec, ctx.tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
