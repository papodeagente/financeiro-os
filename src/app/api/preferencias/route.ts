import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { PreferenciaInvalida, gravarPreferencia, lerChave, lerPreferencia, lerValor } from '@/lib/preferencias-usuario';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * Preferências da pessoa logada (06/11/2026, E7).
 *   GET ?chave=contas-pagar-receber.colunas   → { chave, valor } (valor null = nunca escolheu)
 *   PUT { chave, valor }                      → { ok: true }
 * Sempre da própria pessoa, na agência em que ela está.
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

async function quem() {
  const session = await getSession();
  const tenantId = session?.impersonatingTenantId || session?.tenantId;
  const usuarioId = session?.userId;
  return tenantId && usuarioId ? { tenantId, usuarioId } : null;
}

export async function GET(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const q = await quem();
    if (!q) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const chave = lerChave(new URL(req.url).searchParams.get('chave'));
    await initDB();
    if (!pool) return NextResponse.json({ chave, valor: null }, { headers: HEADERS });
    const valor = await lerPreferencia(pool as unknown as ExecutorSQL, q.tenantId, q.usuarioId, chave);
    return NextResponse.json({ chave, valor }, { headers: HEADERS });
  } catch (e) {
    if (e instanceof PreferenciaInvalida) return NextResponse.json({ error: e.message }, { status: 400, headers: HEADERS });
    return NextResponse.json({ error: 'Não foi possível ler a preferência.' }, { status: 500, headers: HEADERS });
  }
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const q = await quem();
    if (!q) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    const corpo = (await req.json().catch(() => null)) as { chave?: unknown; valor?: unknown } | null;
    const chave = lerChave(corpo?.chave);
    const valor = lerValor(corpo?.valor);
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
    await gravarPreferencia(pool as unknown as ExecutorSQL, q.tenantId, q.usuarioId, chave, valor);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (e) {
    if (e instanceof PreferenciaInvalida) return NextResponse.json({ error: e.message }, { status: 400, headers: HEADERS });
    return NextResponse.json({ error: 'Não foi possível guardar a preferência.' }, { status: 500, headers: HEADERS });
  }
}
