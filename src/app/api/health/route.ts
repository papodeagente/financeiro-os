import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import pool, { initDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

const healthPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3_000,
      query_timeout: 3_000,
      idleTimeoutMillis: 30_000,
      application_name: 'enturos-finance-health',
    })
  : null;

export async function GET() {
  if (!pool || !healthPool) {
    return NextResponse.json(
      { status: 'indisponivel', banco: 'nao-configurado', timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    // A versao so fica pronta depois de executar as migracoes idempotentes e
    // provar que o schema da ponte Sites/Financeiro realmente existe.
    await initDB();
    const { rows } = await healthPool.query<{
      sites_config: string | null;
      sites_eventos: string | null;
      sites_reservas: string | null;
      sites_movimentos: string | null;
    }>(`SELECT
      to_regclass('public.sites_config')::text AS sites_config,
      to_regclass('public.sites_eventos')::text AS sites_eventos,
      to_regclass('public.sites_reservas')::text AS sites_reservas,
      to_regclass('public.sites_movimentos')::text AS sites_movimentos`);
    if (!rows[0] || Object.values(rows[0]).some((tabela) => !tabela)) {
      throw new Error('schema da integracao Sites incompleto');
    }
    return NextResponse.json(
      { status: 'ok', banco: 'ok', timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (erro) {
    console.error('[health]', erro instanceof Error ? erro.message : erro);
    return NextResponse.json(
      { status: 'indisponivel', banco: 'erro', timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
