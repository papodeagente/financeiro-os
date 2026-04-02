import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { searchHotels as searchGoogleHotels } from '@/lib/google-places-api';

async function getGoogleConfig() {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton'`);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.google_places?.ativo || !cfg.google_places?.api_key) return null;
  return { api_key: cfg.google_places.api_key };
}

export async function POST(req: Request) {
  try {
    const config = await getGoogleConfig();
    if (!config) return NextResponse.json({ error: 'Google Places API não configurada' }, { status: 400 });

    const body = await req.json();
    const result = await searchGoogleHotels(config, {
      query: body.query || `hotéis em ${body.destino}`,
      languageCode: 'pt-BR',
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
