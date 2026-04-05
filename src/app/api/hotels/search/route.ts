import { NextResponse } from 'next/server';
import { searchHotels } from '@/lib/searchapi-hotels';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await searchHotels({
      query: body.query || `hotéis em ${body.destino}`,
      check_in: body.check_in,
      check_out: body.check_out,
      adults: body.adults || 2,
      children: body.children || 0,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro na busca de hotéis' }, { status: 500 });
  }
}
