import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { lerConfigNotas, listarRegras, salvarRegra } from '@/lib/nota-regras-servidor';
import { regraSugerida } from '@/lib/nota-regras';
import { respostaDeErroDaNota } from '@/lib/nota-regras-rota';

// Regras da nota (E5, parte E). Contrato em src/lib/nota-regras-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  return NextResponse.json({ regras: await listarRegras(exec, tenantId), config: await lerConfigNotas(exec, tenantId), sugerida: regraSugerida() });
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    const sessao = await getSession();
    const regra = await salvarRegra(pool as unknown as ExecutorSQL, await getTenantId(), { ...corpo, id: '' }, { id: sessao?.userId ?? '' });
    return NextResponse.json(regra, { status: 201 });
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}
