import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao } from '@/lib/guarda-rota';
import { pode } from '@/lib/permissoes-servidor';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { contextoDoCancelamento, gravarCancelamento, previaDoCancelamento } from '@/lib/cancelamento-servidor';
import { montarFicha, usuarioDa } from '@/lib/venda-rota';
import { lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Cancelar produto ou passageiro (E5, parte D), sempre com prévia.
// Contrato em src/lib/parte-d-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const exec = pool as unknown as ExecutorSQL;
  if (!(await pode(acesso.sessao, 'ver_aba_financeiro', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui o financeiro da venda.', codigo: 'SEM_ACESSO' }, { status: 403 });
  }
  try {
    const c = await contextoDoCancelamento(exec, acesso.tenantId, id);
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(c);
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('cancelar_produto');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = await lerJson<{ modo?: string; pedido?: unknown; assinatura?: string }>(req);
  const usuario = usuarioDa(acesso.sessao);
  try {
    if (corpo?.modo !== 'gravar') {
      return NextResponse.json(await previaDoCancelamento(acesso.tenantId, id, corpo?.pedido, usuario));
    }
    const r = await gravarCancelamento(acesso.tenantId, id, corpo?.pedido, usuario, typeof corpo.assinatura === 'string' ? corpo.assinatura : undefined);
    return NextResponse.json({ ...r, ficha: await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao) });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
