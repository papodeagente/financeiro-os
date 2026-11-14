import { NextResponse } from 'next/server';
import { contextoDaComissao, quemFechaDo, respostaDeErroDaComissao, ISO_DATA } from '@/lib/comissao-rota';
import { previaDoFechamento } from '@/lib/comissao-funcoes-servidor';
import { hojeISO } from '@/lib/money';

// Prévia do Fechar comissões até a data. Quem não vê a equipe vê só as suas;
// as funções que outra pessoa fecha (Equipe › Funções) não aparecem.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await contextoDaComissao();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.ver_todos && !ctx.ver_proprias) return NextResponse.json({ error: 'Seu acesso não inclui comissões.', codigo: 'SEM_DIREITO' }, { status: 403 });
  const u = new URL(req.url).searchParams;
  const ate = u.get('ate') ?? hojeISO();
  if (!ISO_DATA.test(ate)) return NextResponse.json({ error: 'Data inválida.', codigo: 'DADOS' }, { status: 400 });
  try {
    return NextResponse.json(await previaDoFechamento(ctx.exec, ctx.tenantId, ate, {
      funcao_id: u.get('funcao_id') || undefined,
      pessoa_id: ctx.ver_todos ? undefined : ctx.usuario.id,
      quem: ctx.ver_todos ? await quemFechaDo(ctx) : undefined,
    }));
  } catch (e) { return respostaDeErroDaComissao(e); }
}
