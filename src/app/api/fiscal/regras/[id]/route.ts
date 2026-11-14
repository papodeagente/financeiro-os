import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { apagarRegra, listarRegras, salvarRegra } from '@/lib/nota-regras-servidor';
import { respostaDeErroDaNota } from '@/lib/nota-regras-rota';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  // Só regra desta agência: o id da URL não alcança regra de outra.
  if (!(await listarRegras(exec, tenantId)).some(r => r.id === id)) {
    return NextResponse.json({ error: 'Regra não encontrada.', codigo: 'NAO_ENCONTRADA' }, { status: 404 });
  }
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    const sessao = await getSession();
    return NextResponse.json(await salvarRegra(exec, tenantId, { ...corpo, id }, { id: sessao?.userId ?? '' }));
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const ok = await apagarRegra(pool as unknown as ExecutorSQL, await getTenantId(), id);
  if (!ok) return NextResponse.json({ error: 'Regra não encontrada.', codigo: 'NAO_ENCONTRADA' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
