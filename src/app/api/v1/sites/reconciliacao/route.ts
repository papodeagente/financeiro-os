import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { reconciliarSites } from '@/lib/sites-integration';
import { recusaModulo } from '@/lib/guarda-rota';

export async function GET() {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
  if (bloqueio) return NextResponse.json({ erro: bloqueio.erro }, { status: bloqueio.status });
  try {
    return NextResponse.json(await reconciliarSites(await getTenantId()));
  } catch {
    return NextResponse.json({ erro: 'Falha ao conferir eventos do Sites' }, { status: 500 });
  }
}
