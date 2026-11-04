import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { assinaturaValida, EXTENSOES_DE_IMAGEM, MIME_POR_EXTENSAO, PASTA_PUBLICA } from '@/lib/arquivos';
import { donoDoArquivoAntigo, podeAbrir, type Consulta } from '@/lib/arquivos-acesso';

const NAO_ACHOU = () => NextResponse.json({ error: 'File not found' }, { status: 404 });

/**
 * Pasta pública: imagens (de proposta, mapa, perfil) continuam abertas e com
 * cache. Documento que ficou aqui de antes (auditoria 04/11/2026, FIN-08)
 * passa a exigir login da agência dona, ou URL assinada, e sai sem cache
 * público e como download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;
    if (!/^[\w-]+\.\w+$/.test(filename)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const imagem = EXTENSOES_DE_IMAGEM.has(ext);

    if (!imagem) {
      const url = new URL(req.url);
      const assinado = assinaturaValida(`/api/uploads/${filename}`, url.searchParams.get('exp'), url.searchParams.get('sig'));
      if (!assinado) {
        await initDB();
        const dono = pool ? await donoDoArquivoAntigo(pool as unknown as Consulta, filename) : null;
        if (!podeAbrir(await getSession(), dono, true)) return NAO_ACHOU();
      }
    }

    const filePath = path.join(PASTA_PUBLICA, filename);
    if (path.dirname(filePath) !== PASTA_PUBLICA) return NAO_ACHOU();
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return NAO_ACHOU();
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: imagem
        ? {
            'Content-Type': MIME_POR_EXTENSAO[ext],
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': String(buffer.length),
            'X-Content-Type-Options': 'nosniff',
          }
        : {
            'Content-Type': MIME_POR_EXTENSAO[ext] || 'application/octet-stream',
            'Cache-Control': 'private, no-store',
            'Content-Length': String(buffer.length),
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
    });
  } catch {
    return NAO_ACHOU();
  }
}
