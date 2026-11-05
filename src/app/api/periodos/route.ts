import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { fecharPeriodo, listarPeriodos } from '@/lib/periodo-fechado';

// "Fechar Caixa" (05/11/2026).
//   GET  → períodos fechados (agência e por conta) + últimos eventos.
//   POST { conta_bancaria_id?: string, ate: 'AAAA-MM-DD' } → fecha até a data.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ periodos: [], eventos: [] });
  const tenantId = await getTenantId();
  return NextResponse.json(await listarPeriodos(pool as unknown as ExecutorSQL, tenantId));
}

export async function POST(req: Request) {
  const recusa = (await recusaFinanceira('escrever')) ?? (await recusaAdmin());
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as { conta_bancaria_id?: string; ate?: string };
  if (!corpo.ate || !/^\d{4}-\d{2}-\d{2}$/.test(corpo.ate)) return NextResponse.json({ error: 'Informe a data.' }, { status: 400 });
  const tenantId = await getTenantId();
  const sessao = await getSession();
  try {
    await emTransacao(exec => fecharPeriodo(exec, {
      tenantId, contaId: corpo.conta_bancaria_id || '', ate: corpo.ate!, usuarioId: sessao?.userId, usuarioNome: sessao?.nome,
    }));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 400 });
  }
}
