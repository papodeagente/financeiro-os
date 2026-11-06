/**
 * EXPORTAÇÃO (E7, G3): o documento em PDF (e o PDF que já abre a janela de
 * impressão), com o jsPDF que o projeto já usa (Prova da mudança). A4, em
 * paisagem quando as colunas não cabem em pé; cabeçalho repetido em cada
 * página; total em negrito; rodapé com o título e "página x de y".
 * Fonte padrão (helvetica, Latin-1): o que não cabe nela vira equivalente.
 */
import {
  linhasDoCabecalho, textoDaCelula, type ColunaExportada, type DocumentoExportado,
} from './documento';

type Doc = import('jspdf').jsPDF;

const MARGEM = 10;
const COR = { tinta: [15, 23, 42] as const, tinta2: [71, 85, 105] as const, tinta3: [91, 104, 120] as const, linha: [226, 232, 240] as const, zebra: [247, 249, 252] as const, negativo: [180, 35, 24] as const };

/** Troca o que a fonte padrão não desenha (setas, aspas tipográficas raras, emoji). */
export function paraLatin1(s: string): string {
  return s
    .replace(/[→⇒]/g, '->').replace(/[←⇐]/g, '<-').replace(/[✓✔]/g, 'ok').replace(/[✗✘]/g, 'x')
    .replace(/[−]/g, '-').replace(/[  ]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xff–—‘’“”•…€]/g, '');
}

/** Peso de cada coluna (para dividir a largura): maior texto, com piso e teto. */
export function pesosDasColunas(colunas: ColunaExportada[], celulas: string[][]): number[] {
  return colunas.map((c, ci) => {
    let maior = c.rotulo.length * 0.8;
    for (let i = 0; i < Math.min(celulas.length, 300); i++) maior = Math.max(maior, (celulas[i][ci] ?? '').length);
    const piso = c.tipo === 'texto' ? 8 : 6;
    const teto = c.tipo === 'texto' ? 42 : 18;
    return Math.min(Math.max(maior, piso), teto);
  });
}

/** Paisagem quando há muitas colunas ou o texto somado não cabe em pé. */
export function orientacaoDoDocumento(doc: DocumentoExportado, pesos: number[]): 'retrato' | 'paisagem' {
  if (doc.orientacao) return doc.orientacao;
  const soma = pesos.reduce((a, b) => a + b, 0);
  return doc.colunas.length > 6 || soma > 95 ? 'paisagem' : 'retrato';
}

const aDireita = (c: ColunaExportada) => c.tipo !== 'texto' && c.tipo !== 'data';

