// Cadastro de moedas da agência (06/11/2026, E7 frente D). GET devolve o
// catálogo inteiro (as oito do sistema mais as da agência, inclusive as
// desativadas, para ler o que já foi gravado nelas); POST acrescenta uma.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { MOEDAS, MOEDAS_PTAX_DISPONIVEIS } from '@/lib/cambio';
import { ErroMoeda, lerCatalogoDaAgencia, salvarMoedaDaAgencia } from '@/lib/moedas-servidor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const moedas = pool ? await lerCatalogoDaAgencia(pool as unknown as ExecutorSQL, await getTenantId()) : MOEDAS;
  return NextResponse.json({ moedas, ptax_disponiveis: MOEDAS_PTAX_DISPONIVEIS });
}

export async function POST(req: Request) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
  const tenantId = await getTenantId();
  try {
    const moeda = await emTransacao(exec => salvarMoedaDaAgencia(exec, tenantId, corpo as Record<string, unknown>));
    return NextResponse.json({ moeda }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroMoeda) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
