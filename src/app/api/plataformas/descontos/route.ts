import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import {
  ErroDescontoPadrao,
  listarDescontosPadrao,
  removerDescontoPadrao,
  salvarDescontoPadrao,
} from '@/lib/desconto-padrao';

/**
 * Desconto padrão de cada plataforma de pagamento.
 *
 *   GET                                   → { padroes: [{ plataforma, percentual }] }
 *   PUT    { plataforma, percentual }     → { padrao, padroes }
 *   DELETE ?plataforma=Hotmart            → { padroes }
 *
 * Ler basta ver o financeiro (a baixa precisa da lista); mudar exige editar.
 */
function falha(e: unknown) {
  if (e instanceof ErroDescontoPadrao) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : 'Erro interno';
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ padroes: [] });
    const tenantId = await getTenantId();
    return NextResponse.json({ padroes: await listarDescontosPadrao(pool as unknown as ExecutorSQL, tenantId) });
  } catch (e) {
    return falha(e);
  }
}

export async function PUT(req: Request) {
  try {
    await initDB();
    const session = await getSession();
    const bloqueio = bloqueioFinanceiro(session, 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const tenantId = await getTenantId();
    const exec = pool as unknown as ExecutorSQL;
    const padrao = await salvarDescontoPadrao(
      exec,
      tenantId,
      String(body?.plataforma ?? ''),
      Number(body?.percentual),
      session?.nome || session?.email || '',
    );
    return NextResponse.json({ padrao, padroes: await listarDescontosPadrao(exec, tenantId) });
  } catch (e) {
    return falha(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const plataforma = new URL(req.url).searchParams.get('plataforma') ?? '';
    const tenantId = await getTenantId();
    const exec = pool as unknown as ExecutorSQL;
    await removerDescontoPadrao(exec, tenantId, plataforma);
    return NextResponse.json({ padroes: await listarDescontosPadrao(exec, tenantId) });
  } catch (e) {
    return falha(e);
  }
}
