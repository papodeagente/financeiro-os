import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaExclusao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { excluirAcordo, salvarAcordo } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// Mudar ou excluir um acordo com fornecedor. Para encerrar, prefira pôr o fim
// da vigência: as vendas antigas continuam usando o acordo da data delas.
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId, usuario } = await contexto();
  const { id } = await ctx.params;
  const c = await corpo(req);
  try {
    return NextResponse.json(await emTransacao(e => salvarAcordo(e, tenantId, { ...c, id }, usuario)));
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaExclusao();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const { id } = await ctx.params;
  try {
    const ok = await emTransacao(e => excluirAcordo(e, tenantId, id));
    if (!ok) return NextResponse.json({ error: 'Acordo não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
