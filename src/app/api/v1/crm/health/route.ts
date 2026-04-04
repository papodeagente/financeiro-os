import { NextResponse } from 'next/server';
import { statusIntegracaoCRM } from '@/lib/crm-integration';

export async function GET() {
  const s = await statusIntegracaoCRM();
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
