import { NextResponse } from 'next/server';
import { reprocessarVendasLegadas } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

// Atualiza vendas_crm antigas (gravadas antes do fix de fields legados)
// preenchendo aliases que DRE/Dashboard/Indicadores esperam ler. Idempotente.
export async function POST() {
  try {
    const tenantId = await getTenantId();
    const r = await reprocessarVendasLegadas(tenantId);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
