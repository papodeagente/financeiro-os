import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { normalizarVenda } from '@/lib/venda-modelo';
import { carregarVenda, salvarVenda } from '@/lib/venda-servidor';
import { aplicarAcordosDaAgencia } from '@/lib/fornecedor-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';
import { cabecalhoDaEmpresa } from '@/lib/empresas-rota';

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
  const corpo = (await req.json().catch(() => null)) as { venda?: unknown; empresa_id?: unknown } | null;
  const { venda, erros } = normalizarVenda(corpo?.venda);
  if (erros.length) return NextResponse.json({ error: erros[0].mensagem, codigo: 'DADOS', detalhes: { erros } }, { status: 400 });
  const exec = pool as unknown as ExecutorSQL;
  try {
    const atual = await carregarVenda(exec, acesso.tenantId, id);
    venda.id = id;
    venda.origem = atual?.venda.origem ?? 'manual';
    venda.crm_venda_id = atual?.venda.crm_venda_id ?? '';
    // Venda à mão: o que falta de Comissão, Over e Taxa CC vem do acordo vigente (parte C).
    // Várias empresas (E7): trocar a empresa da venda leva junto os títulos em aberto.
    const cabecalho = await cabecalhoDaEmpresa(acesso.sessao, corpo?.empresa_id);
    if (cabecalho instanceof NextResponse) return cabecalho;
    await emTransacao(async e => salvarVenda(e, acesso.tenantId, (await aplicarAcordosDaAgencia(e, acesso.tenantId, venda)).venda, { usuario: usuarioDa(acesso.sessao), origem: venda.origem, cabecalho }));
    return NextResponse.json(await montarFicha(exec, acesso.tenantId, id, acesso.sessao));
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
