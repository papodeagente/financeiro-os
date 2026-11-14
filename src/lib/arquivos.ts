/**
 * Arquivos enviados pelo sistema (auditoria 04/11/2026, FIN-08).
 *
 * Antes: tudo ia para uma pasta servida sem login, com cache público de um
 * ano, e a extensão vinha do nome que o navegador mandou. Contrato, planilha
 * e documento pessoal virava link aberto para sempre.
 *
 * Agora:
 *  - O tipo é decidido pelos primeiros bytes do arquivo, não pelo nome nem
 *    pelo Content-Type do navegador. Arquivo que não bate com o que diz ser
 *    é recusado.
 *  - Imagem continua pública (aparece em proposta e mapa compartilhado) em
 *    /api/uploads/.
 *  - Documento (PDF, Office, texto, ZIP) vai para pasta privada, registrado
 *    com a agência dona, e só sai em /api/arquivos/ para quem está logado na
 *    agência (ou é da plataforma), ou por URL assinada de curta duração.
 *  - Documento antigo que ficou na pasta pública passa a exigir login; se o
 *    registro de auditoria do envio diz de qual agência é, só ela abre.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const PASTA_PUBLICA = process.env.NODE_ENV === 'production'
  ? '/app/data/uploads'
  : path.join(process.cwd(), 'public', 'uploads');

export const PASTA_PRIVADA = process.env.NODE_ENV === 'production'
  ? '/app/data/privado'
  : path.join(process.cwd(), '.data', 'privado');

export const ARQUIVOS_PRIVADOS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS arquivos_privados (
  nome TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  nome_original TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  tamanho BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_arquivos_privados_tenant ON arquivos_privados (tenant_id, created_at DESC);
`;

export const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
};

export const EXTENSOES_DE_IMAGEM = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

export interface TipoDetectado { ext: string; mime: string; imagem: boolean }

function comeca(b: Uint8Array, bytes: number[], desde = 0): boolean {
  if (b.length < desde + bytes.length) return false;
  return bytes.every((x, i) => b[desde + i] === x);
}

function ascii(b: Uint8Array, desde: number, n: number): string {
  return String.fromCharCode(...b.subarray(desde, desde + n));
}

/**
 * Tipo real pelo conteúdo. `extDoNome` só desempata famílias que têm a mesma
 * assinatura (ZIP: docx/xlsx/pptx/zip; OLE: doc/xls/ppt; texto: txt/csv).
 * Null = não é nenhum tipo aceito.
 */
export function detectarTipo(b: Uint8Array, extDoNome: string): TipoDetectado | null {
  const ext = extDoNome.toLowerCase();
  const tipo = (e: string): TipoDetectado => ({ ext: e, mime: MIME_POR_EXTENSAO[e], imagem: EXTENSOES_DE_IMAGEM.has(e) });
  if (comeca(b, [0xff, 0xd8, 0xff])) return tipo('jpg');
  if (comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return tipo('png');
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return tipo('gif');
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return tipo('webp');
  if (ascii(b, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 4))) return tipo('avif');
  if (ascii(b, 0, 5) === '%PDF-') return tipo('pdf');
  if (comeca(b, [0x50, 0x4b, 0x03, 0x04])) {
    return tipo(['docx', 'xlsx', 'pptx'].includes(ext) ? ext : 'zip');
  }
  if (comeca(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return ['doc', 'xls', 'ppt'].includes(ext) ? tipo(ext) : null;
  }
  if (ext === 'txt' || ext === 'csv') {
    const amostra = b.subarray(0, 64 * 1024);
    if (amostra.includes(0)) return null;
    return tipo(ext);
  }
  return null;
}

/** Nome gravado em disco: id nosso + extensão do tipo REAL. */
export const FORMATO_NOME = /^[A-Za-z0-9_-]{6,80}\.[a-z0-9]{2,5}$/;

function chaveDeAssinatura(): Buffer {
  const segredo = process.env.ARQUIVOS_URL_SECRET || process.env.JWT_SECRET || '';
  if (!segredo) throw new Error('JWT_SECRET ausente: não há como assinar URL de arquivo.');
  return createHmac('sha256', 'arquivos-url-assinada').update(segredo).digest();
}

function assinatura(caminho: string, expira: number): string {
  return createHmac('sha256', chaveDeAssinatura()).update(`${caminho}\n${expira}`).digest('base64url');
}

/** URL com validade curta para abrir um arquivo sem sessão. */
export function assinarUrl(caminho: string, segundos = 6 * 3600, agora = Date.now()): string {
  const expira = Math.floor(agora / 1000) + segundos;
  const sep = caminho.includes('?') ? '&' : '?';
  return `${caminho}${sep}exp=${expira}&sig=${assinatura(caminho, expira)}`;
}

export function assinaturaValida(caminho: string, exp: string | null, sig: string | null, agora = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const expira = Number(exp);
  if (expira * 1000 < agora) return false;
  const esperado = Buffer.from(assinatura(caminho, expira));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** Nome do documento privado citado numa URL nossa (/api/arquivos/<nome>), ou null. */
export function documentoPrivadoDaUrl(url: string): string | null {
  const m = /^\/api\/arquivos\/([^/?#]+)$/.exec(url);
  return m && FORMATO_NOME.test(m[1]) ? m[1] : null;
}

/** Prazo do link de documento que a agência copia para mandar a alguém. */
export const PRAZO_LINK_COMPARTILHADO_S = 90 * 24 * 3600;
