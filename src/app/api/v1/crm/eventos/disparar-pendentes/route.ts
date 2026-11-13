import { NextResponse } from 'next/server';
import { disparaEventosPendentes } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

// Processa em lote eventos em PENDENTE — usado quando a integracao CRM
// estava desativada no momento dos gatilhos e o usuario quer recuperar
// o backlog ao ativa-la.
export async function POST() {
  try {
    const tenantId = await getTenantId();
    const resultado = await disparaEventosPendentes(tenantId);
    return NextResponse.json(resultado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
