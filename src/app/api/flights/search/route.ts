import { NextResponse } from 'next/server';
import { searchFlights } from '@/lib/searchapi-flights';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await searchFlights({
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
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro na busca de voos' }, { status: 500 });
  }
}
