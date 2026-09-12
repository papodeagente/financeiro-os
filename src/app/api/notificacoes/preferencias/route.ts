import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { carregarPreferencias, salvarPreferencias } from '@/lib/notificacoes';
import { validarPreferencias } from '@/lib/notificacoes-config';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    await initDB();
    return NextResponse.json({ preferences: await carregarPreferencias(session) }, { headers: HEADERS });
  } catch (error) {
    console.error('[notificacoes] Falha ao consultar preferências:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível carregar suas preferências.' }, { status: 500, headers: HEADERS });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const preferences = validarPreferencias(await req.json().catch(() => null));
    if (!preferences) return NextResponse.json({ error: 'Preferências inválidas.' }, { status: 400, headers: HEADERS });
    await initDB();
    return NextResponse.json({ preferences: await salvarPreferencias(session, preferences) }, { headers: HEADERS });
  } catch (error) {
    console.error('[notificacoes] Falha ao salvar preferências:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível salvar suas preferências.' }, { status: 500, headers: HEADERS });
  }
}
