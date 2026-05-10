import { NextResponse } from 'next/server';
import { statusIntegracaoCRM } from '@/lib/crm-integration';
import { getTenantIdSafe } from '@/lib/tenant';

export async function GET() {
  const tenantId = await getTenantIdSafe();
  if (!tenantId) {
    return NextResponse.json({ status: 'sem-tenant', timestamp: new Date().toISOString() });
  }
  const s = await statusIntegracaoCRM(tenantId);
  const status = !s.ativo ? 'desativado'
    : s.circuit_breaker === 'aberto' ? 'degradado'
    : s.eventos_falha > 0 ? 'degradado'
    : 'ok';

  return NextResponse.json({
    status,
    circuit_breaker: s.circuit_breaker,
    pendentes: s.eventos_pendentes,
    timestamp: new Date().toISOString(),
  });
}
