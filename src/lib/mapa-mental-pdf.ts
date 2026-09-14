import { nomeArquivoMapa } from './mapa-mental-sharing';

const MAX_CAPTURE_PIXELS = 24_000_000;
const MAX_CAPTURE_SIDE = 16_384;
const MAX_TITLE_LINES = 3;
const MAX_DETAIL_PAGES = 48;
// A quantidade real é limitada pela grade máxima de páginas; este teto alto
// evita penalizar mapas longos (uma única linha), que conseguem ampliar mais
// sem explodir a contagem de páginas.
const MAX_DETAIL_MAGNIFICATION = 128;
const MIN_DETAIL_MAGNIFICATION = 1.35;
const READABLE_FLOW_ZOOM = 0.85;
const PAGE_MARGIN = 8;
const PAGE_FOOTER_HEIGHT = 5;
const DETAIL_OVERLAP = 6;
const IMAGE_ALIAS = 'entur-mapa-mental';
const MM_PER_CSS_PIXEL = 25.4 / 96;

interface HeaderLayout {
  lines: string[];
  subtitle: string;
  contentTop: number;
}

interface PageGrid {
  columns: number;
  rows: number;
  pages: number;
  imageWidth: number;
  imageHeight: number;
  stepWidth: number;
  stepHeight: number;
  insetX: number;
  insetY: number;
}

export interface MapaMentalPdfGerado {
  blob: Blob;
  nomeArquivo: string;
}

/** Inicia o download somente depois de o chamador concluir autorização/auditoria. */
export function baixarMapaMentalPdf(arquivo: MapaMentalPdfGerado): void {
  const url = URL.createObjectURL(arquivo.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = arquivo.nomeArquivo;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari ainda pode estar consumindo a URL depois do click síncrono.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function proximoFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function comTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(undefined), timeoutMs);
    promise.then(
      value => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      () => {
        window.clearTimeout(timeout);
        resolve(undefined);
      },
    );
  });
}

async function aguardarImagem(image: HTMLImageElement): Promise<void> {
  if (!image.complete) {
    await new Promise<void>(resolve => {
      let timeout = 0;
      const concluir = () => {
        window.clearTimeout(timeout);
        image.removeEventListener('load', concluir);
        image.removeEventListener('error', concluir);
        resolve();
      };
      timeout = window.setTimeout(concluir, 4_000);
      image.addEventListener('load', concluir, { once: true });
      image.addEventListener('error', concluir, { once: true });
    });
  }

  // `complete` é definido antes de a imagem necessariamente estar pronta
  // para pintura. decode() evita capturar quadros vazios/intermediários.
  if (image.complete && image.naturalWidth > 0 && typeof image.decode === 'function') {
    await comTimeout(image.decode(), 2_000);
  }
}

async function aguardarImagens(elemento: HTMLElement): Promise<void> {
  await Promise.all(Array.from(elemento.querySelectorAll('img')).map(aguardarImagem));
}

function assinaturaLayout(elemento: HTMLElement): string {
  const viewport = elemento.querySelector<HTMLElement>('.react-flow__viewport');
  const nodes = Array.from(elemento.querySelectorAll<HTMLElement>('.react-flow__node'));
  const parts = [
    `${elemento.clientWidth}x${elemento.clientHeight}`,
    viewport ? getComputedStyle(viewport).transform : '',
    String(nodes.length),
  ];

  // A posição e o tamanho dos nós detectam o segundo passe de layout do
  // React Flow (fontes/imagens podem mudar ambos depois de o DOM existir).
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    parts.push(`${Math.round(rect.left * 10)},${Math.round(rect.top * 10)},${Math.round(rect.width * 10)},${Math.round(rect.height * 10)}`);
  }
  return parts.join('|');
}

async function aguardarLayoutEstavel(elemento: HTMLElement): Promise<void> {
  let previous = '';
  let stableFrames = 0;
  const deadline = Date.now() + 2_000;

  do {
    await proximoFrame();
    const current = assinaturaLayout(elemento);
    if (current === previous) {
      stableFrames += 1;
      if (stableFrames >= 3) return;
    } else {
      previous = current;
      stableFrames = 0;
    }
  } while (Date.now() < deadline);
}

