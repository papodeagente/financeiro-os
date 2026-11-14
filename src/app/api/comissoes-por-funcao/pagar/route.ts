import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { pagarComissoes } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';

// Pagar comissões: { modo: 'TOTAL'|'PARCIAL', pessoas, valor_centavos? } → uma conta por pessoa.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await contextoDaComissao(['pagar_comissoes', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as { modo?: string; pessoas?: unknown; valor_centavos?: unknown } | null;
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido', codigo: 'DADOS' }, { status: 400 });
  try {
    const r = await pagarComissoes(emTransacao, ctx.exec, ctx.tenantId, {
      modo: corpo.modo === 'PARCIAL' ? 'PARCIAL' : 'TOTAL',
      pessoas: Array.isArray(corpo.pessoas) ? corpo.pessoas.map(String) : [],
      valor_centavos: corpo.valor_centavos === undefined ? undefined : Number(corpo.valor_centavos),
    }, ctx.usuario);
    return NextResponse.json(r);
  } catch (e) { return respostaDeErroDaComissao(e); }
}
