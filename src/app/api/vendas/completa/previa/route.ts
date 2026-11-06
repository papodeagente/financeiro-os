import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { normalizarVenda } from '@/lib/venda-modelo';
import { lerConfigVenda, previaDasContas } from '@/lib/venda-servidor';
import { previaDe, respostaDeErroDaVenda } from '@/lib/venda-rota';

// Prévia da venda completa: totais, receita aberta e as contas que vão nascer.
// Nada é gravado. Contrato em src/lib/venda-rota.ts.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as { venda?: unknown } | null;
  const { venda, erros } = normalizarVenda(corpo?.venda);
  try {
    const exec = pool as unknown as ExecutorSQL;
    const tenantId = await getTenantId();
    const config = await lerConfigVenda(exec, tenantId);
    const contas = await previaDasContas(exec, tenantId, venda);
    return NextResponse.json({ ...previaDe(venda, config.receita, contas), erros });
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
