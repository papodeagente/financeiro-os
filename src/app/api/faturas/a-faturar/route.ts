import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { itensAFaturar, notasEsperando } from '@/lib/fatura-servidor';
import { respostaDeErroDaFatura } from '@/lib/fatura-rota';

// Itens da forma Faturar ainda fora de fatura (e por quê) e notas esperando a próxima fatura.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ itens: [], notas: [] });
  const tenantId = await getTenantId();
  const pessoa = new URL(req.url).searchParams.get('pessoa_id') || undefined;
  try {
    const exec = pool as unknown as ExecutorSQL;
    const notas = await notasEsperando(exec, tenantId);
    return NextResponse.json({
      itens: await itensAFaturar(exec, tenantId, { pessoa_id: pessoa }),
      notas: pessoa ? notas.filter(n => n.pessoa_id === pessoa) : notas,
    });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
