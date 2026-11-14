import { NextResponse } from 'next/server';
import { baixarImagemSegura, DestinoRecusado } from '@/lib/saida-segura';
import { detectarTipo } from '@/lib/arquivos';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Proxy de imagem para a tela (auditoria 04/11/2026, FIN-06): só https, IP
 * conferido no próprio socket (sem rede interna, nem por DNS nem por
 * redirecionamento), corpo cortado no teto e resposta só se os bytes forem
 * mesmo de imagem.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
  }

  try {
    const { bytes } = await baixarImagemSegura(url, { tetoBytes: MAX_IMAGE_SIZE, tempoMs: 10_000 });
    const tipo = detectarTipo(bytes, '');
    if (!tipo?.imagem) {
      return NextResponse.json({ error: 'Response is not an image' }, { status: 400 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': tipo.mime,
        'Cache-Control': 'public, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof DestinoRecusado) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Proxy error' }, { status: 502 });
  }
}
