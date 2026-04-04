import { NextResponse } from 'next/server';
import { statusIntegracaoCRM } from '@/lib/crm-integration';

export async function GET() {
  const status = await statusIntegracaoCRM();
  return NextResponse.json(status);
}
