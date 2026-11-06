import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { apagarRetencao, listarRetencoes, salvarRetencao } from '@/lib/nota-retencoes-servidor';
import { respostaDeErroDaNota } from '@/lib/nota-regras-rota';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  // Só retenção desta agência: o id da URL não alcança a de outra.
  if (!(await listarRetencoes(exec, tenantId)).some(r => r.id === id)) {
    return NextResponse.json({ error: 'Retenção não encontrada.', codigo: 'NAO_ENCONTRADA' }, { status: 404 });
  }
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    return NextResponse.json(await salvarRetencao(exec, tenantId, { ...corpo, id }));
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const ok = await apagarRetencao(pool as unknown as ExecutorSQL, await getTenantId(), id);
  if (!ok) return NextResponse.json({ error: 'Retenção não encontrada.', codigo: 'NAO_ENCONTRADA' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
