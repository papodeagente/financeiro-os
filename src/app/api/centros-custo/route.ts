// Centros de custo em árvore (05/11/2026). Ler: quem está logado. Gravar:
// quem edita o financeiro.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroCadastro, listarCentros, salvarCentro } from '@/lib/centros-custo-servidor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSession())) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    await initDB();
    if (!pool) return NextResponse.json([]);
    return NextResponse.json(await listarCentros(pool, await getTenantId()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    await initDB();
    const corpo = await req.json().catch(() => null);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    }
    if (!pool) return NextResponse.json(corpo);
    const tenantId = await getTenantId();
    return NextResponse.json(await emTransacao(exec => salvarCentro(exec, tenantId, corpo as Record<string, unknown>)));
  } catch (e) {
    if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
