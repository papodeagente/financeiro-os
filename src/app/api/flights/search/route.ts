import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { searchFlights } from '@/lib/amadeus-api';

async function getAmadeusConfig() {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton'`);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.amadeus?.ativo || !cfg.amadeus?.api_key) return null;
  return cfg.amadeus as { api_key: string; api_secret: string; ambiente: 'test' | 'production' };
}

export async function POST(req: Request) {
  try {
    const config = await getAmadeusConfig();
    if (!config) return NextResponse.json({ error: 'Amadeus API não configurada' }, { status: 400 });

    const body = await req.json();
    const result = await searchFlights(config, {
      origem: body.origem,
      destino: body.destino,
      data_ida: body.data_ida,
      data_volta: body.data_volta,
      adultos: body.adultos || 1,
      criancas: body.criancas || 0,
      classe: body.classe || 'economica',
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
