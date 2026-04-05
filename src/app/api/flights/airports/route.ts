import { NextResponse } from 'next/server';
import { searchAirports } from '@/lib/airports-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '';
  if (keyword.length < 2) return NextResponse.json({ data: [] });

  const results = searchAirports(keyword);
  return NextResponse.json({ data: results });
}
