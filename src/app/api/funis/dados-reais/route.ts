import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getDadosReaisAgencia } from '@/lib/funil-dados-reais';

/**
 * GET /api/funis/dados-reais
 *
 * Agrega dados reais do tenant (ticket médio, taxa de aceite de propostas,
 * CAC, margem mínima, investimento em marketing). Leitura-only sobre as
 * tabelas existentes, sem mutação nenhuma.
 */
export async function GET() {
  try {
    await initDB();
    const tenantId = await getTenantId();
    const dados = await getDadosReaisAgencia(tenantId);
    return NextResponse.json(dados);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
