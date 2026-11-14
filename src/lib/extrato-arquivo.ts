/**
 * Leitura do arquivo de extrato (CSV ou OFX) que a agência baixa no site do
 * banco. Puro e sem nada do Node: roda no navegador (a tela de conciliação
 * lê o arquivo antes de mandar as linhas ao servidor) e nos testes.
 *
 * Saiu da página de conciliação sem mudar uma vírgula do comportamento
 * (06/11/2026, extrato automático): o adaptador de arquivo do contrato de
 * extrato (src/lib/extrato-automatico/adaptador-arquivo.ts) usa estas mesmas
 * funções, para o arquivo e a coleta automática viverem no mesmo contrato.
 */
import { paraISO, parseMoneyBR, round2 } from './money';

/** Linha crua vinda do arquivo. `fitid` só existe em OFX: é o identificador
 *  da transação no banco e serve de chave de deduplicação na reimportação. */
export interface LinhaArquivo {
  data: string;
  descricao: string;
  valor: number;
  fitid?: string;
}

export function parseCSV(text: string): LinhaArquivo[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  // Try to detect columns
  const cols = header.split(/[;,\t]/);
  const dateIdx = cols.findIndex(c => c.includes('data') || c.includes('date'));
  const descIdx = cols.findIndex(c => c.includes('desc') || c.includes('hist') || c.includes('memo'));
  const valIdx = cols.findIndex(c => c.includes('valor') || c.includes('amount') || c.includes('value'));

  const result: LinhaArquivo[] = [];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;

    const rawDate = parts[dateIdx >= 0 ? dateIdx : 0];
    const desc = parts[descIdx >= 0 ? descIdx : 1];
    // parseMoneyBR decide qual separador é decimal. Limpar o ponto na mão
    // transformava 1234.56 em 123456 (valor 100x maior).
    const valor = parseMoneyBR(parts[valIdx >= 0 ? valIdx : 2]);
    if (valor === null) continue;

    // Parse date (DD/MM/YYYY or YYYY-MM-DD)
    let isoDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      isoDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    result.push({ data: paraISO(isoDate), descricao: desc, valor: round2(valor) });
  }
  return result;
}

export function parseOFX(text: string): LinhaArquivo[] {
  const result: LinhaArquivo[] = [];
  const transactions = text.split('<STMTTRN>').slice(1);

  for (const tx of transactions) {
    const getTag = (tag: string) => {
      const match = tx.match(new RegExp(`<${tag}>([^<\\n]+)`));
      return match ? match[1].trim() : '';
    };

    const rawDate = getTag('DTPOSTED');
    const fitid = getTag('FITID');
    const desc = getTag('MEMO') || getTag('NAME') || fitid;
    const valor = parseMoneyBR(getTag('TRNAMT'));
    if (valor === null || !rawDate) continue;

    const isoDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
    result.push({ data: isoDate, descricao: desc, valor: round2(valor), ...(fitid ? { fitid } : {}) });
  }
  return result;
}

/** O formato pelo nome do arquivo, como a tela sempre decidiu. */
export function lerArquivoDeExtrato(conteudo: string, nomeArquivo: string): LinhaArquivo[] {
  const nome = nomeArquivo.toLowerCase();
  const isOFX = nome.endsWith('.ofx') || nome.endsWith('.qfx');
  return isOFX ? parseOFX(conteudo) : parseCSV(conteudo);
}
