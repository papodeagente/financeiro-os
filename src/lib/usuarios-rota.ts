// Ponte entre as rotas /api/usuarios e o serviço (que não conhece o Next).
import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getSession } from './auth';
import { getTenantId } from './tenant';
import { ErroUsuarios, type Consulta } from './usuarios-servico';

export async function responderUsuarios(
  acao: (db: Consulta, sessao: Awaited<ReturnType<typeof getSession>>, tenantId: string) => Promise<unknown>,
) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível' }, { status: 503 });
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401 });
    const tenantId = await getTenantId();
    return NextResponse.json(await acao(pool as unknown as Consulta, sessao, tenantId));
  } catch (e) {
    if (e instanceof ErroUsuarios) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[usuarios]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  try {
    const corpo = await req.json();
    if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) return corpo as Record<string, unknown>;
  } catch { /* corpo inválido */ }
  throw new ErroUsuarios(400, 'Corpo inválido.');
}