function obterZoomReactFlow(elemento: HTMLElement): number | null {
  const viewport = elemento.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) return null;

  const inlineScale = viewport.style.transform.match(/scale\(\s*([\d.eE+-]+)\s*\)/);
  if (inlineScale) {
    const value = Number(inlineScale[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const transform = getComputedStyle(viewport).transform;
  if (!transform || transform === 'none') return 1;
  const match = transform.match(/^matrix(3d)?\((.+)\)$/);
  if (!match) return null;
  const values = match[2].split(',').map(Number);
  const scale = Math.hypot(values[0], values[1]);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

function orientacaoPeloConteudo(elemento: HTMLElement): 'landscape' | 'portrait' {
  const nodes = Array.from(elemento.querySelectorAll<HTMLElement>('.react-flow__node'));
  if (nodes.length === 0) {
    return elemento.clientWidth >= elemento.clientHeight ? 'landscape' : 'portrait';
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return elemento.clientWidth >= elemento.clientHeight ? 'landscape' : 'portrait';
  }
  return width >= height ? 'landscape' : 'portrait';
}

function recortarAoConteudo(source: HTMLCanvasElement, elemento: HTMLElement): HTMLCanvasElement {
  const nodes = Array.from(elemento.querySelectorAll<HTMLElement>('.react-flow__node'));
  if (nodes.length === 0) return source;
  const elementRect = elemento.getBoundingClientRect();
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    left = Math.min(left, rect.left - elementRect.left);
    top = Math.min(top, rect.top - elementRect.top);
    right = Math.max(right, rect.right - elementRect.left);
    bottom = Math.max(bottom, rect.bottom - elementRect.top);
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return source;

  // Mantém sombras, conectores próximos à borda e uma faixa do grid.
  const padding = 32;
  const scaleX = source.width / Math.max(1, elemento.clientWidth);
  const scaleY = source.height / Math.max(1, elemento.clientHeight);
  const sourceX = Math.max(0, Math.floor((left - padding) * scaleX));
  const sourceY = Math.max(0, Math.floor((top - padding) * scaleY));
  const sourceRight = Math.min(source.width, Math.ceil((right + padding) * scaleX));
  const sourceBottom = Math.min(source.height, Math.ceil((bottom + padding) * scaleY));
  const width = sourceRight - sourceX;
  const height = sourceBottom - sourceY;
  if (width < 1 || height < 1 || (width === source.width && height === source.height)) return source;

  const cropped = document.createElement('canvas');
  cropped.width = width;
  cropped.height = height;
  const context = cropped.getContext('2d');
  if (!context) return source;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sourceX, sourceY, width, height, 0, 0, width, height);
  return cropped;
}

function escalaCaptura(width: number, height: number): number {
  const area = Math.max(1, width * height);
  return Math.max(0.1, Math.min(
    8,
    Math.sqrt(MAX_CAPTURE_PIXELS / area),
    MAX_CAPTURE_SIDE / Math.max(1, width),
    MAX_CAPTURE_SIDE / Math.max(1, height),
  ));
}

function normalizarTitulo(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim() || 'Mapa mental';
}

function truncarLinha(pdf: import('jspdf').jsPDF, line: string, maxWidth: number): string {
  const ellipsis = '…';
  if (pdf.getTextWidth(`${line}${ellipsis}`) <= maxWidth) return `${line}${ellipsis}`;

  let low = 0;
  let high = line.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pdf.getTextWidth(`${line.slice(0, middle).trimEnd()}${ellipsis}`) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${line.slice(0, low).trimEnd()}${ellipsis}`;
}

function criarCabecalho(
  pdf: import('jspdf').jsPDF,
  title: string,
  subtitle: string,
  pageWidth: number,
): HeaderLayout {
  const availableWidth = pageWidth - PAGE_MARGIN * 2;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  const split = pdf.splitTextToSize(title, availableWidth);
  const allLines = Array.isArray(split) ? split.map(String) : [String(split)];
  const lines = allLines.slice(0, MAX_TITLE_LINES);
  if (allLines.length > MAX_TITLE_LINES) {
    lines[MAX_TITLE_LINES - 1] = truncarLinha(pdf, lines[MAX_TITLE_LINES - 1], availableWidth);
  }

  const firstBaseline = PAGE_MARGIN + 4;
  const lastBaseline = firstBaseline + (lines.length - 1) * 5;
  const subtitleBaseline = lastBaseline + 4.5;
  const dividerY = subtitleBaseline + 2.2;
  return { lines, subtitle, contentTop: dividerY + 3 };
}

function desenharCabecalho(
  pdf: import('jspdf').jsPDF,
  layout: HeaderLayout,
  pageWidth: number,
): void {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(30, 41, 59);
  layout.lines.forEach((line, index) => {
    pdf.text(line, PAGE_MARGIN, PAGE_MARGIN + 4 + index * 5);
  });

  const lastBaseline = PAGE_MARGIN + 4 + (layout.lines.length - 1) * 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text(layout.subtitle, PAGE_MARGIN, lastBaseline + 4.5);
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.2);
  pdf.line(PAGE_MARGIN, layout.contentTop - 3, pageWidth - PAGE_MARGIN, layout.contentTop - 3);
}

function calcularGrade(
  ratio: number,
  canvasWidth: number,
  canvasHeight: number,
  availableWidth: number,
  availableHeight: number,
): PageGrid {
  const imageWidth = canvasWidth * ratio;
  const imageHeight = canvasHeight * ratio;
  const stepWidth = Math.max(1, availableWidth - DETAIL_OVERLAP);
  const stepHeight = Math.max(1, availableHeight - DETAIL_OVERLAP);
  const columns = Math.max(1, Math.ceil(Math.max(0, imageWidth - DETAIL_OVERLAP) / stepWidth));
  const rows = Math.max(1, Math.ceil(Math.max(0, imageHeight - DETAIL_OVERLAP) / stepHeight));
  const coveredWidth = availableWidth + (columns - 1) * stepWidth;
  const coveredHeight = availableHeight + (rows - 1) * stepHeight;

  return {
    columns,
    rows,
    pages: columns * rows,
    imageWidth,
    imageHeight,
    stepWidth,
    stepHeight,
    insetX: Math.max(0, (coveredWidth - imageWidth) / 2),
    insetY: Math.max(0, (coveredHeight - imageHeight) / 2),
  };
}

function limitarMagnificacao(
  desired: number,
  fitRatio: number,
  canvasWidth: number,
  canvasHeight: number,
  availableWidth: number,
  availableHeight: number,
): number {
  const pagesFor = (magnification: number) => calcularGrade(
    fitRatio * magnification,
    canvasWidth,
    canvasHeight,
    availableWidth,
    availableHeight,
  ).pages;

  if (pagesFor(desired) <= MAX_DETAIL_PAGES) return desired;
  let low = 1;
  let high = desired;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (low + high) / 2;
    if (pagesFor(middle) <= MAX_DETAIL_PAGES) low = middle;
    else high = middle;
  }
  return low;
}

function adicionarImagemRecortada(
  pdf: import('jspdf').jsPDF,
  imageData: string,
  imageX: number,
  imageY: number,
  imageWidth: number,
  imageHeight: number,
  clipX: number,
  clipY: number,
  clipWidth: number,
  clipHeight: number,
): void {
  pdf.saveGraphicsState();
  pdf.rect(clipX, clipY, clipWidth, clipHeight);
  pdf.clip();
  pdf.discardPath();
  pdf.addImage(imageData, 'JPEG', imageX, imageY, imageWidth, imageHeight, IMAGE_ALIAS, 'FAST');
  pdf.restoreGraphicsState();
}

/**
 * Captura o React Flow enquadrado e devolve o arquivo sem iniciar o download.
 * Mapas pequenos ocupam uma página; quando o fitView precisou reduzir demais
 * os nós, o PDF ganha uma visão geral e páginas de detalhe com sobreposição.
 */
export async function exportarMapaMentalPdf(
  elemento: HTMLElement,
  nome: string,
): Promise<MapaMentalPdfGerado> {
  if (elemento.clientWidth < 1 || elemento.clientHeight < 1) {
    throw new Error('O mapa ainda não está pronto para exportação.');
  }

  await document.fonts?.ready;
  await aguardarImagens(elemento);
  await aguardarLayoutEstavel(elemento);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);

  // O carregamento assíncrono dos módulos pode dar tempo para outro passe de
  // layout; confira novamente imediatamente antes da captura.
  await aguardarLayoutEstavel(elemento);
  const flowZoom = obterZoomReactFlow(elemento);
  const orientation = orientacaoPeloConteudo(elemento);
  const capturedCanvas = await html2canvas(elemento, {
    scale: escalaCaptura(elemento.clientWidth, elemento.clientHeight),
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: '#FAFBFC',
    imageSmoothing: true,
    imageSmoothingQuality: 'high',
    ignoreElements: node => node.classList.contains('react-flow__controls')
      || node.classList.contains('react-flow__attribution'),
    onclone: clonedDocument => {
      const style = clonedDocument.createElement('style');
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
      clonedDocument.head.appendChild(style);
    },
  });

  if (capturedCanvas.width < 1 || capturedCanvas.height < 1) {
    throw new Error('Não foi possível capturar o mapa.');
  }
  const captureScale = capturedCanvas.width / Math.max(1, elemento.clientWidth);
  const canvas = recortarAoConteudo(capturedCanvas, elemento);
  if (canvas !== capturedCanvas) {
    // Libera cedo o bitmap da viewport inteira; mapas grandes podem chegar ao
    // teto de dezenas de milhões de pixels antes do recorte.
    capturedCanvas.width = 1;
    capturedCanvas.height = 1;
  }

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const title = normalizarTitulo(nome);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const header = criarCabecalho(pdf, title, 'Visão geral', pageWidth);
  const availableWidth = pageWidth - PAGE_MARGIN * 2;
  const availableHeight = pageHeight - header.contentTop - PAGE_MARGIN - PAGE_FOOTER_HEIGHT;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error('Não foi possível dimensionar a página do PDF.');
  }

  // Não estica mapas pequenos até ocupar uma folha inteira. O teto preserva
  // aproximadamente o tamanho CSS/96 dpi; mapas grandes continuam usando o
  // máximo disponível na página.
  const fitRatio = Math.min(
    availableWidth / canvas.width,
    availableHeight / canvas.height,
    (MM_PER_CSS_PIXEL * 1.15) / Math.max(0.1, captureScale),
  );
  const desiredMagnification = flowZoom
    ? Math.min(MAX_DETAIL_MAGNIFICATION, Math.max(1, READABLE_FLOW_ZOOM / flowZoom))
    : 1;
  const detailMagnification = limitarMagnificacao(
    desiredMagnification,
    fitRatio,
    canvas.width,
    canvas.height,
    availableWidth,
    availableHeight,
  );
  const hasDetailPages = detailMagnification >= MIN_DETAIL_MAGNIFICATION;
  const detailGrid = hasDetailPages
    ? calcularGrade(
      fitRatio * detailMagnification,
      canvas.width,
      canvas.height,
      availableWidth,
      availableHeight,
    )
    : null;
  const imageData = canvas.toDataURL('image/jpeg', 0.94);

  pdf.setProperties({ title, creator: 'Entur OS FIN' });
  const overviewSubtitle = detailGrid
    ? `Visão geral · ${detailGrid.pages} ${detailGrid.pages === 1 ? 'página de detalhe' : 'páginas de detalhe'} a seguir`
    : 'Visão geral';
  const overviewHeader = criarCabecalho(pdf, title, overviewSubtitle, pageWidth);
  desenharCabecalho(pdf, overviewHeader, pageWidth);
  const overviewWidth = canvas.width * fitRatio;
  const overviewHeight = canvas.height * fitRatio;
  pdf.addImage(
    imageData,
    'JPEG',
    (pageWidth - overviewWidth) / 2,
    overviewHeader.contentTop + (availableHeight - overviewHeight) / 2,
    overviewWidth,
    overviewHeight,
    IMAGE_ALIAS,
    'FAST',
  );

  if (detailGrid) {
    for (let row = 0; row < detailGrid.rows; row += 1) {
      for (let column = 0; column < detailGrid.columns; column += 1) {
        const detailNumber = row * detailGrid.columns + column + 1;
        pdf.addPage();
        const subtitle = `Detalhe ${detailNumber} de ${detailGrid.pages} · coluna ${column + 1}/${detailGrid.columns}, linha ${row + 1}/${detailGrid.rows}`;
        const detailHeader = criarCabecalho(pdf, title, subtitle, pageWidth);
        desenharCabecalho(pdf, detailHeader, pageWidth);
        adicionarImagemRecortada(
          pdf,
          imageData,
          PAGE_MARGIN + detailGrid.insetX - column * detailGrid.stepWidth,
          detailHeader.contentTop + detailGrid.insetY - row * detailGrid.stepHeight,
          detailGrid.imageWidth,
          detailGrid.imageHeight,
          PAGE_MARGIN,
          detailHeader.contentTop,
          availableWidth,
          availableHeight,
        );
      }
    }
  }

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`${page} / ${totalPages}`, pageWidth / 2, pageHeight - PAGE_MARGIN, { align: 'center' });
  }

  return {
    blob: pdf.output('blob'),
    nomeArquivo: nomeArquivoMapa(title),
  };
}
