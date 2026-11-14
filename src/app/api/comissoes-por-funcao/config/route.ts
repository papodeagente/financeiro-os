import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { lerConfigComissao, salvarConfigComissao } from '@/lib/comissao-funcoes-servidor';

// Configurações › Comissões: regra de hoje × por função, liberar na venda ou no recebimento.
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await contextoDaComissao();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.ver_todos && !ctx.ver_proprias) return NextResponse.json({ error: 'Seu acesso não inclui comissões.', codigo: 'SEM_DIREITO' }, { status: 403 });
  try {
    return NextResponse.json(await lerConfigComissao(ctx.exec, ctx.tenantId));
  } catch (e) { return respostaDeErroDaComissao(e); }
}

export async function PUT(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido', codigo: 'DADOS' }, { status: 400 });
  try {
    return NextResponse.json(await salvarConfigComissao(ctx.exec, ctx.tenantId, corpo, ctx.usuario));
  } catch (e) { return respostaDeErroDaComissao(e); }
}
