import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { assinaturaValida, FORMATO_NOME, MIME_POR_EXTENSAO, PASTA_PRIVADA } from '@/lib/arquivos';
import { donoDoArquivoPrivado, podeAbrir, type Consulta } from '@/lib/arquivos-acesso';

const NAO_ACHOU = () => NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });

/**
 * Documento privado (auditoria 04/11/2026, FIN-08): abre para a agência dona
 * (ou a plataforma) logada, ou com URL assinada de curta duração. Nunca com
 * cache público.
 */
export async function GET(req: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;
    if (!FORMATO_NOME.test(filename)) return NAO_ACHOU();
    await initDB();
    if (!pool) return NAO_ACHOU();

    const url = new URL(req.url);
    const assinado = assinaturaValida(`/api/arquivos/${filename}`, url.searchParams.get('exp'), url.searchParams.get('sig'));
    const dono = await donoDoArquivoPrivado(pool as unknown as Consulta, filename);
    if (!dono) return NAO_ACHOU();
    if (!assinado && !podeAbrir(await getSession(), dono, false)) return NAO_ACHOU();

    const filePath = path.join(PASTA_PRIVADA, filename);
    if (path.dirname(filePath) !== PASTA_PRIVADA) return NAO_ACHOU();
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return NAO_ACHOU();
    const buffer = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': MIME_POR_EXTENSAO[ext] || 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NAO_ACHOU();
  }
}
