import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { excluirFuncao, salvarFuncao } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';

// Funções e quem está em cada uma (plano, início, sem comissão).
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as { funcao?: unknown; pessoas?: unknown[] } | null;
  if (!corpo?.funcao) return NextResponse.json({ error: 'Diga qual função gravar.', codigo: 'DADOS' }, { status: 400 });
  try {
    return NextResponse.json(await emTransacao(e => salvarFuncao(e, ctx.tenantId, { funcao: corpo.funcao, pessoas: Array.isArray(corpo.pessoas) ? corpo.pessoas : undefined })));
  } catch (e) { return respostaDeErroDaComissao(e); }
}

export async function DELETE(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    await emTransacao(e => excluirFuncao(e, ctx.tenantId, id));
    return NextResponse.json({ ok: true });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
