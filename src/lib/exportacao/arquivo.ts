/**
 * EXPORTAÇÃO (E7, G3): bytes e cabeçalhos HTTP do arquivo, sem sessão nem
 * banco (o envio agendado e o link de leitura também usam).
 */
import {
  FORMATOS_DE_EXPORTACAO, TIPO_MIME, csvDoDocumento,
  type DocumentoExportado, type FormatoDeExportacao,
} from './documento';
import { planilhaDoDocumento } from './planilha';
import { pdfDoDocumento } from './pdf';

export function formatoDaConsulta(v: string | null | undefined): FormatoDeExportacao | null {
  return (FORMATOS_DE_EXPORTACAO as readonly string[]).includes(v ?? '') ? (v as FormatoDeExportacao) : null;
}

/** Bytes do arquivo no formato pedido (sem conferir direito: quem chama já conferiu). */
export async function bytesDoDocumento(doc: DocumentoExportado, formato: FormatoDeExportacao, opcoes: { agencia?: string; geradoEm?: Date } = {}): Promise<Uint8Array> {
  if (formato === 'xlsx') return planilhaDoDocumento(doc, opcoes.geradoEm);
  if (formato === 'csv') return new TextEncoder().encode(csvDoDocumento(doc));
  return pdfDoDocumento(doc, { imprimir: formato === 'imprimir', geradoEm: opcoes.geradoEm, agencia: opcoes.agencia });
}

export function cabecalhosDoArquivo(nome: string, formato: FormatoDeExportacao): Record<string, string> {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return {
    'Content-Type': TIPO_MIME[formato],
    'Content-Disposition': `${formato === 'imprimir' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    'Cache-Control': 'no-store',
  };
}

