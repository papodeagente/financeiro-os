import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarDesfazerCancelamento, previaDoDesfazerCancelamento } from '@/lib/cancelamento-servidor';
import { montarFicha, usuarioDa } from '@/lib/venda-rota';
import { lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Desfazer (reativar) o último cancelamento da venda (E7), sempre com prévia.
// Contrato em src/lib/parte-d-rota.ts.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('cancelar_produto');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = await lerJson<{ modo?: string; cancelamento_id?: string; motivo?: string; assinatura?: string }>(req);
  const cancelamentoId = String(corpo?.cancelamento_id ?? '');
  if (!cancelamentoId) return NextResponse.json({ error: 'Diga qual cancelamento desfazer.', codigo: 'DADOS' }, { status: 400 });
  const usuario = usuarioDa(acesso.sessao);
  try {
    if (corpo?.modo !== 'gravar') {
      return NextResponse.json(await previaDoDesfazerCancelamento(acesso.tenantId, id, cancelamentoId, corpo?.motivo, usuario));
    }
    const r = await gravarDesfazerCancelamento(acesso.tenantId, id, cancelamentoId, corpo?.motivo, usuario, typeof corpo.assinatura === 'string' ? corpo.assinatura : undefined);
    return NextResponse.json({ ...r, ficha: await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao) });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
