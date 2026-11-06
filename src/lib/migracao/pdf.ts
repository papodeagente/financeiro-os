/**
 * Mudança de sistema (E4, 05/11/2026): o PDF "Prova da mudança", para o
 * contador. Gerado no servidor com o jsPDF que o projeto já usa
 * (planejamento-pdf.ts). Só texto e tabelas, fonte padrão (Latin-1 cobre os
 * acentos do português).
 */
import type { ProvaDaMudanca, LinhaDaProva } from './provas';
import { dataBR } from './valores';

type Doc = import('jspdf').jsPDF;

const MARGEM = 14;
const LARGURA = 210;
const ALTURA = 297;
const COR = { tinta: [24, 24, 27] as const, tinta2: [82, 82, 91] as const, tinta3: [140, 140, 150] as const, linha: [222, 222, 228] as const, alerta: [180, 40, 40] as const };

function brl(centavos: number | null | undefined): string {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface Ctx { doc: Doc; y: number; pagina: number; titulo: string }

function rodape(ctx: Ctx) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR.tinta3);
  doc.text(`${ctx.titulo} · página ${ctx.pagina}`, MARGEM, ALTURA - 8);
}

function garantir(ctx: Ctx, altura: number) {
  if (ctx.y + altura <= ALTURA - 16) return;
  rodape(ctx);
  ctx.doc.addPage();
  ctx.pagina += 1;
  ctx.y = MARGEM + 4;
}

function secao(ctx: Ctx, texto: string, sub?: string) {
  garantir(ctx, 18);
  ctx.y += 4;
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(12);
  ctx.doc.setTextColor(...COR.tinta);
  ctx.doc.text(texto, MARGEM, ctx.y);
  ctx.y += 5;
  if (sub) {
    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.setFontSize(8.5);
    ctx.doc.setTextColor(...COR.tinta2);
    for (const l of ctx.doc.splitTextToSize(sub, LARGURA - 2 * MARGEM) as string[]) { ctx.doc.text(l, MARGEM, ctx.y); ctx.y += 4; }
  }
  ctx.y += 1;
}

/** Tabela simples: primeira coluna texto, as outras valores à direita. */
function tabela(ctx: Ctx, cabecalho: string[], larguras: number[], linhas: Array<{ celulas: string[]; notas?: string[]; alerta?: boolean }>) {
  const { doc } = ctx;
  const xs: number[] = [];
  let x = MARGEM;
  for (const w of larguras) { xs.push(x); x += w; }
  const cab = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR.tinta2);
    cabecalho.forEach((c, i) => doc.text(c, i === 0 ? xs[i] : xs[i] + larguras[i] - 1, ctx.y, { align: i === 0 ? 'left' : 'right' }));
    ctx.y += 1.5;
    doc.setDrawColor(...COR.linha);
    doc.line(MARGEM, ctx.y, LARGURA - MARGEM, ctx.y);
    ctx.y += 3.5;
  };
  garantir(ctx, 12);
  cab();
  for (const l of linhas) {
    const primeira = doc.splitTextToSize(l.celulas[0] ?? '', larguras[0] - 2) as string[];
    const notas = (l.notas ?? []).flatMap(n => doc.splitTextToSize(`• ${n}`, LARGURA - 2 * MARGEM - 6) as string[]);
    const h = primeira.length * 3.8 + notas.length * 3.4 + 1.5;
    if (ctx.y + h > ALTURA - 16) { garantir(ctx, h + 12); cab(); }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const cor = l.alerta ? COR.alerta : COR.tinta;
    doc.setTextColor(cor[0], cor[1], cor[2]);
    primeira.forEach((t, i) => doc.text(t, xs[0], ctx.y + i * 3.8));
    for (let i = 1; i < l.celulas.length; i++) doc.text(l.celulas[i] ?? '', xs[i] + larguras[i] - 1, ctx.y, { align: 'right' });
    ctx.y += primeira.length * 3.8;
    if (notas.length) {
      doc.setFontSize(7.5);
      doc.setTextColor(...COR.tinta2);
      for (const n of notas) { doc.text(n, MARGEM + 4, ctx.y); ctx.y += 3.4; }
    }
    ctx.y += 1.5;
  }
}

function notasDe(l: LinhaDaProva): string[] {
  return l.explicacoes.map(e => `${e.motivo}: ${e.quantidade} linha(s), ${brl(e.centavos)}`);
}

