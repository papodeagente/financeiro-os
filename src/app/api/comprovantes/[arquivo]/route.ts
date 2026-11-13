import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { getTenantId } from '@/lib/tenant';
import { pastaComprovantes, MIME_COMPROVANTE } from '@/lib/comprovantes';

/**
 * Serve um comprovante. Exige sessão (o middleware não libera esta rota) e
 * só procura dentro da pasta do tenant da sessão, então um tenant não
 * alcança o arquivo do outro nem sabendo o nome.
 */


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ arquivo: string }> },
) {
  try {
    const { arquivo } = await params;

    // Só id gerado mais extensão. Barra, ponto duplo e til não passam,
    // então não há como subir de diretório.
    if (!/^[\w-]+\.(pdf|jpg|png|webp|avif)$/.test(arquivo)) {
      return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
    }

    const tenantId = await getTenantId();
    const dir = await pastaComprovantes(tenantId);
    const caminho = path.join(dir, arquivo);

    // Cinto e suspensório: mesmo com a regex, confere que o caminho final
    // continua dentro da pasta do tenant.
    if (!caminho.startsWith(dir + path.sep)) {
      return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
    }

    try {
      await stat(caminho);
    } catch {
      return NextResponse.json({ error: 'Comprovante não encontrado' }, { status: 404 });
    }

    const conteudo = await readFile(caminho);
    const ext = arquivo.split('.').pop() ?? '';
    return new NextResponse(new Uint8Array(conteudo), {
      headers: {
        'Content-Type': MIME_COMPROVANTE[ext] ?? 'application/octet-stream',
        // Privado: comprovante não pode ficar em cache compartilhado.
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${arquivo}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
