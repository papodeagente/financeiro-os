import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { pode } from '@/lib/permissoes-servidor';
import { fiscalDaVenda } from '@/lib/venda-fiscal-servidor';

// Notas fiscais e retenção na fonte da venda, para a ficha (E7). GET → FiscalDaVenda.
// Como as contas da ficha: precisa ver a aba financeira.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const exec = pool as unknown as ExecutorSQL;
  if (!(await pode(acesso.sessao, 'ver_aba_financeiro', { exec }))) {
    return NextResponse.json({ error: 'Sem acesso às contas desta venda.' }, { status: 403 });
  }
  try {
    return NextResponse.json(await fiscalDaVenda(exec, acesso.tenantId, id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[venda-fiscal] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler as notas da venda.' }, { status: 500 });
  }
}