/** Gera o PDF e devolve os bytes. */
export async function pdfDaProva(p: ProvaDaMudanca, agencia: string): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const ctx: Ctx = { doc, y: MARGEM + 4, pagina: 1, titulo: `Prova da mudança · ${agencia || 'agência'}` };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COR.tinta);
  doc.text('Prova da mudança', MARGEM, ctx.y + 4);
  ctx.y += 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COR.tinta2);
  doc.text(`${agencia ? `${agencia} · ` : ''}dados trazidos do sistema anterior para o EnturOS Financeiro`, MARGEM, ctx.y);
  ctx.y += 5;
  doc.setFontSize(8.5);
  const gerada = p.gerada_em ? new Date(p.gerada_em) : new Date();
  doc.text(
    `Data de corte: ${p.data_corte ? dataBR(p.data_corte) : 'não informada'} · Gerada em ${gerada.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${gerada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`,
    MARGEM, ctx.y,
  );
  ctx.y += 4;
  doc.setDrawColor(...COR.tinta);
  doc.setLineWidth(0.4);
  doc.line(MARGEM, ctx.y, LARGURA - MARGEM, ctx.y);
  ctx.y += 6;

  const criados = Object.values(p.resumo.criados).reduce((s, n) => s + n, 0);
  secao(ctx, 'Resumo',
    `${criados} registro(s) criado(s), ${p.resumo.vinculados} ligado(s) a cadastros que já existiam, ${p.resumo.recusados} linha(s) recusada(s) com motivo e ${p.resumo.ignorados} ignorada(s) (totais do rodapé, agrupamentos). `
    + (p.diferencas_sem_explicacao ? `ATENÇÃO: ${p.diferencas_sem_explicacao} diferença(s) sem motivo conhecido.` : 'Toda diferença abaixo tem o motivo ao lado.'));

  if (p.contas.length) {
    secao(ctx, 'Saldo de cada conta na data de corte', 'Sistema anterior × EnturOS (e o razão financeiro, quando já aberto).');
    tabela(ctx, ['Conta', 'Sistema anterior', 'EnturOS', 'Razão', 'Diferença'], [70, 30, 30, 26, 26],
      p.contas.map(c => ({
        celulas: [c.rotulo, brl(c.anterior_centavos), brl(c.enturos_centavos), brl(c.razao_centavos), brl(c.diferenca_centavos)],
        notas: notasDe(c), alerta: !c.explicada,
      })));
  }
  for (const [mov, titulo] of [['receber', 'A receber em aberto, por cliente'], ['pagar', 'A pagar em aberto, por fornecedor']] as const) {
    const linhas = p.pessoas[mov];
    if (!linhas.length) continue;
    const ant = linhas.reduce((s, l) => s + l.anterior_centavos, 0);
    const ent = linhas.reduce((s, l) => s + l.enturos_centavos, 0);
    secao(ctx, titulo, `Total: sistema anterior ${brl(ant)} · EnturOS ${brl(ent)} · diferença ${brl(ant - ent)}.`);
    tabela(ctx, ['Pessoa', 'Sistema anterior', 'EnturOS', 'Diferença'], [96, 30, 30, 26],
      linhas.map(l => ({ celulas: [l.rotulo, brl(l.anterior_centavos), brl(l.enturos_centavos), brl(l.diferenca_centavos)], notas: notasDe(l), alerta: !l.explicada })));
  }
  if (p.meses.length) {
    secao(ctx, 'Títulos trazidos por mês de vencimento e categoria');
    tabela(ctx, ['Mês e categoria', 'Sistema anterior', 'EnturOS', 'Diferença'], [96, 30, 30, 26],
      p.meses.map(m => ({ celulas: [m.rotulo, brl(m.anterior_centavos), brl(m.enturos_centavos), brl(m.diferenca_centavos)], notas: notasDe(m), alerta: !m.explicada })));
  }
  if (p.arquivos.some(a => a.total_rodape_centavos !== null)) {
    secao(ctx, 'Arquivos: soma das linhas × total do rodapé');
    tabela(ctx, ['Arquivo', 'Linhas', 'Soma', 'Rodapé', 'Confere'], [80, 18, 32, 32, 20],
      p.arquivos.map(a => ({
        celulas: [a.nome, String(a.linhas), brl(a.soma_centavos), brl(a.total_rodape_centavos), a.confere === null ? '—' : a.confere ? 'sim' : 'não'],
        alerta: a.confere === false,
      })));
  }
  if (p.fora.length) {
    secao(ctx, 'Linhas que ficaram fora da conta', 'Não estavam em aberto (já liquidadas ou excluídas) ou não deu para ler.');
    tabela(ctx, ['Motivo', 'Linhas'], [150, 32], p.fora.map(f => ({ celulas: [f.rotulo, String(f.quantidade)] })));
  }
  rodape(ctx);
  return new Uint8Array(doc.output('arraybuffer'));
}
