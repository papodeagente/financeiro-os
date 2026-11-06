import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { comissoesAPagar, lerConfigComissao } from '@/lib/comissao-funcoes-servidor';

// Comissões fechadas em aberto, por pessoa. Quem não vê a equipe vê só as suas.
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await contextoDaComissao();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.ver_todos && !ctx.ver_proprias) return NextResponse.json({ error: 'Seu acesso não inclui comissões.', codigo: 'SEM_DIREITO' }, { status: 403 });
  try {
    const [pessoas, config] = await Promise.all([
      comissoesAPagar(ctx.exec, ctx.tenantId, ctx.ver_todos ? {} : { pessoa_id: ctx.usuario.id }),
      lerConfigComissao(ctx.exec, ctx.tenantId),
    ]);
    return NextResponse.json({ regra: config.regra, so_as_suas: !ctx.ver_todos, pessoas });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
