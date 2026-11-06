import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { normalizarVenda } from '@/lib/venda-modelo';
import { carregarVenda, salvarVenda } from '@/lib/venda-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';

// Ficha da venda completa (E5): ler e gravar. Contrato em src/lib/venda-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  try {
    const ficha = await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao);
    if (!ficha) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(ficha);
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = (await req.json().catch(() => null)) as { venda?: unknown } | null;
  const { venda, erros } = normalizarVenda(corpo?.venda);
  if (erros.length) return NextResponse.json({ error: erros[0].mensagem, codigo: 'DADOS', detalhes: { erros } }, { status: 400 });
  const exec = pool as unknown as ExecutorSQL;
  try {
    const atual = await carregarVenda(exec, acesso.tenantId, id);
    venda.id = id;
    venda.origem = atual?.venda.origem ?? 'manual';
    venda.crm_venda_id = atual?.venda.crm_venda_id ?? '';
    await emTransacao(e => salvarVenda(e, acesso.tenantId, venda, { usuario: usuarioDa(acesso.sessao), origem: venda.origem }));
    return NextResponse.json(await montarFicha(exec, acesso.tenantId, id, acesso.sessao));
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
