// Ajustar e apagar uma forma de pagamento (05/11/2026). As formas de sempre
// só se ajustam ou desligam; apagar vale para forma própria sem uso.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaExclusao, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroForma, excluirForma, salvarForma } from '@/lib/formas-pagamento-servidor';

export const dynamic = 'force-dynamic';

function falha(e: unknown) {
  if (e instanceof ErroForma) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  try {
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    await initDB();
    const { codigo } = await params;
    const corpo = await req.json().catch(() => null);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    }
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const tenantId = await getTenantId();
    return NextResponse.json(await emTransacao(exec => salvarForma(exec, tenantId, corpo as Record<string, unknown>, decodeURIComponent(codigo))));
  } catch (e) {
    return falha(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  try {
    const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
    if (recusa) return recusa;
    await initDB();
    const { codigo } = await params;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const tenantId = await getTenantId();
    await emTransacao(exec => excluirForma(exec, tenantId, decodeURIComponent(codigo)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}
