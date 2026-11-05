import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroBaixa, estornarBaixa } from '@/lib/baixas-servidor';

// Estorna UMA baixa (05/11/2026): o dinheiro volta para a conta onde entrou
// ou saiu, o título volta ao estado de antes daquela baixa. Motivo obrigatório.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = (await req.json().catch(() => ({}))) as { motivo?: string; data?: string };
  const tenantId = await getTenantId();
  const sessao = await getSession();
  try {
    const r = await emTransacao(exec => estornarBaixa(exec, { tenantId, usuarioId: sessao?.userId, usuarioNome: sessao?.nome }, id, {
      motivo: corpo.motivo ?? '', data: corpo.data,
    }));
    return NextResponse.json(r);
  } catch (e) {
    const periodo = respostaPeriodoFechado(e);
    if (periodo) return periodo;
    if (e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[baixas/estorno]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível estornar. Nada foi alterado.' }, { status: 500 });
  }
}
