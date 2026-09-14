import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { getDadosReaisAgencia } from '@/lib/funil-dados-reais';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/funis/dados-reais
 *
 * Agrega dados reais do tenant (ticket médio, taxa de aceite de propostas,
 * CAC, margem mínima, investimento em marketing). Leitura-only sobre as
 * tabelas existentes, sem mutação nenhuma.
 */
export async function GET() {
  try {
    const session = await getSession();
    const bloqueio = bloqueioFinanceiro(session, 'ler');
    if (bloqueio) {
      return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status, headers: HEADERS });
    }
    await initDB();
    const tenantId = session!.impersonatingTenantId || session!.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });
    }
    const dados = await getDadosReaisAgencia(tenantId);
    return NextResponse.json(dados, { headers: HEADERS });
  } catch (e) {
    console.error('[funis/dados-reais] Falha ao consultar:', e instanceof Error ? e.name : 'Erro');
    return NextResponse.json(
      { error: 'Não foi possível carregar os dados reais da agência.' },
      { status: 500, headers: HEADERS },
    );
  }
}
