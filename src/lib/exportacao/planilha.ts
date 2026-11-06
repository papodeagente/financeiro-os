/**
 * EXPORTAÇÃO (E7, G3): o documento em Excel (.xlsx), com o SheetJS que o
 * projeto já usa. Topo com título, filtros e a hora em que saiu; depois o
 * cabeçalho (com filtro automático do Excel), as linhas e o total. Dinheiro
 * sai como número com duas casas (soma no Excel), data como data.
 */
import * as XLSX from 'xlsx';
import {
  linhasDoCabecalho, matrizDoDocumento, type ColunaExportada, type DocumentoExportado,
} from './documento';

const FORMATO: Partial<Record<ColunaExportada['tipo'], string>> = {
  dinheiro: '#,##0.00;[Red]-#,##0.00',
  percentual: '0.00"%"',
  inteiro: '#,##0',
  numero: '#,##0.####',
};

/** dd/mm/aaaa → número de série do Excel (data sem hora). */
function serialDaData(s: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Math.round(utc / 86_400_000) + 25_569;
}

/** Bytes do .xlsx do documento. */
export function planilhaDoDocumento(doc: DocumentoExportado, geradoEm: Date = new Date()): Uint8Array {
  const topo = linhasDoCabecalho(doc, geradoEm).map(l => [l]);
  const matriz = matrizDoDocumento(doc);
  const inicio = topo.length + 1; // uma linha em branco antes do cabeçalho
  const aoa: Array<Array<string | number>> = [...topo, [], ...matriz];
  if (doc.nota) aoa.push([], [doc.nota]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Formatos por coluna e data como data de verdade.
  const ultimaLinha = inicio + matriz.length - 1;
  doc.colunas.forEach((c, ci) => {
    for (let r = inicio + 1; r <= ultimaLinha; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: ci });
      const cel = ws[ref];
      if (!cel) continue;
      if (c.tipo === 'data' && typeof cel.v === 'string') {
        const serial = serialDaData(cel.v);
        if (serial !== null) { cel.t = 'n'; cel.v = serial; cel.z = 'dd/mm/yyyy'; }
      } else if (cel.t === 'n' && FORMATO[c.tipo]) {
        cel.z = FORMATO[c.tipo];
      }
    }
  });

  // Largura pelo maior conteúdo (com teto), filtro automático no cabeçalho.
  ws['!cols'] = doc.colunas.map((c, ci) => {
    let maior = c.rotulo.length;
    for (let i = 1; i < Math.min(matriz.length, 500); i++) maior = Math.max(maior, String(matriz[i][ci] ?? '').length + (c.tipo === 'dinheiro' ? 4 : 0));
    return { wch: Math.min(Math.max(maior + 2, 8), 60) };
  });
  if (matriz.length > 1) {
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: inicio, c: 0 }, e: { r: inicio + Math.max(doc.linhas.length, 1), c: doc.colunas.length - 1 } }) };
  }

  const wb = XLSX.utils.book_new();
  const nomeDaAba = doc.titulo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha';
  XLSX.utils.book_append_sheet(wb, ws, nomeDaAba);
  const saida = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(saida);
}
