import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import { assinarUrl, documentoPrivadoDaUrl } from '@/lib/arquivos';
import {
  hashTokenCompartilhamento,
  prepararMapaCompartilhado,
  tokenPertenceAoCompartilhamento,
} from '@/lib/mapas-mentais-compartilhamento';

const PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

/** Anexos de documento privado no mapa (para assinar só os da agência dona). */
function anexosPrivados(valor: unknown, achados: Array<{ url: string }>, profundidade = 0): void {
  if (!valor || typeof valor !== 'object' || profundidade > 30) return;
  if (Array.isArray(valor)) { for (const v of valor) anexosPrivados(v, achados, profundidade + 1); return; }
  const obj = valor as Record<string, unknown>;
  // Nó do mapa guarda os anexos em `attachments` (src/lib/mapa-mental.ts).
  for (const chave of ['attachments', 'anexos']) {
    if (!Array.isArray(obj[chave])) continue;
    for (const a of obj[chave] as Array<{ url?: unknown }>) {
      if (a && typeof a.url === 'string' && documentoPrivadoDaUrl(a.url)) achados.push(a as { url: string });
    }
  }
  for (const v of Object.values(obj)) if (v && typeof v === 'object') anexosPrivados(v, achados, profundidade + 1);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS });
}

function dataIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const tokenHash = hashTokenCompartilhamento(token);
    if (!tokenHash) return json({ error: 'Link inválido' }, 400);
    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);

    const { rows } = await pool.query(
      `SELECT m.id, m.nome, m.data, m.tenant_id, c.id AS compartilhamento_id,
              c.allow_copy, c.created_at, s.secret_value
         FROM mapas_mentais_compartilhamentos c
         JOIN mapas_mentais m
           ON m.id = c.mapa_id AND m.tenant_id = c.tenant_id
         JOIN mapas_mentais_compartilhamento_segredos s
           ON s.version = c.secret_version
        WHERE c.token_hash = $1 AND c.revoked_at IS NULL
        LIMIT 1`,
      [tokenHash],
    );
    if (rows.length === 0) return json({ error: 'Link não encontrado ou revogado' }, 404);
    if (!tokenPertenceAoCompartilhamento(
      token,
      rows[0].compartilhamento_id,
      rows[0].secret_value,
    )) {
      return json({ error: 'Link não encontrado ou revogado' }, 404);
    }

    const mapa = prepararMapaCompartilhado(rows[0].data, rows[0].id, rows[0].nome);
    if (!mapa) return json({ error: 'Link não encontrado ou revogado' }, 404);
    // Documento anexado deixou de ser link aberto (FIN-08): quem tem o link
    // do mapa recebe uma URL assinada de curta duração para cada anexo.
    // Só os documentos da PRÓPRIA agência do mapa: um link para arquivo de
    // outra agência colado no mapa não vira acesso a ele.
    const achados: Array<{ url: string }> = [];
    anexosPrivados(mapa, achados);
    if (achados.length > 0) {
      const nomes = achados.map(a => documentoPrivadoDaUrl(a.url)!);
      const { rows: donos } = await pool.query(
        `SELECT nome FROM arquivos_privados WHERE nome = ANY($1::text[]) AND tenant_id = $2`,
        [nomes, rows[0].tenant_id],
      );
      const daAgencia = new Set(donos.map(d => String(d.nome)));
      for (const a of achados) if (daAgencia.has(documentoPrivadoDaUrl(a.url)!)) a.url = assinarUrl(a.url);
    }
    const baseUrl = getCanonicalBaseUrl().replace(/\/+$/, '');
    const encodedToken = encodeURIComponent(token);
    const allowCopy = rows[0].allow_copy === true;
    return json({
      mapa,
      allowCopy,
      publicUrl: `${baseUrl}/mapas-mentais/publico/${encodedToken}`,
      copyUrl: allowCopy
        ? `${baseUrl}/planejamento/mapas-mentais/importar/${encodedToken}`
        : null,
      createdAt: dataIso(rows[0].created_at),
    });
  } catch {
    return json({ error: 'Não foi possível abrir o mapa compartilhado' }, 500);
  }
}
