/**
 * Relatório do Planejamento mensal em PDF.
 *
 * Desenhado em VETOR com jsPDF (texto real, selecionável e nítido em
 * qualquer zoom) em vez de capturar a tela com html2canvas. Além da
 * qualidade, é o que dá controle sobre onde a página quebra: cada bloco é
 * medido antes de ser desenhado e, se não couber no que resta da folha,
 * vai inteiro para a próxima — nenhum card, linha de tabela ou parágrafo
 * é cortado ao meio.
 */
import type { CustosData, Relatorio } from './planejamento-custos';
import type { Analise, Apontamento } from './planejamento-analise';

// ── Página A4 retrato, tudo em milímetros ────────────────────────────────
const PAG_L = 210;
const PAG_A = 297;
const MARGEM = 16;
const CONTEUDO_L = PAG_L - MARGEM * 2;
const RODAPE_Y = PAG_A - 12;
const LIMITE_Y = RODAPE_Y - 6;

// Paleta: slate/indigo do produto, com verde e âmbar semânticos.
type RGB = readonly [number, number, number];
const COR: Record<string, RGB> = {
  tinta: [15, 23, 42],
  tinta2: [71, 85, 105],
  tinta3: [100, 116, 139],
  linha: [226, 232, 240],
  fundo: [248, 250, 252],
  azul: [0, 74, 173],
  verde: [16, 185, 129],
  ambar: [217, 119, 6],
  vermelho: [220, 38, 38],
};

