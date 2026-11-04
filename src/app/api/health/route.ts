import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!pool) {
    return NextResponse.json(
      { status: 'indisponivel', banco: 'nao-configurado', timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    // `pg` aceita query_timeout por consulta em runtime, embora a sobrecarga
    // legada de `@types/pg` nao o exponha em QueryConfig.
    const healthPool = pool as typeof pool & {
      query(config: { text: string; query_timeout: number }): Promise<unknown>;
    };
    await healthPool.query({ text: 'SELECT 1', query_timeout: 3_000 });
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
