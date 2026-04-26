import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantIdSafe } from '@/lib/tenant';
import { listarNotificacoes, contarNaoLidas } from '@/lib/notificacoes';

export async function GET(req: Request) {
  try {
    await initDB();
    const tenantId = await getTenantIdSafe();
    if (!tenantId) return NextResponse.json({ items: [], unread: 0 });

    const { searchParams } = new URL(req.url);
    const apenasNaoLidas = searchParams.get('unread') === '1';
    const limit = Number(searchParams.get('limit')) || 30;

    const [items, unread] = await Promise.all([
      listarNotificacoes(tenantId, { apenasNaoLidas, limit }),
      contarNaoLidas(tenantId),
    ]);
    return NextResponse.json({ items, unread });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
