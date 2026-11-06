import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { fecharComissoes } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';

// Fechar comissões até a data: { ate, participantes, assinatura? }. Uma pessoa com erro não trava as outras.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await contextoDaComissao(['fechar_comissoes', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as { ate?: string; participantes?: unknown; assinatura?: string } | null;
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido', codigo: 'DADOS' }, { status: 400 });
  try {
    const r = await fecharComissoes(emTransacao, ctx.exec, ctx.tenantId, {
      ate: String(corpo.ate ?? ''),
      participantes: Array.isArray(corpo.participantes) ? corpo.participantes.map(String) : [],
      assinatura: corpo.assinatura ? String(corpo.assinatura) : undefined,
    }, ctx.usuario);
    return NextResponse.json(r);
  } catch (e) { return respostaDeErroDaComissao(e); }
}
