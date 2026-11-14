import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { previaDeNotas } from '@/lib/nota-regras-servidor';
import { lerDataDaNota, lerSelecao, respostaDeErroDaNota } from '@/lib/nota-regras-rota';

// Prévia das notas a gerar: nada é gravado nem transmitido.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
  const selecao = lerSelecao(corpo?.selecao);
  if (!selecao.length) return NextResponse.json({ error: 'Marque ao menos uma venda.', codigo: 'SEM_SELECAO' }, { status: 400 });
  try {
    return NextResponse.json(await previaDeNotas(pool as unknown as ExecutorSQL, await getTenantId(), selecao, { data_da_nota: lerDataDaNota(corpo?.data_da_nota) }));
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}
