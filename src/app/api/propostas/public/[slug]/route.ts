import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { resolvePropostaForHost } from '@/lib/tenant-host';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    const result = await resolvePropostaForHost(req, slug);
    if (!result.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(result.data);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
