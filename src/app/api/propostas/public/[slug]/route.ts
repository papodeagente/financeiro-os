import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { paraPublico } from '@/lib/proposta-publica';

// Só o recorte público: leads, contatos do aceite, comentários, visualizações,
// custos e margens ficam no servidor (auditoria 04/11, FIN-13 e FIN2-06).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    const result = await resolvePropostaForHost(req, slug);
    if (!result.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(paraPublico(result.data, slug), {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch {
    return NextResponse.json({ error: 'Erro' }, { status: 500 });
  }
}
