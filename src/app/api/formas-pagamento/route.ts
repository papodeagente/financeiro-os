// Formas de pagamento (05/11/2026). Ler: quem está logado (os formulários de
// pagar e receber e a liquidação montam as escolhas a partir daqui). Gravar:
// quem edita o financeiro.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { FORMAS_DO_SISTEMA } from '@/lib/formas-pagamento';
import { ErroForma, listarFormas, salvarForma } from '@/lib/formas-pagamento-servidor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSession())) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    await initDB();
    if (!pool) return NextResponse.json(FORMAS_DO_SISTEMA);
    return NextResponse.json(await listarFormas(pool, await getTenantId()));
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
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const tenantId = await getTenantId();
    // Criar: o código nasce do nome, nunca vem da tela.
    const resto = { ...(corpo as Record<string, unknown>) };
    delete resto.codigo;
    return NextResponse.json(await emTransacao(exec => salvarForma(exec, tenantId, resto)), { status: 201 });
  } catch (e) {
    if (e instanceof ErroForma) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
