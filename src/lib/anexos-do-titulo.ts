/**
 * Anexo livre em qualquer título (E7, frente D, 06/11/2026) — regra pura.
 *
 * Contrato, nota, voucher, planilha, e-mail salvo: qualquer arquivo dos tipos
 * aceitos, conferido no SERVIDOR pelo conteúdo (os primeiros bytes), nunca
 * pelo nome nem pelo que o navegador diz. Os anexos ficam na lista de sempre
 * do título (`data.anexos: [{ nome, url }]`), a mesma que a leitura do boleto
 * e o comprovante da baixa já usam; o arquivo mora na pasta privada da
 * agência (a dos comprovantes), servida só com sessão.
 */
import { detectarTipo, MIME_POR_EXTENSAO } from './arquivos';

/** 15 MB por arquivo: contrato escaneado cabe; vídeo não. */
export const ANEXO_MAX_BYTES = 15 * 1024 * 1024;
/** Até 20 arquivos por título. */
export const MAX_ANEXOS_POR_TITULO = 20;

/** Tipos aceitos (o que detectarTipo reconhece). */
export const EXTENSOES_DO_ANEXO = ['pdf', 'jpg', 'png', 'webp', 'gif', 'avif', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'] as const;
export const DESCRICAO_DOS_TIPOS = 'PDF, imagem (JPG, PNG, WEBP, GIF), Word, Excel, PowerPoint, texto, CSV ou ZIP';

export interface Anexo {
  nome: string;
  url: string;
  /** Quando e quem anexou (anexos novos; os antigos não têm). */
  enviado_em?: string;
  enviado_por?: string;
  tamanho?: number;
}

/** Os anexos gravados, em forma segura (antigos sem data continuam). */
export function anexosDe(data: Record<string, unknown> | null | undefined): Anexo[] {
  const lista = Array.isArray(data?.anexos) ? data!.anexos as unknown[] : [];
  const saida: Anexo[] = [];
  for (const a of lista) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    const url = typeof x.url === 'string' ? x.url : '';
    if (!url) continue;
    saida.push({
      nome: typeof x.nome === 'string' && x.nome ? x.nome : url.split('/').pop() ?? 'arquivo',
      url,
      ...(typeof x.enviado_em === 'string' ? { enviado_em: x.enviado_em } : {}),
      ...(typeof x.enviado_por === 'string' ? { enviado_por: x.enviado_por } : {}),
      ...(typeof x.tamanho === 'number' ? { tamanho: x.tamanho } : {}),
    });
  }
  return saida;
}

/** Nome de arquivo legível e seguro para mostrar (nunca vira caminho). */
export function nomeDoAnexo(original: string): string {
  const limpo = String(original ?? '').replace(/[\u0000-\u001f\\/<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (limpo || 'arquivo').slice(0, 120);
}

/**
 * Confere o arquivo: tamanho e tipo REAL pelo conteúdo. Devolve a extensão e
 * o tipo a gravar, ou o erro em português.
 */
export function conferirArquivoDoAnexo(
  bytes: Uint8Array, nomeOriginal: string, jaTem: number,
): { ok: true; ext: string; mime: string } | { ok: false; erro: string } {
  if (jaTem >= MAX_ANEXOS_POR_TITULO) return { ok: false, erro: `Esta conta já tem ${MAX_ANEXOS_POR_TITULO} anexos. Tire um antes de pôr outro.` };
  if (bytes.length === 0) return { ok: false, erro: 'O arquivo está vazio.' };
  if (bytes.length > ANEXO_MAX_BYTES) return { ok: false, erro: `O arquivo passa de ${ANEXO_MAX_BYTES / 1024 / 1024} MB.` };
  const ext = String(nomeOriginal ?? '').split('.').pop() ?? '';
  const tipo = detectarTipo(bytes, ext);
  if (!tipo || !(EXTENSOES_DO_ANEXO as readonly string[]).includes(tipo.ext)) {
    return { ok: false, erro: `Tipo de arquivo não aceito. Aceitos: ${DESCRICAO_DOS_TIPOS}.` };
  }
  return { ok: true, ext: tipo.ext, mime: tipo.mime };
}

/** Nome de arquivo dos anexos na pasta da agência (o que a rota de leitura aceita). */
export const FORMATO_DO_ARQUIVO_PRIVADO = /^[\w-]+\.(pdf|jpg|png|webp|gif|avif|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip)$/;

/** Tipo para servir; arquivos que não são PDF nem imagem descem como download. */
export function comoServir(arquivo: string): { mime: string; inline: boolean } {
  const ext = arquivo.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_POR_EXTENSAO[ext] ?? 'application/octet-stream';
  return { mime, inline: ext === 'pdf' || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext) };
}
