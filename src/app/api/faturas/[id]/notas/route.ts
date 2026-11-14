import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { carregarFatura, lancarNota, removerNota, ErroFatura } from '@/lib/fatura-servidor';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Notas de crédito e de débito da fatura.
//   POST { tipo: 'CREDITO'|'DEBITO', valor_centavos, motivo, proxima? } — proxima: true (ou fatura fechada) = vai para a
//        próxima fatura do pagante, com a origem nesta.
//   DELETE ?nota=<id> — só com a fatura de destino aberta.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = await lerJson<{ tipo?: string; valor_centavos?: number; motivo?: string; proxima?: boolean }>(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.', codigo: 'DADOS' }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(async e => {
      const f = await carregarFatura(e, tenantId, id);
      if (!f) throw new ErroFatura('NAO_ACHOU', 'Fatura não encontrada.', 404);
      const naPropria = corpo.proxima !== true && f.situacao === 'ABERTA';
      await lancarNota(e, tenantId, {
        pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, tipo: corpo.tipo === 'DEBITO' ? 'DEBITO' : corpo.tipo === 'CREDITO' ? 'CREDITO' : ('' as 'CREDITO'),
        valor_centavos: Number(corpo.valor_centavos), motivo: String(corpo.motivo ?? ''),
        fatura_id: naPropria ? f.id : undefined, origem_fatura_id: f.id,
      }, { usuario: usuarioDaFatura(sessao) });
    });
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const nota = new URL(req.url).searchParams.get('nota') ?? '';
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(e => removerNota(e, tenantId, nota, { usuario: usuarioDaFatura(sessao) }));
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
