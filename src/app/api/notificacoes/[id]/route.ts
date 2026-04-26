import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { marcarComoLida } from '@/lib/notificacoes';

export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const tenantId = await getTenantId();
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    await marcarComoLida(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