const brl = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dec = (v: number, c = 1) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function mesExtenso(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES[(m || 1) - 1] ?? ''} de ${ano}`;
}

/** Carrega a logo como dataURL. Se falhar, o cabeçalho cai no texto. */
async function carregarLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch('/logo-enturos-fin.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 500, h: 150 });
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    return null;
  }
}

type Doc = import('jspdf').jsPDF;

/** Estado do desenho: cursor vertical + numeração de página. */
interface Ctx {
  doc: Doc;
  y: number;
  pagina: number;
  logo: { data: string; w: number; h: number } | null;
  titulo: string;
  subtitulo: string;
}

function novaPagina(ctx: Ctx) {
  rodape(ctx);
  ctx.doc.addPage();
  ctx.pagina += 1;
  ctx.y = MARGEM;
  cabecalhoCompacto(ctx);
}

/** Reserva espaço: se o bloco não couber inteiro, empurra para a próxima página. */
function reservar(ctx: Ctx, altura: number) {
  if (ctx.y + altura > LIMITE_Y) novaPagina(ctx);
}

function rodape(ctx: Ctx) {
  const { doc } = ctx;
  doc.setDrawColor(...COR.linha);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, RODAPE_Y - 4, PAG_L - MARGEM, RODAPE_Y - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR.tinta3);
  doc.text('Entur OS FIN · Planejamento mensal', MARGEM, RODAPE_Y);
  doc.text(`${ctx.pagina}`, PAG_L - MARGEM, RODAPE_Y, { align: 'right' });
}

/** Cabeçalho das páginas seguintes: uma faixa fina, sem repetir a capa. */
function cabecalhoCompacto(ctx: Ctx) {
  const { doc } = ctx;
  if (ctx.logo) {
    const h = 5.5;
    const w = (ctx.logo.w / ctx.logo.h) * h;
    doc.addImage(ctx.logo.data, 'PNG', MARGEM, ctx.y, w, h);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COR.tinta3);
  doc.text(ctx.subtitulo, PAG_L - MARGEM, ctx.y + 4, { align: 'right' });
  ctx.y += 10;
  doc.setDrawColor(...COR.linha);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, ctx.y, PAG_L - MARGEM, ctx.y);
  ctx.y += 8;
}

function tituloSecao(ctx: Ctx, texto: string) {
  reservar(ctx, 16);
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COR.azul);
  doc.text(texto.toUpperCase(), MARGEM, ctx.y);
  ctx.y += 2.5;
  doc.setDrawColor(...COR.azul);
  doc.setLineWidth(0.4);
  doc.line(MARGEM, ctx.y, MARGEM + 14, ctx.y);
  ctx.y += 6;
}

/** Linha rótulo → valor, com pontilhado ligando as duas pontas. */
function linhaValor(ctx: Ctx, rotulo: string, valor: string, opts: { forte?: boolean; cor?: RGB } = {}) {
  reservar(ctx, 7);
  const { doc } = ctx;
  doc.setFontSize(9);
  doc.setFont('helvetica', opts.forte ? 'bold' : 'normal');
  doc.setTextColor(...(opts.forte ? COR.tinta : COR.tinta2));
  doc.text(rotulo, MARGEM, ctx.y);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...(opts.cor ?? (opts.forte ? COR.tinta : COR.tinta2)));
  doc.text(valor, PAG_L - MARGEM, ctx.y, { align: 'right' });

  // pontilhado só quando há espaço confortável entre rótulo e valor
  const larguraRotulo = doc.getTextWidth(rotulo);
  doc.setFont('helvetica', 'bold');
  const larguraValor = doc.getTextWidth(valor);
  const inicio = MARGEM + larguraRotulo + 2;
  const fim = PAG_L - MARGEM - larguraValor - 2;
  if (fim - inicio > 6) {
    doc.setDrawColor(...COR.linha);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([0.5, 1], 0);
    doc.line(inicio, ctx.y - 0.8, fim, ctx.y - 0.8);
    doc.setLineDashPattern([], 0);
  }
  ctx.y += 6;
}

/** Parágrafo justificado que nunca é cortado no meio de uma linha. */
function paragrafo(ctx: Ctx, texto: string, opts: { tamanho?: number; cor?: RGB; recuo?: number } = {}) {
  const { doc } = ctx;
  const tamanho = opts.tamanho ?? 9;
  const recuo = opts.recuo ?? 0;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(tamanho);
  doc.setTextColor(...(opts.cor ?? COR.tinta2));
  const linhas: string[] = doc.splitTextToSize(texto, CONTEUDO_L - recuo);
  const alturaLinha = tamanho * 0.45;
  for (const linha of linhas) {
    reservar(ctx, alturaLinha + 1);
    doc.text(linha, MARGEM + recuo, ctx.y);
    ctx.y += alturaLinha;
  }
  ctx.y += 1.5;
}

/** Mede a altura que um bloco de apontamento vai ocupar, antes de desenhar. */
function alturaApontamento(doc: Doc, a: Apontamento): number {
  doc.setFontSize(8.5);
  const linhas: string[] = doc.splitTextToSize(a.texto, CONTEUDO_L - 10);
  return 6 + linhas.length * 3.9 + 5;
}

function apontamento(ctx: Ctx, a: Apontamento) {
  const { doc } = ctx;
  const altura = alturaApontamento(doc, a);
  reservar(ctx, altura);              // o bloco inteiro cabe ou vai pra próxima

  const cor = a.gravidade === 'critico' ? COR.vermelho : a.gravidade === 'atencao' ? COR.ambar : COR.verde;
  const topo = ctx.y - 3.5;

  doc.setFillColor(...cor);
  doc.rect(MARGEM, topo, 1.2, altura - 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COR.tinta);
  doc.text(a.titulo, MARGEM + 5, ctx.y);
  ctx.y += 4.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COR.tinta2);
  const linhas: string[] = doc.splitTextToSize(a.texto, CONTEUDO_L - 10);
  for (const linha of linhas) {
    doc.text(linha, MARGEM + 5, ctx.y);
    ctx.y += 3.9;
  }
  ctx.y += 5;
}

/** Rótulo de subseção. Só é desenhado se o primeiro item também couber —
 *  título sozinho no pé da página é a quebra mais feia que existe. */
function subtitulo(ctx: Ctx, texto: string, alturaPrimeiroItem: number) {
  reservar(ctx, 6 + alturaPrimeiroItem);
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COR.tinta);
  doc.text(texto, MARGEM, ctx.y);
  ctx.y += 6;
}

/** Card de número grande. Três por linha, alturas iguais. */
function cardsDestaque(ctx: Ctx, cards: { valor: string; rotulo: string; nota?: string; cor?: RGB }[]) {
  const alturaCard = 26;
  reservar(ctx, alturaCard + 4);
  const { doc } = ctx;
  const gap = 4;
  const larg = (CONTEUDO_L - gap * (cards.length - 1)) / cards.length;

  cards.forEach((c, i) => {
    const x = MARGEM + i * (larg + gap);
    doc.setFillColor(...COR.fundo);
    doc.setDrawColor(...COR.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, ctx.y, larg, alturaCard, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...(c.cor ?? COR.tinta));
    // encolhe o número se ele não couber na largura do card
    let tam = 16;
    while (doc.getTextWidth(c.valor) > larg - 8 && tam > 9) {
      tam -= 0.5;
      doc.setFontSize(tam);
    }
    doc.text(c.valor, x + 4, ctx.y + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR.tinta2);
    doc.text(c.rotulo, x + 4, ctx.y + 17);
    if (c.nota) {
      doc.setFontSize(7);
      doc.setTextColor(...COR.tinta3);
      doc.text(c.nota, x + 4, ctx.y + 21.5);
    }
  });
  ctx.y += alturaCard + 7;
}

/** Tabela de custos: cabeçalho repetido quando a tabela atravessa páginas. */
function tabela(
  ctx: Ctx,
  colunas: { titulo: string; largura: number; alinhar?: 'left' | 'right' }[],
  linhas: string[][],
  total?: { rotulo: string; valor: string },
) {
  const { doc } = ctx;
  const alturaLinha = 6.2;

  // Tabela que cabe inteira numa folha nunca é partida: se não couber no que
  // resta desta, vai inteira para a próxima.
  const alturaTotal = 5.5 + linhas.length * alturaLinha + (total ? alturaLinha + 1 : 0) + 4;
  const alturaUtilPagina = LIMITE_Y - (MARGEM + 18);
  if (alturaTotal <= alturaUtilPagina && ctx.y + alturaTotal > LIMITE_Y) {
    novaPagina(ctx);
  }

  const desenhaCabecalho = () => {
    reservar(ctx, alturaLinha * 2);
    doc.setFillColor(...COR.fundo);
    doc.rect(MARGEM, ctx.y - 4, CONTEUDO_L, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR.tinta3);
    let x = MARGEM + 2;
    colunas.forEach(c => {
      const alinhar = c.alinhar ?? 'left';
      doc.text(c.titulo.toUpperCase(), alinhar === 'right' ? x + c.largura - 4 : x, ctx.y, { align: alinhar });
      x += c.largura;
    });
    ctx.y += 5.5;
  };

  desenhaCabecalho();

  linhas.forEach(linha => {
    if (ctx.y + alturaLinha > LIMITE_Y) {
      novaPagina(ctx);
      desenhaCabecalho();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COR.tinta2);
    let x = MARGEM + 2;
    linha.forEach((cel, i) => {
      const col = colunas[i];
      const alinhar = col.alinhar ?? 'left';
      const max = col.largura - 5;
      let txt = cel;
      while (doc.getTextWidth(txt) > max && txt.length > 4) txt = txt.slice(0, -2);
      if (txt !== cel) txt = txt.slice(0, -1) + '…';
      doc.text(txt, alinhar === 'right' ? x + col.largura - 4 : x, ctx.y, { align: alinhar });
      x += col.largura;
    });
    doc.setDrawColor(...COR.linha);
    doc.setLineWidth(0.15);
    doc.line(MARGEM, ctx.y + 1.8, PAG_L - MARGEM, ctx.y + 1.8);
    ctx.y += alturaLinha;
  });

  if (total) {
    reservar(ctx, alturaLinha + 2);
    doc.setFillColor(...COR.fundo);
    doc.rect(MARGEM, ctx.y - 4, CONTEUDO_L, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COR.tinta);
    doc.text(total.rotulo, MARGEM + 2, ctx.y);
    doc.text(total.valor, PAG_L - MARGEM - 2, ctx.y, { align: 'right' });
    ctx.y += alturaLinha + 1;
  }
  ctx.y += 4;
}

// ── Documento ────────────────────────────────────────────────────────────

export async function gerarPdfPlanejamento(
  data: CustosData,
  rel: Relatorio,
  analise: Analise,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const logo = await carregarLogo();

  const ctx: Ctx = {
    doc,
    y: MARGEM,
    pagina: 1,
    logo,
    titulo: 'Planejamento mensal',
    subtitulo: mesExtenso(data.mes),
  };

  // ── Capa ───────────────────────────────────────────────────────────────
  if (logo) {
    const h = 9;
    const w = (logo.w / logo.h) * h;
    doc.addImage(logo.data, 'PNG', MARGEM, ctx.y, w, h);
    ctx.y += h + 10;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...COR.azul);
    doc.text('enturOS FIN', MARGEM, ctx.y + 6);
    ctx.y += 16;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(...COR.tinta);
  doc.text('Planejamento mensal', MARGEM, ctx.y);
  ctx.y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...COR.tinta2);
  doc.text(mesExtenso(data.mes), MARGEM, ctx.y);
  ctx.y += 5;

  doc.setFontSize(8);
  doc.setTextColor(...COR.tinta3);
  doc.text(
    `Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    MARGEM, ctx.y,
  );
  ctx.y += 4;
  doc.setDrawColor(...COR.tinta);
  doc.setLineWidth(0.5);
  doc.line(MARGEM, ctx.y, PAG_L - MARGEM, ctx.y);
  ctx.y += 10;

  // ── O que o plano exige ────────────────────────────────────────────────
  if (rel.premissasIncompletas) {
    tituloSecao(ctx, 'Plano incompleto');
    paragrafo(ctx, 'Ticket médio e margem de comissão precisam estar preenchidos para o cálculo das metas.');
  } else if (rel.lucroPorVenda <= 0) {
    tituloSecao(ctx, 'O plano não fecha');
    paragrafo(ctx, analise.veredito);
  } else {
    tituloSecao(ctx, `Para lucrar ${brl(data.lucro_desejado)} no mês`);
    cardsDestaque(ctx, [
      { valor: String(rel.vendasMeta), rotulo: 'vendas fechadas', nota: `${dec(rel.vendasPorDia)} por dia útil` },
      { valor: brl(rel.faturamentoMeta), rotulo: 'em volume vendido', nota: `${brl(rel.faturamentoDiario)} por dia`, cor: COR.azul },
      { valor: String(rel.atendimentosMeta), rotulo: 'leads atendidos', nota: `${rel.atendimentosPorDia} por dia` },
    ]);
    cardsDestaque(ctx, [
      { valor: brl(rel.receitaMeta), rotulo: 'receita de comissões', nota: 'o que entra na agência', cor: COR.verde },
      { valor: brl(rel.lucroProjetado), rotulo: 'lucro projetado', nota: `margem de ${dec(rel.margemSobreReceitaPct)}%`, cor: COR.verde },
      { valor: String(rel.vendasBreakEven), rotulo: 'vendas para empatar', nota: `${brl(rel.custoFixoMaisMarketing)} de custo` },
    ]);
  }

  // ── Premissas ──────────────────────────────────────────────────────────
  tituloSecao(ctx, 'Premissas do plano');
  linhaValor(ctx, 'Ticket médio da venda', brl(data.ticket_medio));
  linhaValor(ctx, 'Margem de comissão', `${dec(data.margem_comissao)}%`);
  linhaValor(ctx, 'Comissão por venda', brl(rel.comissaoPorVenda), { forte: true });
  linhaValor(ctx, 'Taxa de conversão de leads', `${dec(data.taxa_conversao)}%`);
  linhaValor(ctx, 'Lucro desejado no mês', brl(data.lucro_desejado));
  linhaValor(ctx, 'Dias úteis', String(data.dias_uteis));
  linhaValor(ctx, 'Vendedores ativos', String(data.vendedores_ativos));
  ctx.y += 3;

  // ── Custos fixos ───────────────────────────────────────────────────────
  tituloSecao(ctx, 'Custos fixos mensais');
  tabela(
    ctx,
    [
      { titulo: 'Categoria', largura: 70 },
      { titulo: 'Valor', largura: 34, alinhar: 'right' },
      { titulo: '% do fixo', largura: 24, alinhar: 'right' },
      { titulo: 'Observação', largura: CONTEUDO_L - 128 },
    ],
    data.custos_fixos.map(c => [
      c.categoria,
      brl(c.valor),
      rel.custoFixoTotal > 0 ? `${Math.round((c.valor / rel.custoFixoTotal) * 100)}%` : '—',
      c.observacao || '',
    ]),
    { rotulo: 'Total fixo', valor: brl(rel.custoFixoTotal) },
  );

  // ── Custos variáveis ───────────────────────────────────────────────────
  tituloSecao(ctx, 'Custos variáveis por venda');
  tabela(
    ctx,
    [
      { titulo: 'Item', largura: 66 },
      { titulo: '%', largura: 22, alinhar: 'right' },
      { titulo: 'Base de cálculo', largura: 48 },
      { titulo: 'Por venda', largura: CONTEUDO_L - 136, alinhar: 'right' },
    ],
    data.custos_variaveis.map(c => [
      c.nome,
      `${dec(c.percentual)}%`,
      c.base === 'COMISSAO' ? 'sobre a comissão' : 'sobre a venda',
      brl((c.base === 'COMISSAO' ? rel.comissaoPorVenda : data.ticket_medio) * (c.percentual || 0) / 100),
    ]),
    { rotulo: 'Total variável por venda', valor: brl(rel.custoVarPorVenda) },
  );
  linhaValor(ctx, 'Sobra por venda (comissão menos custos)', brl(rel.lucroPorVenda), {
    forte: true,
    cor: rel.lucroPorVenda > 0 ? COR.verde : COR.vermelho,
  });
  linhaValor(ctx, 'Margem de contribuição', `${dec(rel.margemContribuicaoPct)}%`);
  ctx.y += 3;

  // ── Marketing ──────────────────────────────────────────────────────────
  tituloSecao(ctx, 'Investimento em marketing');
  tabela(
    ctx,
    [
      { titulo: 'Canal', largura: 90 },
      { titulo: 'Investimento', largura: 44, alinhar: 'right' },
      { titulo: 'Participação', largura: CONTEUDO_L - 134, alinhar: 'right' },
    ],
    data.marketing.map(c => [
      c.canal,
      brl(c.valor),
      rel.marketingTotal > 0 ? `${Math.round((c.valor / rel.marketingTotal) * 100)}%` : '—',
    ]),
    { rotulo: 'Total marketing', valor: brl(rel.marketingTotal) },
  );

  // ── Economia de aquisição ──────────────────────────────────────────────
  tituloSecao(ctx, 'Economia de aquisição');
  linhaValor(ctx, 'Leads necessários no mês', String(rel.atendimentosMeta));
  linhaValor(ctx, 'Custo atual por lead', rel.cplAtual > 0 ? brl(rel.cplAtual) : '—');
  linhaValor(ctx, 'Teto que a margem suporta', brl(rel.cplTeto), { forte: true });
  linhaValor(ctx, 'Capacidade de aquisição usada', rel.usoDoTetoPct > 0 ? `${Math.round(rel.usoDoTetoPct)}%` : '—');
  linhaValor(ctx, 'Comissão por real investido', rel.retornoMarketing > 0 ? `${dec(rel.retornoMarketing)}x` : '—');
  ctx.y += 3;

  // ── Análise ────────────────────────────────────────────────────────────
  // Título da análise + veredito + primeiro apontamento entram juntos.
  doc.setFontSize(9.5);
  const linhasVeredito: string[] = doc.splitTextToSize(analise.veredito, CONTEUDO_L);
  const alturaAbertura = 16 + linhasVeredito.length * 4.3
    + (analise.riscos[0] ? alturaApontamento(doc, analise.riscos[0]) + 6 : 0);
  reservar(ctx, alturaAbertura);
  tituloSecao(ctx, 'Análise do plano');
  paragrafo(ctx, analise.veredito, { tamanho: 9.5, cor: COR.tinta });
  ctx.y += 2;

  if (analise.riscos.length > 0) {
    subtitulo(ctx, 'Pontos de atenção', alturaApontamento(doc, analise.riscos[0]));
    analise.riscos.forEach(r => apontamento(ctx, r));
  }

  if (analise.forcas.length > 0) {
    subtitulo(ctx, 'O que está a favor', alturaApontamento(doc, analise.forcas[0]));
    analise.forcas.forEach(f => apontamento(ctx, f));
  }

  if (analise.recomendacoes.length > 0) {
    doc.setFontSize(8.5);
    const primeira: string[] = doc.splitTextToSize(analise.recomendacoes[0], CONTEUDO_L - 8);
    subtitulo(ctx, 'Próximos passos', primeira.length * 4 + 3);
    analise.recomendacoes.forEach((r, i) => {
      const linhas: string[] = doc.splitTextToSize(r, CONTEUDO_L - 8);
      reservar(ctx, linhas.length * 4 + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...COR.azul);
      doc.text(`${i + 1}.`, MARGEM, ctx.y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COR.tinta2);
      linhas.forEach(l => {
        doc.text(l, MARGEM + 6, ctx.y);
        ctx.y += 4;
      });
      ctx.y += 2;
    });
  }

  // Nota de método — deixa explícito de onde vêm os números.
  reservar(ctx, 18);
  ctx.y += 2;
  doc.setDrawColor(...COR.linha);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, ctx.y, PAG_L - MARGEM, ctx.y);
  ctx.y += 5;
  paragrafo(
    ctx,
    'Como ler estes números: a agência opera por intermediação, então o volume vendido é o que passa pela ' +
    'operação e a receita é apenas a comissão. Margem e retorno de marketing são calculados sobre a receita ' +
    'de comissões. O teto de custo por lead é a sobra por venda multiplicada pela taxa de conversão — acima ' +
    'dele, cada cliente conquistado custa mais do que deixa.',
    { tamanho: 7.5, cor: COR.tinta3 },
  );

  rodape(ctx);

  const nome = `planejamento-${data.mes}.pdf`;
  doc.save(nome);
}
