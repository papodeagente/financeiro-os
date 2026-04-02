import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { searchAirports } from '@/lib/amadeus-api';

async function getAmadeusConfig() {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton'`);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.amadeus?.ativo || !cfg.amadeus?.api_key) return null;
  return cfg.amadeus as { api_key: string; api_secret: string; ambiente: 'test' | 'production' };
}

export async function GET(req: Request) {
  try {
    const config = await getAmadeusConfig();
    if (!config) return NextResponse.json({ error: 'Amadeus API não configurada' }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const keyword = searchParams.get('keyword') || '';
    if (keyword.length < 2) return NextResponse.json({ data: [] });

    const result = await searchAirports(config, keyword);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
