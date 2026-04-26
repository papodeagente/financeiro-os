import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { marcarTodasComoLidas } from '@/lib/notificacoes';

export async function POST() {
  try {
    await initDB();
    const tenantId = await getTenantId();
    await marcarTodasComoLidas(tenantId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
