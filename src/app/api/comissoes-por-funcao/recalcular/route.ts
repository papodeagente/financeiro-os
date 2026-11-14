import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { recalcularComissoes } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';
import { recusaModulo } from '@/lib/guarda-rota';

// O cálculo do dia, agora (a tarefa do agendador faz o mesmo de madrugada).
export const dynamic = 'force-dynamic';

export async function POST() {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao(['ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await emTransacao(e => recalcularComissoes(e, ctx.tenantId)));
  } catch (e) { return respostaDeErroDaComissao(e); }
}
