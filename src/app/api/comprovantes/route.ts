import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import { pastaComprovantes, TIPOS_COMPROVANTE, MAX_COMPROVANTE } from '@/lib/comprovantes';

/**
 * Comprovante de pagamento e de recebimento.
 *
 * Guardado SEPARADO de /api/uploads. Aquela pasta é pública de propósito,
 * porque a proposta enviada ao cliente precisa servir imagem sem sessão
 * (ver PUBLIC_PATHS no middleware). Comprovante tem dado bancário, valor e
 * fornecedor: não pode ficar acessível a quem tiver a URL.
 *
 * O arquivo é gravado dentro da pasta do tenant, e a rota de leitura só
 * procura na pasta do tenant da sessão. Assim o isolamento não depende de
 * ninguém lembrar de checar: um tenant sequer alcança o caminho do outro.
 */



export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const form = await req.formData();
    const arquivos = form.getAll('files') as File[];

    if (arquivos.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }
    if (arquivos.length > 5) {
      return NextResponse.json({ error: 'No máximo 5 comprovantes por vez' }, { status: 400 });
    }

    const dir = await pastaComprovantes(tenantId);
    const salvos: Array<{ nome: string; url: string }> = [];

    for (const arquivo of arquivos) {
      if (!(arquivo instanceof File) || arquivo.size === 0) continue;

      const ext = TIPOS_COMPROVANTE[arquivo.type];
      if (!ext) {
        return NextResponse.json(
          { error: `${arquivo.name}: aceito apenas PDF, JPG, PNG, WEBP ou AVIF` },
          { status: 400 },
        );
      }
      if (arquivo.size > MAX_COMPROVANTE) {
        return NextResponse.json(
          { error: `${arquivo.name} tem mais de 10MB` },
          { status: 400 },
        );
      }

      const id = `${generateId()}.${ext}`;
      await writeFile(path.join(dir, id), Buffer.from(await arquivo.arrayBuffer()));
      salvos.push({
        // O nome original é só rótulo. O caminho real é o id gerado, para
        // nome de arquivo do usuário nunca virar caminho.
        nome: arquivo.name.slice(0, 120),
        url: `/api/comprovantes/${id}`,
      });
    }

    if (salvos.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo válido' }, { status: 400 });
    }
    return NextResponse.json({ arquivos: salvos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
