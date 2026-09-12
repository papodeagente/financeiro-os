import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { consultarNotificacoes } from '@/lib/notificacoes';
import { tiposNotificacaoValidos, type TipoNotificacao } from '@/lib/notificacoes-config';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

function positiveInteger(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) return null;
  return Number(value);
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const params = new URL(req.url).searchParams;
    const page = positiveInteger(params.get('page'), 1, 1_000_000);
    const limit = positiveInteger(params.get('limit'), 20, 50);
    const tipoRaw = params.get('tipo');
    const unreadRaw = params.get('unread');
    if (!page || !limit
      || (tipoRaw && !tiposNotificacaoValidos.has(tipoRaw))
      || (unreadRaw !== null && unreadRaw !== '0' && unreadRaw !== '1')) {
      return NextResponse.json({ error: 'Filtros de notificação inválidos.' }, { status: 400, headers: HEADERS });
    }
    await initDB();
    const result = await consultarNotificacoes(session, {
      page, limit, apenasNaoLidas: unreadRaw === '1',
      tipo: tipoRaw as TipoNotificacao | undefined,
    });
    return NextResponse.json(result, { headers: HEADERS });
  } catch (error) {
    console.error('[notificacoes] Falha ao consultar:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível carregar as notificações.' }, { status: 500, headers: HEADERS });
  }
}
