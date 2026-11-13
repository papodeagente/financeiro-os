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

async function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error('tempo limite da inicializacao excedido')), ms);
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

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
    // A migracao global continua em segundo plano e e memoizada por initDB;
    // o probe, porem, sempre responde em tempo finito para o orquestrador.
    await comTimeout(initDB(), 3_000);
    const { rows } = await healthPool.query<{
      sites_config: string | null;
      sites_eventos: string | null;
    }>(`SELECT
      to_regclass('public.sites_config')::text AS sites_config,
      to_regclass('public.sites_eventos')::text AS sites_eventos`);
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
