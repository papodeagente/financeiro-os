import { NextResponse } from 'next/server';
import { testConnection as testAmadeus } from '@/lib/amadeus-api';
import { testConnection as testGoogle } from '@/lib/google-places-api';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { provider, config } = body;

    if (provider === 'amadeus') {
      const result = await testAmadeus(config);
      return NextResponse.json(result);
    }
    if (provider === 'google_places') {
      const result = await testGoogle(config);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Provider desconhecido' }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
