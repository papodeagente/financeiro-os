import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { getTenantId } from '@/lib/tenant';
import { registrarEventoAuditoria } from '@/lib/audit';
import { baixarImagemSegura } from '@/lib/saida-segura';
import { detectarTipo, PASTA_PUBLICA } from '@/lib/arquivos';

const MAX_SIZE = 15 * 1024 * 1024; // 15MB per image
const MAX_BATCH = 24;
const EM_PARALELO = 4;

/**
 * Baixa uma imagem de fora para a pasta pública (auditoria 04/11/2026,
 * FIN-06): cliente de saída seguro (só https, sem rede interna, redirect
 * conferido a cada salto, teto lido em fluxo) e só grava se os bytes forem
 * de imagem. A extensão vem do conteúdo, nunca do Content-Type de quem
 * respondeu.
 */
async function downloadOne(url: string, tenantId: string): Promise<string | null> {
  try {
    const { bytes } = await baixarImagemSegura(url, { tetoBytes: MAX_SIZE, tempoMs: 15_000 });
    const tipo = detectarTipo(bytes, '');
    if (!tipo?.imagem || bytes.length === 0) return null;

    await mkdir(PASTA_PUBLICA, { recursive: true });
    const fileName = `${randomBytes(16).toString('base64url')}.${tipo.ext}`;
    const filePath = path.join(PASTA_PUBLICA, fileName);
    await writeFile(filePath, bytes, { flag: 'wx' });
    try {
      await registrarEventoAuditoria({
        tenantId,
        acao: 'ENVIAR',
        modulo: 'Arquivos',
        entidade: 'imagens',
        entidadeId: fileName,
        descricao: `Importou uma imagem para o sistema (${bytes.length} bytes).`,
      });
    } catch (e) {
      await unlink(filePath).catch(() => {});
      throw e;
    }
    return `/api/uploads/${fileName}`;
  } catch {
    return null;
  }
}

/**
 * POST /api/import-images
 * Body: { urls: string[] }
 * Response: { urls: (string | null)[] }
 *
 * Itens que falham voltam null, para a tela manter a URL original ou pular.
 */
export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => null);
    const inputUrls: unknown = body?.urls;
    if (!Array.isArray(inputUrls) || inputUrls.length === 0) {
      return NextResponse.json({ urls: [] });
    }

    const valid = inputUrls
      .filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= 2048)
      .slice(0, MAX_BATCH);
    if (valid.length === 0) return NextResponse.json({ urls: [] });

    // No máximo EM_PARALELO downloads ao mesmo tempo (eram 24 de uma vez).
    const results: (string | null)[] = new Array(valid.length).fill(null);
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < valid.length) {
        const i = proximo++;
        const u = valid[i];
        results[i] = u.startsWith('/api/uploads/') || u.startsWith('/uploads/') ? u : await downloadOne(u, tenantId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(EM_PARALELO, valid.length) }, trabalhador));

    return NextResponse.json({ urls: results });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao importar imagens' },
      { status: 500 }
    );
  }
}
