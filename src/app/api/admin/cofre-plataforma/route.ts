import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  ErroCofrePlataforma, lerEstadosDasFontes, salvarSegredoPlataforma, situacaoDosSegredos,
} from '@/lib/cambio-servidor';

// Cofre do Super Admin (05/11/2026, E6): segredos da PLATAFORMA, não de uma
// agência. Hoje: a chave própria do Financeiro na AwesomeAPI (câmbio
// turismo). A tela recebe só a máscara; o segredo é cifrado (AES-256-GCM,
// INTEGRACOES_MASTER_KEY) e nunca volta ao navegador.
export const dynamic = 'force-dynamic';

async function superAdmin() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

export async function GET() {
  if (!(await superAdmin())) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  const [segredos, fontes] = await Promise.all([situacaoDosSegredos(pool), lerEstadosDasFontes(pool)]);
  return NextResponse.json({ segredos, fontes });
}

export async function PUT(req: Request) {
  const session = await superAdmin();
  if (!session) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as { nome?: unknown; valor?: unknown } | null;
  if (!corpo || typeof corpo.nome !== 'string' || typeof corpo.valor !== 'string') {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }
  try {
    await salvarSegredoPlataforma(pool, corpo.nome, corpo.valor, session.email || session.nome || session.userId || 'super admin');
    return NextResponse.json({ segredos: await situacaoDosSegredos(pool) });
  } catch (e) {
    if (e instanceof ErroCofrePlataforma) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[cofre-plataforma]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível gravar.' }, { status: 500 });
  }
}
