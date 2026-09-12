import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { marcarTodasComoLidas } from '@/lib/notificacoes';
import { tiposNotificacaoValidos, type TipoNotificacao } from '@/lib/notificacoes-config';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const rawBody = await req.text();
    let body: unknown = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: 'Filtro de notificação inválido.' }, { status: 400, headers: HEADERS });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Filtro de notificação inválido.' }, { status: 400, headers: HEADERS });
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'tipo')
      || (input.tipo !== undefined && (typeof input.tipo !== 'string' || !tiposNotificacaoValidos.has(input.tipo)))) {
      return NextResponse.json({ error: 'Filtro de notificação inválido.' }, { status: 400, headers: HEADERS });
    }
    await initDB();
    const updated = await marcarTodasComoLidas(session, input.tipo as TipoNotificacao | undefined);
    return NextResponse.json({ ok: true, updated }, { headers: HEADERS });
  } catch (error) {
    console.error('[notificacoes] Falha ao marcar todas:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível atualizar as notificações.' }, { status: 500, headers: HEADERS });
  }
}
