import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { MIME_POR_EXTENSAO, PASTA_PUBLICA } from '@/lib/arquivos';

const NAO_ACHOU = () => NextResponse.json({ error: 'File not found' }, { status: 404 });

/**
 * Pasta pública (/app/data/uploads): imagens de proposta, mapa e perfil.
 *
 * Desde a auditoria de 04/11/2026 (FIN-08) documento NOVO vai para a pasta
 * privada (/api/arquivos/). Os documentos ANTIGOS que ficaram aqui continuam
 * abrindo como antes, sem login: os links deles já foram mandados a clientes
 * e passageiros, e quebrar todos de uma vez na publicação não é aceitável.
 * Risco aceito e registrado: quem tem um link antigo de documento continua
 * abrindo. A saída é o inventário desses arquivos (pendência da auditoria).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;
    if (!/^[\w-]+\.\w+$/.test(filename)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }
    const filePath = path.join(PASTA_PUBLICA, filename);
    if (path.dirname(filePath) !== PASTA_PUBLICA) return NAO_ACHOU();
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return NAO_ACHOU();
    const buffer = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': MIME_POR_EXTENSAO[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(buffer.length),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NAO_ACHOU();
  }
}
