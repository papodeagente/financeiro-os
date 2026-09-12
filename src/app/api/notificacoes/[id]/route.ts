import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { marcarComoLida } from '@/lib/notificacoes';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const { id } = await params;
    if (!id || id.length > 500) return NextResponse.json({ error: 'Notificação inválida.' }, { status: 400, headers: HEADERS });
    const rawBody = await req.text();
    let body: unknown = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: 'Estado de leitura inválido.' }, { status: 400, headers: HEADERS });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Estado de leitura inválido.' }, { status: 400, headers: HEADERS });
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'lida')
      || ('lida' in input && typeof input.lida !== 'boolean')) {
      return NextResponse.json({ error: 'Estado de leitura inválido.' }, { status: 400, headers: HEADERS });
    }
    await initDB();
    const visible = await marcarComoLida(session, id, (input.lida as boolean | undefined) ?? true);
    if (!visible) return NextResponse.json({ error: 'Notificação não encontrada.' }, { status: 404, headers: HEADERS });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error('[notificacoes] Falha ao alterar leitura:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível atualizar a notificação.' }, { status: 500, headers: HEADERS });
  }
}
