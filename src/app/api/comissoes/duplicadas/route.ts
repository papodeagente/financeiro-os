import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { emTransacao } from '@/lib/caixa-atomico';
import { cancelarContasDuplicadas, listarContasDuplicadas } from '@/lib/comissao-duplicadas';
import { hojeISO } from '@/lib/money';

/**
 * As contas a pagar de comissão que ficaram em dobro (ver
 * src/lib/comissao-duplicadas.ts).
 *
 *   GET  → { quantidade, valor_total, itens, pagas_em_dobro }   nada muda
 *   POST → { canceladas, valor_total, ids }                       cancela as listadas
 *
 * Ler basta ver o financeiro; cancelar exige editar o financeiro. O POST não
 * recebe lista: ele recalcula o que está em dobro e cancela só isso, então
 * não há como mandar cancelar uma conta que não é duplicada.
 */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ quantidade: 0, valor_total: 0, itens: [], pagas_em_dobro: [] });
    const tenantId = await getTenantId();
    return NextResponse.json(await listarContasDuplicadas(pool as unknown as ExecutorSQL, tenantId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const tenantId = await getTenantId();
    const r = await emTransacao(exec => cancelarContasDuplicadas(exec, tenantId, hojeISO()));
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
