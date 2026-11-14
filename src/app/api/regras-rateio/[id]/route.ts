// Alterar e excluir uma regra de rateio (05/11/2026). Excluir exige o perfil
// que exclui; os lançamentos já rateados com ela não mudam.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaExclusao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroCadastro, excluirRegra, salvarRegra } from '@/lib/centros-custo-servidor';

export const dynamic = 'force-dynamic';

function falha(e: unknown) {
  if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    const corpo = await req.json().catch(() => null);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    }
    if (!pool) return NextResponse.json(corpo);
    const tenantId = await getTenantId();
    return NextResponse.json(await emTransacao(exec => salvarRegra(exec, tenantId, corpo as Record<string, unknown>, id)));
  } catch (e) {
    return falha(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();
    await emTransacao(exec => excluirRegra(exec, tenantId, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}
