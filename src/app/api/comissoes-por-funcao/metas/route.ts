import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { salvarMetas } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';

// Metas do ano de uma pessoa na função: { pessoa_funcao_id, ano, meses: [12 valores em centavos] }.
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as { pessoa_funcao_id?: string; ano?: number; meses?: unknown[] } | null;
  if (!corpo || !Array.isArray(corpo.meses)) return NextResponse.json({ error: 'Informe as metas dos 12 meses.', codigo: 'DADOS' }, { status: 400 });
  const meses = corpo.meses;
  try {
    return NextResponse.json(await emTransacao(e => salvarMetas(e, ctx.tenantId, String(corpo.pessoa_funcao_id ?? ''), Number(corpo.ano), meses)));
  } catch (e) { return respostaDeErroDaComissao(e); }
}
