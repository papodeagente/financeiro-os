import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { carregarConfigFiscal } from '@/lib/nfse-servico';
import { carregarRealizadoDoMes } from '@/lib/plano-do-mes-servidor';
import { hojeISO, num } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

/**
 * O que aconteceu no mês, para o acompanhamento do plano. A comparação com o
 * plano é feita na tela, com o plano que está nela: editar uma meta muda os
 * indicadores na hora, sem esperar a gravação.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const bloqueio = bloqueioFinanceiro(session, 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status, headers: HEADERS });
    const tenantId = session!.impersonatingTenantId || session!.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503, headers: HEADERS });

    const mes = new URL(req.url).searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return NextResponse.json({ error: 'Mês de referência inválido.' }, { status: 400, headers: HEADERS });
    }
    await initDB();
    // A alíquota só serve de estimativa de imposto quando o mês não tem
    // imposto lançado. Falhar aqui não derruba o acompanhamento.
    let aliquota: number | null = null;
    try {
      aliquota = num((await carregarConfigFiscal(tenantId))?.aliquota_iss) || null;
    } catch { aliquota = null; }
    const realizado = await carregarRealizadoDoMes(pool as unknown as ExecutorSQL, tenantId, mes, hojeISO(), aliquota);
    return NextResponse.json(realizado, { headers: HEADERS });
  } catch (error) {
    console.error('[planejamento/realizado] Falha ao consultar:', error instanceof Error ? error.message : 'Erro');
    return NextResponse.json({ error: 'Não foi possível carregar o realizado do mês.' }, { status: 500, headers: HEADERS });
  }
}