/** Bytes do PDF. Com `imprimir`, o leitor de PDF já abre a janela de impressão. */
export async function pdfDoDocumento(doc: DocumentoExportado, opcoes: { imprimir?: boolean; geradoEm?: Date; agencia?: string } = {}): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const un = doc.dinheiro_em ?? 'reais';
  const celulas = doc.linhas.map(l => doc.colunas.map(c => paraLatin1(textoDaCelula(c, l[c.id], un))));
  const total = doc.totais ? doc.colunas.map((c, i) => {
    const v = doc.totais![c.id];
    if (i === 0 && (v === undefined || v === null || v === '')) return doc.rotulo_total ?? 'Total';
    return paraLatin1(textoDaCelula(c, v, un));
  }) : null;
  const pesos = pesosDasColunas(doc.colunas, total ? [...celulas, total] : celulas);
  const paisagem = orientacaoDoDocumento(doc, pesos) === 'paisagem';
  const pdf: Doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: paisagem ? 'landscape' : 'portrait' });
  const LARG = paisagem ? 297 : 210;
  const ALT = paisagem ? 210 : 297;
  const util = LARG - 2 * MARGEM;
  const somaPesos = pesos.reduce((a, b) => a + b, 0) || 1;
  const larguras = pesos.map(p => (p / somaPesos) * util);
  const xs: number[] = [];
  { let x = MARGEM; for (const w of larguras) { xs.push(x); x += w; } }
  const fonte = doc.colunas.length > 14 ? 6 : doc.colunas.length > 10 ? 6.8 : 7.8;
  const alturaLinha = fonte * 0.45;

  // Topo da primeira página.
  let y = MARGEM + 4;
  const topo = linhasDoCabecalho(doc, opcoes.geradoEm ?? new Date()).map(paraLatin1);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(...COR.tinta);
  pdf.text(topo[0], MARGEM, y);
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...COR.tinta2);
  for (const l of topo.slice(1)) {
    for (const parte of pdf.splitTextToSize(l, util) as string[]) { pdf.text(parte, MARGEM, y); y += 4; }
  }
  y += 2;

  const cabecalho = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(fonte);
    pdf.setTextColor(...COR.tinta2);
    let maiorAltura = 1;
    const rotulos = doc.colunas.map((c, i) => {
      const linhas = (pdf.splitTextToSize(paraLatin1(c.rotulo), larguras[i] - 1.5) as string[]).slice(0, 2);
      maiorAltura = Math.max(maiorAltura, linhas.length);
      return linhas;
    });
    rotulos.forEach((linhas, i) => linhas.forEach((t, k) => {
      const c = doc.colunas[i];
      pdf.text(t, aDireita(c) ? xs[i] + larguras[i] - 0.8 : xs[i] + 0.8, y + k * alturaLinha, { align: aDireita(c) ? 'right' : 'left' });
    }));
    y += (maiorAltura - 1) * alturaLinha + 1.6;
    pdf.setDrawColor(...COR.tinta3);
    pdf.setLineWidth(0.25);
    pdf.line(MARGEM, y, LARG - MARGEM, y);
    y += alturaLinha + 0.8;
  };

  const novaPagina = () => {
    pdf.addPage();
    y = MARGEM + 4;
    cabecalho();
  };

  const linha = (cel: string[], opc: { negrito?: boolean; zebra?: boolean; negativos?: boolean[] } = {}) => {
    pdf.setFont('helvetica', opc.negrito ? 'bold' : 'normal');
    pdf.setFontSize(fonte);
    const partes = cel.map((t, i) => {
      const c = doc.colunas[i];
      const quebrado = pdf.splitTextToSize(t, larguras[i] - 1.5) as string[];
      return c.tipo === 'texto' ? quebrado.slice(0, 3) : [quebrado.join(' ')];
    });
    const n = Math.max(1, ...partes.map(p => p.length));
    const h = n * alturaLinha + 1.4;
    if (y + h > ALT - 14) novaPagina();
    if (opc.zebra) {
      pdf.setFillColor(...COR.zebra);
      pdf.rect(MARGEM, y - alturaLinha + 0.2, util, h, 'F');
    }
    partes.forEach((ps, i) => {
      const c = doc.colunas[i];
      const cor = opc.negativos?.[i] ? COR.negativo : COR.tinta;
      pdf.setTextColor(cor[0], cor[1], cor[2]);
      ps.forEach((t, k) => pdf.text(t, aDireita(c) ? xs[i] + larguras[i] - 0.8 : xs[i] + 0.8, y + k * alturaLinha, { align: aDireita(c) ? 'right' : 'left' }));
    });
    y += h;
  };

  cabecalho();
  if (!celulas.length) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...COR.tinta2);
    pdf.text('Nada neste recorte.', MARGEM, y + 2);
    y += 6;
  }
  celulas.forEach((cel, i) => {
    const negativos = doc.colunas.map(c => c.tipo === 'dinheiro' && typeof doc.linhas[i][c.id] === 'number' && (doc.linhas[i][c.id] as number) < 0);
    linha(cel, { zebra: i % 2 === 1, negativos });
  });
  if (total) {
    if (y + 6 > ALT - 14) novaPagina();
    pdf.setDrawColor(...COR.tinta);
    pdf.setLineWidth(0.3);
    pdf.line(MARGEM, y - alturaLinha + 0.2, LARG - MARGEM, y - alturaLinha + 0.2);
    y += 0.8;
    linha(total, { negrito: true });
  }
  if (doc.nota) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...COR.tinta2);
    for (const parte of pdf.splitTextToSize(paraLatin1(doc.nota), util) as string[]) {
      if (y + 4 > ALT - 14) { pdf.addPage(); y = MARGEM + 4; }
      pdf.text(parte, MARGEM, y + 2);
      y += 3.6;
    }
  }

  // Rodapé de todas as páginas.
  const paginas = pdf.getNumberOfPages();
  const titulo = paraLatin1(`${opcoes.agencia ? `${opcoes.agencia} · ` : ''}${doc.titulo}`);
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(...COR.tinta3);
    pdf.text(titulo, MARGEM, ALT - 6);
    pdf.text(`página ${p} de ${paginas}`, LARG - MARGEM, ALT - 6, { align: 'right' });
  }
  if (opcoes.imprimir) pdf.autoPrint();
  return new Uint8Array(pdf.output('arraybuffer'));
}
