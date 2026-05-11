import { NextResponse } from 'next/server';
import { reprocessarVencimentosAtrasados } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

// Bumpa contas a receber/pagar PENDENTES com data_vencimento no passado
// para hoje + 30d × parcela_numero. Idempotente: só toca o que está vencido.
export async function POST() {
  try {
    const tenantId = await getTenantId();
    const r = await reprocessarVencimentosAtrasados(tenantId);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
