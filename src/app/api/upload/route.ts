import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { registrarEventoAuditoria } from '@/lib/audit';
import { detectarTipo, PASTA_PRIVADA, PASTA_PUBLICA } from '@/lib/arquivos';

const MAX_SIZE = 25 * 1024 * 1024; // 25MB (PDFs/contratos costumam passar de 10MB)
const MAX_ARQUIVOS = 20;

/**
 * Envio de arquivos (auditoria 04/11/2026, FIN-08; regras em src/lib/arquivos.ts).
 * Imagem → pasta pública (/api/uploads/). Documento → pasta privada da
 * agência (/api/arquivos/), que só abre com login ou URL assinada.
 */
export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const formData = await req.formData();
    const files = formData.getAll('files').filter((f): f is File => typeof f !== 'string');

    if (files.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }
    if (files.length > MAX_ARQUIVOS) {
      return NextResponse.json({ error: `Envie no máximo ${MAX_ARQUIVOS} arquivos por vez` }, { status: 400 });
    }

    await initDB();
    const results: { url: string; nome: string; tamanho: number }[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: `Arquivo muito grande: ${file.name} (max 25MB)` }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const extDoNome = file.name.split('.').pop()?.toLowerCase() || '';
      const tipo = detectarTipo(buffer, extDoNome);
      if (!tipo) {
        return NextResponse.json({ error: `Tipo de arquivo não aceito: ${file.name.slice(0, 120)}` }, { status: 400 });
      }

      // Nome imprevisível (128 bits) + extensão do tipo REAL.
      const fileName = `${randomBytes(16).toString('base64url')}.${tipo.ext}`;
      const pasta = tipo.imagem ? PASTA_PUBLICA : PASTA_PRIVADA;
      await mkdir(pasta, { recursive: true });
      const filePath = path.join(pasta, fileName);
      await writeFile(filePath, buffer, { flag: 'wx' });
      try {
        if (!tipo.imagem) {
          if (!pool) throw new Error('Banco de dados indisponível.');
          await pool.query(
            `INSERT INTO arquivos_privados (nome, tenant_id, nome_original, mime, tamanho) VALUES ($1, $2, $3, $4, $5)`,
            [fileName, tenantId, file.name.slice(0, 255), tipo.mime, buffer.length],
          );
        }
        await registrarEventoAuditoria({
          tenantId,
          acao: 'ENVIAR',
          modulo: 'Arquivos',
          entidade: 'arquivos',
          entidadeId: fileName,
          descricao: `Enviou o arquivo ${file.name.slice(0, 120)} (${file.size} bytes).`,
        });
      } catch (e) {
        // A URL ainda não foi entregue: desfaz só o arquivo recém-criado.
        await unlink(filePath).catch(() => {});
        throw e;
      }

      results.push({
        url: tipo.imagem ? `/api/uploads/${fileName}` : `/api/arquivos/${fileName}`,
        nome: file.name,
        tamanho: file.size,
      });
    }

    return NextResponse.json(results);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro no upload' }, { status: 500 });
  }
}
