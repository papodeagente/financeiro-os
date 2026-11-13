import { NextResponse } from 'next/server';
import { recalcularSaldosCaixa } from '@/lib/caixa-helpers';
import { getTenantId } from '@/lib/tenant';

// Reconstrói saldo_atual de todas as contas bancárias a partir das CR/CP
// já marcadas RECEBIDO/PAGO. Útil quando baixas foram feitas antes do
// override PUT que sincroniza saldo. Idempotente.
export async function POST() {
  try {
    const tenantId = await getTenantId();
    const r = await recalcularSaldosCaixa(tenantId);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
