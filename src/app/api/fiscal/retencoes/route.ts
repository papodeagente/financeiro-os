import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { listarRetencoes, salvarRetencao } from '@/lib/nota-retencoes-servidor';
import { respostaDeErroDaNota } from '@/lib/nota-regras-rota';

// Retenções na fonte (Lei 9.430) por cliente × produto (E5, parte E).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const cliente = new URL(req.url).searchParams.get('cliente_id') || undefined;
  return NextResponse.json({ retencoes: await listarRetencoes(pool as unknown as ExecutorSQL, await getTenantId(), cliente) });
}

export async function POST(req: Request) {
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    return NextResponse.json(await salvarRetencao(pool as unknown as ExecutorSQL, await getTenantId(), { ...corpo, id: '' }), { status: 201 });
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}
