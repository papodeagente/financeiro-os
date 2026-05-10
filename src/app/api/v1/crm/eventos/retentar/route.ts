import { NextRequest, NextResponse } from 'next/server';
import { retentarEventosFalha } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({}));
    const ids = body.ids as string[] | undefined;
    const resultado = await retentarEventosFalha(tenantId, ids);
    return NextResponse.json(resultado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
