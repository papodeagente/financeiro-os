import { NextResponse } from 'next/server';
import { statusIntegracaoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  try {
    const tenantId = await getTenantId();
    const status = await statusIntegracaoCRM(tenantId);
    return NextResponse.json(status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
