import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { salvarGradeDeMetas, salvarMetas } from '@/lib/comissao-funcoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';
import { recusaModulo } from '@/lib/guarda-rota';

// Metas do ano. Uma pessoa: { pessoa_funcao_id, ano, meses: [12 valores em centavos] }.
// A grade (todas as pessoas): { ano, linhas: [{ pessoa_funcao_id, meses }] }, tudo ou nada.
export const dynamic = 'force-dynamic';

type Corpo = { pessoa_funcao_id?: string; ano?: number; meses?: unknown[]; linhas?: Array<{ pessoa_funcao_id?: unknown; meses?: unknown }> };

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao(['editar_financeiro', 'ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as Corpo | null;
  if (corpo && Array.isArray(corpo.linhas)) {
    const linhas = corpo.linhas;
    try {
      return NextResponse.json(await emTransacao(e => salvarGradeDeMetas(e, ctx.tenantId, Number(corpo.ano), linhas)));
    } catch (e) { return respostaDeErroDaComissao(e); }
  }
  if (!corpo || !Array.isArray(corpo.meses)) return NextResponse.json({ error: 'Informe as metas dos 12 meses.', codigo: 'DADOS' }, { status: 400 });
  const meses = corpo.meses;
  try {
    return NextResponse.json(await emTransacao(e => salvarMetas(e, ctx.tenantId, String(corpo.pessoa_funcao_id ?? ''), Number(corpo.ano), meses)));
  } catch (e) { return respostaDeErroDaComissao(e); }
}
