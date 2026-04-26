'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Proposta, SecaoProposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { FileDown, Check, X, AlertCircle, Loader2, RotateCcw } from 'lucide-react';

// Preview components — Classic
import { CapaSection } from './preview/CapaSection';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { RodapeSection } from './preview/RodapeSection';

// Preview components — Discovery
import { AccommodationSummary } from './preview/discovery/AccommodationSummary';
import { TransportSummary } from './preview/discovery/TransportSummary';
import { DestinationBlock } from './preview/discovery/DestinationBlock';
import { groupDaysByDestination } from '@/lib/discovery-utils';

const EXCLUDED_TIPOS = new Set(['VIDEO', 'MAPA', 'COUNTDOWN', 'CTA']);

// ====================================================================
// PDF capture with smart section-aware pagination
// --------------------------------------------------------------------
// Renders the full proposta into a single canvas and slices it into
// A4 pages — but the slice points are aligned to the nearest
// `[data-pdf-section]` or `[data-pdf-break]` boundary so content never
// gets cut mid-card or mid-paragraph.
// ====================================================================

const SCALE = 2;
const CSS_WIDTH = 794;            // A4 width @ 96dpi ≈ 794 CSS px
const A4_RATIO = 297 / 210;       // height/width ratio
const PAGE_CSS_HEIGHT = CSS_WIDTH * A4_RATIO; // ≈ 1123.4 px
const PDF_WIDTH_MM = 210;
const MIN_PAGE_PROGRESS = 120;    // never produce pages shorter than this (px)

async function captureAndSavePdf(container: HTMLElement, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);

  // Force-open every <details> so collapsed inclusos/FAQ render expanded.
  container.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));

  // Two animation frames so layout reflects the open state.
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  await new Promise<void>(r => requestAnimationFrame(() => r()));

  const canvas = await html2canvas(container, {
    scale: SCALE,
    useCORS: true,
    logging: false,
    width: CSS_WIDTH,
    windowWidth: CSS_WIDTH,
    backgroundColor: '#ffffff',
  });

  const totalCss = canvas.height / SCALE;

  // Collect break candidates: top AND bottom edge of each section/break element.
  // Using both ends lets a page end at a section's bottom even when the next
  // section starts past the page boundary — avoids huge whitespace tails.
  const containerRect = container.getBoundingClientRect();
  const candidates = new Set<number>([0]);
  container.querySelectorAll('[data-pdf-section], [data-pdf-break]').forEach(el => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const top = r.top - containerRect.top;
    const bottom = r.bottom - containerRect.top;
    if (top > 0 && top < totalCss) candidates.add(Math.round(top));
    if (bottom > 0 && bottom < totalCss) candidates.add(Math.round(bottom));
  });
  candidates.add(totalCss);
  const breakpoints = Array.from(candidates).sort((a, b) => a - b);

  // Greedy: each page takes the largest breakpoint ≤ cursor + PAGE_CSS_HEIGHT.
  const pages: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < totalCss - 1) {
    const maxEnd = cursor + PAGE_CSS_HEIGHT;
    if (maxEnd >= totalCss) {
      pages.push({ start: cursor, end: totalCss });
      break;
    }
    let chosen = -1;
    for (const bp of breakpoints) {
      if (bp > cursor + MIN_PAGE_PROGRESS && bp <= maxEnd && bp > chosen) chosen = bp;
    }
    if (chosen === -1) chosen = maxEnd; // hard cut fallback for sections taller than a page
    pages.push({ start: cursor, end: chosen });
    cursor = chosen;
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  for (let i = 0; i < pages.length; i++) {
    const { start, end } = pages[i];
    const sliceHeightCss = end - start;
    const sliceHeightPx = Math.round(sliceHeightCss * SCALE);

    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceHeightPx;
    const ctx = slice.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0, Math.round(start * SCALE),
      canvas.width, sliceHeightPx,
      0, 0,
      canvas.width, sliceHeightPx,
    );

    const sliceHeightMm = (sliceHeightCss / CSS_WIDTH) * PDF_WIDTH_MM;
    const data = slice.toDataURL('image/jpeg', 0.94);

    if (i > 0) pdf.addPage();
    pdf.addImage(data, 'JPEG', 0, 0, PDF_WIDTH_MM, sliceHeightMm);
  }

  pdf.save(filename);
}

type PdfStep = 'rendering' | 'images' | 'generating' | 'done';

const STEP_CONFIG: { key: PdfStep; label: string }[] = [
  { key: 'rendering', label: 'Montando proposta...' },
  { key: 'images', label: 'Carregando imagens...' },
  { key: 'generating', label: 'Gerando PDF...' },
  { key: 'done', label: 'PDF gerado com sucesso!' },
];

function stepIndex(step: PdfStep): number {
  return STEP_CONFIG.findIndex(s => s.key === step);
}

interface Props {
  proposta: Proposta;
  open: boolean;
  onClose: () => void;
}

// ---------- Image loading utility ----------

function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  if (images.length === 0) return Promise.resolve();

  const promises = images.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 10000);
      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); resolve(); };
    });
  });

  return Promise.allSettled(promises).then(() => {});
}

// ====================================================================
// Helpers + PDF-specific Discovery components
// ====================================================================

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 74, b: 173 };
}

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function isPixOrCash(forma: string): boolean {
  const f = (forma || '').toLowerCase();
  return f.includes('pix') || f.includes('vista');
}

interface ValorOpcao {
  titulo: string;
  valor_total: number;
  destaque: boolean;
  parcelas: { forma: string; valor_parcela: number; valor_total: number; destaque: boolean }[];
}
function bestParcela(o: ValorOpcao) {
  if (!o.parcelas?.length) return null;
  return o.parcelas.find(p => isPixOrCash(p.forma)) || o.parcelas[0];
}
function calcEconomia(o: ValorOpcao): number {
  const p = o.parcelas?.find(x => isPixOrCash(x.forma));
  if (!p) return 0;
  return Math.max(o.valor_total - (p.valor_total || p.valor_parcela), 0);
}

// ---------- PDF Discovery Hero (no absolute CTAs, no animations) ----------

function smartTitulo(proposta: Proposta): string {
  const t = proposta.cabecalho.titulo?.trim();
  // Discard generic placeholders — derive from destinos.
  const generic = !t || /^proposta( de viagem)?$/i.test(t);
  if (!generic) return t!;
  const destinos = proposta.viagem?.destinos?.map(d => d.nome).filter(Boolean) || [];
  if (destinos.length === 0) return 'Sua próxima viagem';
  if (destinos.length === 1) return destinos[0];
  if (destinos.length === 2) return `${destinos[0]} & ${destinos[1]}`;
  return `${destinos[0]}, ${destinos[1]} & ${destinos[destinos.length - 1]}`;
}

function PdfDiscoveryHero({ proposta }: { proposta: Proposta }) {
  const img = proposta.visual.imagem_capa;
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const viagem = proposta.viagem;
  const logo = proposta.visual.logo_agencia;
  const { r, g, b } = hexToRgb(corPrimaria);

  const destinos = viagem?.destinos?.map(d => d.nome).filter(Boolean) || [];
  const subtitulo = proposta.cabecalho.subtitulo;
  const titulo = smartTitulo(proposta);

  // Build a numeric stats row — premium, scannable, no plastic chips.
  const stats: { label: string; value: string }[] = [];
  if (viagem?.duracao_dias) stats.push({ label: 'Dias', value: String(viagem.duracao_dias) });
  if (viagem?.duracao_noites) stats.push({ label: 'Noites', value: String(viagem.duracao_noites) });
  if (destinos.length > 0) stats.push({ label: 'Destinos', value: String(destinos.length) });

  return (
    <div
      data-pdf-section
      style={{
        position: 'relative',
        width: '100%',
        height: 360,
        overflow: 'hidden',
        backgroundColor: corPrimaria,
      }}
    >
      {img && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${img})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.85) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.45,
          background: `linear-gradient(135deg, rgba(${r},${g},${b},0.7) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)`,
          mixBlendMode: 'multiply',
        }}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          color: '#ffffff',
          padding: '0 40px',
        }}
      >
        {proposta.cliente_nome && (
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.45em', color: 'rgba(255,255,255,0.75)', marginBottom: 14, fontWeight: 500 }}>
            ✦ Exclusivamente para {proposta.cliente_nome} ✦
          </p>
        )}
        {subtitulo && (
          <p style={{ fontSize: 15, fontStyle: 'italic', fontWeight: 300, color: 'rgba(255,255,255,0.88)', marginBottom: 14, maxWidth: 560, lineHeight: 1.4 }}>
            {subtitulo}
          </p>
        )}
        <h1 style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.025em', marginBottom: 18, maxWidth: 700 }}>
          {titulo}
        </h1>
        {/* Decorative divider */}
        <div style={{
          width: 64,
          height: 1,
          background: 'rgba(255,255,255,0.4)',
          marginBottom: 18,
        }} />
        {/* Stats row — refined, not plastic chips */}
        {stats.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            color: '#ffffff',
          }}>
            {stats.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                {i > 0 && <span style={{ width: 4, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.4)' }} />}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{s.value}</div>
                  <div style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.25em', opacity: 0.7, marginTop: 4 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Destinos route line */}
        {destinos.length > 0 && (
          <div style={{
            marginTop: 18,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)',
          }}>
            {destinos.join('  ·  ')}
          </div>
        )}
      </div>
      {logo && (
        <img
          src={logo}
          alt=""
          style={{ position: 'absolute', bottom: 18, right: 18, height: 36, opacity: 0.9 }}
        />
      )}
    </div>
  );
}

// ---------- PDF Discovery Pricing ----------

// Format validade as urgency text + days remaining.
function formatValidade(validade: string): { label: string; days: number; tone: 'calm' | 'warn' | 'hot' } | null {
  if (!validade) return null;
  try {
    const d = new Date(validade + (validade.length === 10 ? 'T23:59:59' : ''));
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const days = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 0);
    const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
    let tone: 'calm' | 'warn' | 'hot' = 'calm';
    if (days <= 7) tone = 'hot';
    else if (days <= 30) tone = 'warn';
    const label = days === 0
      ? `Última oportunidade — expira hoje`
      : days === 1
        ? `Última chance — apenas 1 dia restante`
        : days <= 7
          ? `Apenas ${days} dias restantes — encerra ${dateStr}`
          : days <= 30
            ? `${days} dias para reservar — válida até ${dateStr}`
            : `Reserva válida até ${dateStr}`;
    return { label, days, tone };
  } catch {
    return null;
  }
}

function PdfDiscoveryPricing({
  valoresSecoes,
  inclusosSecoes,
  idioma,
  corPrimaria,
  proposta,
}: {
  valoresSecoes: SecaoProposta[];
  inclusosSecoes: SecaoProposta[];
  idioma: IdiomaProposal;
  corPrimaria: string;
  proposta: Proposta;
}) {
  const i18n = t(idioma);

  const opcoes: ValorOpcao[] = [];
  let observacoes = '';
  let validade = '';
  for (const s of valoresSecoes) {
    const c = s.conteudo as { opcoes?: ValorOpcao[]; observacoes_valores?: string; validade?: string };
    if (c.opcoes) opcoes.push(...c.opcoes);
    if (c.observacoes_valores) observacoes = c.observacoes_valores;
    if (c.validade) validade = c.validade;
  }
  let inclusos: string[] = [];
  for (const s of inclusosSecoes) {
    const c = s.conteudo as { inclusos?: string[] };
    if (c.inclusos) inclusos = inclusos.concat(c.inclusos.filter(Boolean));
  }

  if (opcoes.length === 0 && inclusos.length === 0) return null;

  const validInfo = formatValidade(validade);
  const validToneStyle = validInfo
    ? validInfo.tone === 'hot'
      ? { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' }
      : validInfo.tone === 'warn'
        ? { bg: '#fffbeb', border: '#fde68a', color: '#b45309' }
        : { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' }
    : null;

  // Trust strip — derive from viagem and inclusos. Pure visual, scannable
  // shorthand of what's in the package. Helps justify the ticket size.
  const viagem = proposta.viagem;
  const trustItems: { icon: string; label: string }[] = [];
  if (viagem?.transportes?.some(t => t.tipo === 'VOO')) trustItems.push({ icon: '✈', label: 'Aéreo internacional' });
  if (viagem?.alojamentos && viagem.alojamentos.length > 0) {
    const hasFiveStar = viagem.alojamentos.some(a => (a.hotel_estrelas || 0) >= 5);
    trustItems.push({ icon: '★', label: hasFiveStar ? 'Hotéis selecionados 5★' : 'Hotéis selecionados' });
  }
  if (viagem?.transportes?.some(t => ['TREM', 'TRANSFER', 'CARRO', 'ONIBUS'].includes(t.tipo))) {
    trustItems.push({ icon: '⇄', label: 'Translados e transfers' });
  }
  if (viagem?.alojamentos?.some(a => a.regime && a.regime !== 'RO')) {
    trustItems.push({ icon: '◉', label: 'Refeições inclusas' });
  }
  if (inclusos.some(i => /seguro/i.test(i))) trustItems.push({ icon: '⛨', label: 'Seguro viagem' });
  if (inclusos.some(i => /suporte|24h|whats/i.test(i))) trustItems.push({ icon: '⌬', label: 'Suporte dedicado' });

  const gridCols = opcoes.length >= 3 ? 'grid-cols-3' : opcoes.length === 2 ? 'grid-cols-2' : 'max-w-md mx-auto';

  return (
    <section
      data-pdf-section
      className="py-10"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${corPrimaria}05 100%)` }}
    >
      <div className="max-w-5xl mx-auto px-8">
        <div className="text-center mb-3">
          <span
            className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase"
            style={{ backgroundColor: `${corPrimaria}15`, color: corPrimaria }}
          >
            {i18n.precos}
          </span>
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center">Seu investimento</h2>

        {validInfo && validToneStyle && (
          <div className="flex justify-center mb-8">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: validToneStyle.bg,
                border: `1px solid ${validToneStyle.border}`,
                color: validToneStyle.color,
              }}
            >
              <span style={{ fontSize: 13 }}>⏱</span>
              <span>{validInfo.label}</span>
            </div>
          </div>
        )}

        {opcoes.length > 0 && (
          <div className={`grid gap-5 ${gridCols} pt-3`}>
            {opcoes.map((op, i) => {
              const best = bestParcela(op);
              const economia = calcEconomia(op);
              const bestValor = best ? (best.valor_total || best.valor_parcela) : op.valor_total;
              return (
                <div
                  key={i}
                  className="relative rounded-2xl p-5 bg-white flex flex-col"
                  style={{
                    border: op.destaque ? `2px solid ${corPrimaria}` : '1px solid #e5e7eb',
                    boxShadow: op.destaque
                      ? `0 10px 28px -12px ${corPrimaria}55`
                      : '0 4px 12px -4px rgba(0,0,0,0.06)',
                  }}
                >
                  {op.destaque && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest text-white whitespace-nowrap"
                      style={{ backgroundColor: corPrimaria }}
                    >
                      ★ MAIS ESCOLHIDO
                    </div>
                  )}
                  <h3 className="text-sm font-semibold text-gray-700 text-center mt-2 min-h-[2.5rem] flex items-center justify-center">
                    {op.titulo}
                  </h3>
                  {economia > 0 && (
                    <div className="text-center mt-1">
                      <span className="text-xs text-gray-400 line-through">{formatCurrency(op.valor_total)}</span>
                    </div>
                  )}
                  <div className="text-center mt-1">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-xs text-gray-500 font-medium">R$</span>
                      <span className="text-4xl font-extrabold tracking-tight" style={{ color: corPrimaria }}>
                        {formatBRL(bestValor)}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {best && isPixOrCash(best.forma) ? 'à vista no PIX' : 'preço total'}
                    </div>
                  </div>
                  {economia > 0 && (
                    <div className="mt-2 flex justify-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200">
                        Economize {formatCurrency(economia)}
                      </span>
                    </div>
                  )}
                  {op.parcelas && op.parcelas.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-1">
                      <div className="text-[9px] font-bold tracking-widest uppercase text-gray-400 text-center mb-1.5">
                        Outras formas
                      </div>
                      {op.parcelas.filter(p => !isPixOrCash(p.forma)).map((parc, j) => (
                        <div key={j} className="flex items-baseline justify-between text-xs">
                          <span className="text-gray-600">{parc.forma}</span>
                          <span className="font-semibold text-gray-800 tabular-nums">
                            {formatCurrency(parc.valor_parcela)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {observacoes && (
          <p className="mt-6 text-center text-xs text-gray-500 italic max-w-2xl mx-auto">{observacoes}</p>
        )}

        {/* Trust strip — what every pacote includes */}
        {trustItems.length > 0 && (
          <div data-pdf-break className="mt-10 pt-8 border-t border-gray-200">
            <div className="text-center mb-5">
              <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
                Tudo isso está incluso no seu investimento
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {trustItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: `${corPrimaria}08` }}
                >
                  <span
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold shrink-0"
                    style={{ backgroundColor: corPrimaria, color: '#fff' }}
                  >
                    {item.icon}
                  </span>
                  <span className="text-xs font-medium text-gray-700 leading-tight">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full inclusos list — readable, single column on PDF, no não-inclusos here */}
        {inclusos.length > 0 && (
          <div data-pdf-break className="mt-10 pt-8 border-t border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-5 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs">
                ✓
              </span>
              {i18n.oQueEstaIncluso}
            </h3>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {inclusos.map((item, i) => (
                <li key={i} {...(i > 0 ? { 'data-pdf-break': true } : {})} className="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                  <span className="mt-1 text-emerald-500 shrink-0">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- PDF Intro (compact, no duplicated stats) ----------

function PdfIntro({ proposta, idioma }: { proposta: Proposta; idioma: IdiomaProposal }) {
  const i18n = t(idioma);
  const viagem = proposta.viagem;
  const mensagem = proposta.cabecalho.mensagem_abertura;
  const tags = viagem?.interesses_tags || [];
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';

  if (!mensagem && tags.length === 0) return null;

  return (
    <section data-pdf-section className="py-10 bg-white">
      <div className="max-w-3xl mx-auto px-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">{i18n.introducao}</h2>
        {mensagem && (
          <p className="text-gray-600 text-base leading-relaxed whitespace-pre-line">
            {mensagem}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-1.5">
            {tags.map((tag, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  backgroundColor: `${corPrimaria}15`,
                  color: corPrimaria,
                  border: `1px solid ${corPrimaria}25`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- PDF Footer (close the deal) ----------

function PdfFooter({
  proposta,
  inclusosSecoes,
  idioma,
}: {
  proposta: Proposta;
  inclusosSecoes: SecaoProposta[];
  idioma: IdiomaProposal;
}) {
  const i18n = t(idioma);
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const rodape = proposta.rodape;
  const viagem = proposta.viagem;
  const sobre = viagem?.sobre_agencia || '';

  // Não inclusos — moved here, post-decision
  const naoInclusos: string[] = [];
  for (const s of inclusosSecoes) {
    const c = s.conteudo as { nao_inclusos?: string[] };
    if (c.nao_inclusos) naoInclusos.push(...c.nao_inclusos.filter(Boolean));
  }

  // Try to extract trust metrics from sobre_agencia
  const metrics: string[] = [];
  const yearMatch = sobre.match(/(\d+)\s*anos/i);
  if (yearMatch) metrics.push(`${yearMatch[1]} anos de mercado`);
  const tripsMatch = sobre.match(/(\d[\d.]*)\s*\+?\s*(viagens|viajantes|passageiros|fam[ií]lias|cabines)/i);
  if (tripsMatch) metrics.push(`${tripsMatch[1]}+ ${tripsMatch[2].toLowerCase()}`);
  const partnerMatch = sobre.match(/(parceria|oficial|representante|exclusiv[oa])/i);
  if (partnerMatch) metrics.push('Parcerias oficiais');

  const validInfo = formatValidade(proposta.cabecalho.validade);
  const whatsapp = (rodape.whatsapp_vendedor || rodape.telefone_vendedor || '').replace(/\D/g, '');
  const tituloViagem = smartTitulo(proposta);
  const initials = (rodape.nome_vendedor || '').split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '✦';

  return (
    <>
      {/* Não-inclusos — discreet, after the buying decision */}
      {naoInclusos.length > 0 && (
        <section data-pdf-section className="py-10 bg-white">
          <div className="max-w-4xl mx-auto px-8">
            <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px]">
                ×
              </span>
              {i18n.naoIncluso}
            </h3>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {naoInclusos.map((item, i) => (
                <li key={i} {...(i > 0 ? { 'data-pdf-break': true } : {})} className="flex items-start gap-2 text-xs text-gray-500 leading-snug">
                  <span className="mt-0.5 text-gray-400 shrink-0">×</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Próximos passos — 3-step timeline */}
      <section
        data-pdf-section
        className="py-10"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${corPrimaria}06 100%)` }}
      >
        <div className="max-w-4xl mx-auto px-8">
          <div className="text-center mb-8">
            <span
              className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase"
              style={{ backgroundColor: `${corPrimaria}15`, color: corPrimaria }}
            >
              Como funciona
            </span>
            <h3 className="mt-3 text-2xl font-bold text-gray-900">Seus próximos passos</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { n: 1, title: 'Aceite', desc: 'Confirme a proposta pelo WhatsApp ou e-mail. Em até 1 dia útil emitimos o contrato.' },
              { n: 2, title: 'Sinal', desc: 'Pagamento de 30% no PIX para fechar reservas e tarifas. Restante pode ser parcelado.' },
              { n: 3, title: 'Embarque', desc: 'Recebe roteiro digital, voucher de hotéis e suporte 24h durante toda a viagem.' },
            ].map(step => (
              <div
                key={step.n}
                {...(step.n > 1 ? { 'data-pdf-break': true } : {})}
                className="relative rounded-xl p-5 bg-white border border-gray-100"
                style={{ boxShadow: '0 4px 12px -4px rgba(0,0,0,0.06)' }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-base mb-3"
                  style={{ backgroundColor: corPrimaria }}
                >
                  {step.n}
                </div>
                <div className="text-sm font-bold text-gray-900 mb-1">{step.title}</div>
                <p className="text-xs text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vendor card + mega CTA */}
      <section
        data-pdf-section
        className="py-12"
        style={{ background: `linear-gradient(135deg, ${corPrimaria} 0%, ${corPrimaria}dd 100%)` }}
      >
        <div className="max-w-4xl mx-auto px-8 text-white">
          <div className="text-center mb-8">
            <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase bg-white/15 text-white">
              Vamos conversar
            </span>
            <h3 className="mt-3 text-3xl font-bold">{tituloViagem} aguarda você</h3>
            {rodape.mensagem && (
              <p className="mt-4 text-white/85 italic max-w-2xl mx-auto leading-relaxed">{rodape.mensagem}</p>
            )}
          </div>

          {rodape.nome_vendedor && (
            <div
              className="rounded-2xl p-6 max-w-2xl mx-auto"
              style={{ backgroundColor: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)' }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-base shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.20)', border: '2px solid rgba(255,255,255,0.30)' }}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-white/65 mb-1">Seu consultor</div>
                  <div className="text-lg font-bold text-white">{rodape.nome_vendedor}</div>
                  <div className="mt-2 space-y-0.5 text-sm text-white/85">
                    {rodape.email_vendedor && <div>✉ {rodape.email_vendedor}</div>}
                    {rodape.telefone_vendedor && <div>☏ {rodape.telefone_vendedor}</div>}
                    {rodape.whatsapp_vendedor && <div>WhatsApp · {rodape.whatsapp_vendedor}</div>}
                  </div>
                </div>
              </div>

              {whatsapp && (
                <div className="mt-5 pt-5 border-t border-white/15 text-center">
                  <div
                    className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-white text-base font-bold"
                    style={{ color: corPrimaria, boxShadow: '0 8px 20px -8px rgba(0,0,0,0.4)' }}
                  >
                    <span style={{ fontSize: 16 }}>✆</span>
                    <span>Confirmar viagem pelo WhatsApp</span>
                  </div>
                  <div className="mt-2 text-[11px] text-white/70">
                    Resposta em até 1 hora útil · Sem compromisso
                  </div>
                </div>
              )}
            </div>
          )}

          {validInfo && (
            <p className="mt-6 text-center text-xs text-white/75">
              {validInfo.label}
            </p>
          )}
        </div>
      </section>

      {/* Sobre a agência with trust metrics */}
      {sobre && (
        <section data-pdf-section className="py-10 bg-gray-50 border-t border-gray-200">
          <div className="max-w-3xl mx-auto px-8 text-center">
            <h3 className="text-base font-bold text-gray-900 mb-4">{i18n.sobreAgencia}</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line mb-5">{sobre}</p>
            {metrics.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
                {metrics.map((m, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: '#fff', color: corPrimaria, border: `1px solid ${corPrimaria}25` }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Bottom strip with proposal ID and validity */}
      <section data-pdf-section className="py-6 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="text-gray-400">
            {proposta.numero ? `Proposta ${proposta.numero}` : 'Proposta de Viagem'}
            {proposta.cliente_nome && <span className="text-gray-500"> · para {proposta.cliente_nome}</span>}
          </div>
          {validInfo && (
            <div className="text-gray-300 font-medium">
              {i18n.validaAte} {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString('pt-BR')}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ---------- Classic PDF Layout ----------

function PdfClassicLayout({
  proposta,
  secoes,
  idioma,
}: {
  proposta: Proposta;
  secoes: SecaoProposta[];
  idioma: IdiomaProposal;
}) {
  const corFundo = proposta.visual.cor_fundo || '#ffffff';
  const corTexto = proposta.visual.cor_texto || '#1a1a2e';
  const fonte = proposta.visual.fonte || 'Inter';
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const needsPlayfair = fonte === 'Playfair Display';

  return (
    <div style={{ backgroundColor: corFundo, color: corTexto, fontFamily: `'${fonte}', sans-serif` }}>
      {needsPlayfair && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      )}

      <div data-pdf-section>
        <CapaSection proposta={proposta} />
      </div>

      {proposta.cabecalho.mensagem_abertura && (
        <div data-pdf-section className="max-w-3xl mx-auto px-6 py-10 text-center">
          <p className="text-lg leading-relaxed opacity-80 italic">{proposta.cabecalho.mensagem_abertura}</p>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-8">
        {secoes.map(s => (
          <div key={s.id} data-pdf-section className="mb-10">
            <PreviewRenderer secoes={[s]} corPrimaria={corPrimaria} idioma={idioma} />
          </div>
        ))}
      </div>

      <div data-pdf-section className="max-w-3xl mx-auto px-6">
        <RodapeSection proposta={proposta} />
      </div>

      {proposta.cabecalho.validade && (
        <div className="text-center pb-8 text-sm opacity-40">
          {t(idioma).validaAte}{' '}
          {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString(
            idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR',
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Discovery PDF Layout ----------

function PdfDiscoveryLayout({
  proposta,
  secoes,
  idioma,
}: {
  proposta: Proposta;
  secoes: SecaoProposta[];
  idioma: IdiomaProposal;
}) {
  const i18n = t(idioma);
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const visibleSecoes = secoes.filter(s => s.visivel);

  const roteiroDias = visibleSecoes.filter(s => s.tipo === 'ROTEIRO_DIA');
  const valoresSecoes = visibleSecoes.filter(s => s.tipo === 'VALORES');
  const inclusosSecoes = visibleSecoes.filter(s => s.tipo === 'INCLUSOS');

  const rendered = new Set<string>();

  function renderSection(secao: SecaoProposta, idx: number) {
    const key = `${secao.id}-${idx}`;

    if (secao.tipo === 'ALOJAMENTO') {
      if (rendered.has('ALOJAMENTO')) return null;
      rendered.add('ALOJAMENTO');
      const aloj = proposta.viagem?.alojamentos;
      if (!aloj || aloj.length === 0) return null;
      return (
        <div key={key} data-pdf-section>
          <AccommodationSummary alojamentos={aloj} idioma={idioma} corPrimaria={corPrimaria} />
        </div>
      );
    }

    if (secao.tipo === 'TRANSPORTE') {
      if (rendered.has('TRANSPORTE')) return null;
      rendered.add('TRANSPORTE');
      const transp = proposta.viagem?.transportes;
      if (!transp || transp.length === 0) return null;
      return (
        <div key={key} data-pdf-section>
          <TransportSummary transportes={transp} idioma={idioma} corPrimaria={corPrimaria} />
        </div>
      );
    }

    if (secao.tipo === 'ROTEIRO_DIA') {
      if (rendered.has('ROTEIRO_DIA')) return null;
      rendered.add('ROTEIRO_DIA');
      if (roteiroDias.length === 0) return null;
      const groups = groupDaysByDestination(proposta);
      if (groups.length === 0) return null;
      return (
        <section key={key} data-pdf-section className="py-10 bg-gray-50">
          <div className="max-w-4xl mx-auto px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">{i18n.itinerario}</h2>
            {groups.map((group, gi) => (
              <div key={gi} {...(gi > 0 ? { 'data-pdf-break': true } : {})}>
                <DestinationBlock group={group} index={gi} idioma={idioma} corPrimaria={corPrimaria} />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (secao.tipo === 'VALORES') {
      if (rendered.has('VALORES')) return null;
      rendered.add('VALORES');
      return (
        <PdfDiscoveryPricing
          key={key}
          valoresSecoes={valoresSecoes}
          inclusosSecoes={inclusosSecoes}
          idioma={idioma}
          corPrimaria={corPrimaria}
          proposta={proposta}
        />
      );
    }

    if (secao.tipo === 'INCLUSOS') {
      if (rendered.has('VALORES') || rendered.has('INCLUSOS')) return null;
      if (valoresSecoes.length === 0) {
        rendered.add('INCLUSOS');
        return (
          <PdfDiscoveryPricing
            key={key}
            valoresSecoes={[]}
            inclusosSecoes={inclusosSecoes}
            idioma={idioma}
            corPrimaria={corPrimaria}
            proposta={proposta}
          />
        );
      }
      return null;
    }

    if (secao.tipo === 'FAQ') {
      const c = secao.conteudo as { perguntas?: { pergunta: string; resposta: string }[] };
      const perguntas = c.perguntas || [];
      if (perguntas.length === 0) return null;
      return (
        <section key={key} data-pdf-section className="py-10 bg-gray-50">
          <div className="max-w-3xl mx-auto px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">{i18n.perguntasFrequentes}</h2>
            <div className="space-y-3">
              {perguntas.map((faq, fi) => (
                <div
                  key={fi}
                  {...(fi > 0 ? { 'data-pdf-break': true } : {})}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden"
                >
                  <div className="px-5 py-4 text-sm font-semibold text-gray-900">{faq.pergunta}</div>
                  <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                    {faq.resposta}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    if (secao.tipo === 'DEPOIMENTO') {
      const c = secao.conteudo as {
        depoimentos?: { texto: string; autor: string; foto?: string; foto_url?: string; destino?: string }[];
      };
      const deps = c.depoimentos || [];
      if (deps.length === 0) return null;
      const { r: dr, g: dg, b: db } = hexToRgb(corPrimaria);
      // Solid dark gradient (no alpha-blend mid-stop) so white text stays
      // legible no matter where the slicer cuts the section across pages.
      const darkMid = `rgb(${Math.round(dr * 0.18 + 10)}, ${Math.round(dg * 0.18 + 10)}, ${Math.round(db * 0.18 + 18)})`;
      return (
        <section
          key={key}
          data-pdf-section
          className="py-10"
          style={{ background: `linear-gradient(135deg, #0a0a14 0%, ${darkMid} 50%, #0a0a14 100%)` }}
        >
          <div className="max-w-5xl mx-auto px-8">
            <div className="text-center mb-10">
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase bg-white/10 text-white/80">
                Quem já viajou
              </span>
              <h2 className="mt-4 text-3xl font-bold text-white">Histórias que continuam sendo contadas</h2>
            </div>
            <div className={`grid gap-5 ${deps.length === 1 ? 'max-w-2xl mx-auto' : 'sm:grid-cols-2'}`}>
              {deps.map((dep, di) => (
                <div
                  key={di}
                  {...(di > 0 ? { 'data-pdf-break': true } : {})}
                  className="p-6 rounded-2xl border"
                  style={{
                    background: 'rgba(20, 20, 35, 0.55)',
                    borderColor: 'rgba(255,255,255,0.12)',
                  }}
                >
                  <div className="text-4xl leading-none font-serif mb-2" style={{ color: corPrimaria, opacity: 0.7 }}>
                    &ldquo;
                  </div>
                  <p className="text-base text-white/90 leading-relaxed font-light">{dep.texto}</p>
                  <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-3">
                    {dep.foto_url || dep.foto ? (
                      <img
                        src={dep.foto_url || dep.foto}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                        style={{ outline: '2px solid rgba(255,255,255,0.20)' }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ backgroundColor: corPrimaria }}
                      >
                        {dep.autor?.charAt(0) || '·'}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold text-white">{dep.autor}</div>
                      {dep.destino && <div className="text-xs text-white/60 mt-0.5">{dep.destino}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section key={key} data-pdf-section className="py-10 bg-white">
        <div className="max-w-4xl mx-auto px-8">
          <PreviewRenderer secoes={[secao]} corPrimaria={corPrimaria} idioma={idioma} />
        </div>
      </section>
    );
  }

  return (
    <div className="bg-white text-gray-900">
      <PdfDiscoveryHero proposta={proposta} />

      <PdfIntro proposta={proposta} idioma={idioma} />

      {visibleSecoes.map((s, i) => renderSection(s, i))}

      <PdfFooter proposta={proposta} inclusosSecoes={inclusosSecoes} idioma={idioma} />
    </div>
  );
}

// ====================================================================
// Main Modal Component
// ====================================================================

export function PdfExportModal({ proposta, open, onClose }: Props) {
  const [step, setStep] = useState<PdfStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  const idioma = (proposta.idioma || 'pt-BR') as IdiomaProposal;

  const pdfSecoes = proposta.secoes.filter(s => !EXCLUDED_TIPOS.has(s.tipo));

  const generatePdf = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);

    try {
      setStep('rendering');
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      if (proposta.visual.fonte === 'Playfair Display') {
        await document.fonts.ready;
      }

      if (cancelledRef.current) return;

      setStep('images');
      if (containerRef.current) {
        await waitForImages(containerRef.current);
      }

      if (cancelledRef.current) return;

      setStep('generating');

      if (!containerRef.current) throw new Error('Container de renderização não encontrado');

      await captureAndSavePdf(containerRef.current, `${proposta.numero || 'proposta'}.pdf`);

      if (cancelledRef.current) return;

      setStep('done');
      setTimeout(() => {
        if (!cancelledRef.current) onClose();
      }, 2000);
    } catch (err) {
      console.error('[PDF export]', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido ao gerar PDF');
    }
  }, [proposta, onClose]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(generatePdf, 100);
      return () => clearTimeout(timer);
    } else {
      setStep(null);
      setError(null);
      cancelledRef.current = true;
    }
  }, [open, generatePdf]);

  const handleCancel = () => {
    cancelledRef.current = true;
    onClose();
  };

  const handleRetry = () => {
    setError(null);
    generatePdf();
  };

  if (!open) return null;

  const currentStepIdx = step ? stepIndex(step) : -1;

  return (
    <>
      {/* Off-screen render container */}
      <div
        ref={containerRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '794px',
          zIndex: -1,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <style>{`
          [data-pdf-container] *, [data-pdf-container] *::before, [data-pdf-container] *::after {
            animation: none !important;
            transition: none !important;
          }
          [data-pdf-container] details > summary { display: none !important; }
          [data-pdf-container] details { display: block !important; }
          /* Compact vertical rhythm — overrides the live components' generous py-16/py-20.
             Keeps PDFs from spreading across many half-empty pages. */
          [data-pdf-container] section { padding-top: 24px !important; padding-bottom: 24px !important; }
          /* Tighten inner spacing aggressively in PDF context */
          [data-pdf-container] .mt-14, [data-pdf-container] .mt-12 { margin-top: 1.25rem !important; }
          [data-pdf-container] .mt-10, [data-pdf-container] .mt-8 { margin-top: 1rem !important; }
          [data-pdf-container] .mb-14, [data-pdf-container] .mb-12 { margin-bottom: 1.25rem !important; }
          [data-pdf-container] .mb-10, [data-pdf-container] .mb-8 { margin-bottom: 1rem !important; }
          [data-pdf-container] .pt-10, [data-pdf-container] .pt-8 { padding-top: 1rem !important; }
          [data-pdf-container] .pb-10, [data-pdf-container] .pb-8 { padding-bottom: 1rem !important; }
          [data-pdf-container] .py-12, [data-pdf-container] .py-16, [data-pdf-container] .py-20 { padding-top: 24px !important; padding-bottom: 24px !important; }
          /* DayEntry pb-8 is too tall for PDF — give days breathing room without huge gaps */
          [data-pdf-container] .pb-8 { padding-bottom: 1rem !important; }
          /* Trim default spacing inside cards */
          [data-pdf-container] .space-y-4 > * + * { margin-top: 0.75rem !important; }
          [data-pdf-container] .gap-6 { gap: 1rem !important; }
        `}</style>
        <div data-pdf-container>
          {proposta.visual.layout === 'DISCOVERY' ? (
            <PdfDiscoveryLayout proposta={proposta} secoes={pdfSecoes} idioma={idioma} />
          ) : (
            <PdfClassicLayout proposta={proposta} secoes={pdfSecoes} idioma={idioma} />
          )}
        </div>
      </div>

      {/* Visible modal overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div
          className="bg-[var(--t-surface)] rounded-2xl w-full max-w-sm mx-4 overflow-hidden"
          style={{ boxShadow: 'var(--elevation-4)' }}
        >
          <div className="px-6 pt-6 pb-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--t-green)]/10 flex items-center justify-center mx-auto mb-3">
              {step === 'done' ? (
                <Check className="w-6 h-6 text-[var(--t-green)]" />
              ) : error ? (
                <AlertCircle className="w-6 h-6 text-red-400" />
              ) : (
                <FileDown className="w-6 h-6 text-[var(--t-green)]" />
              )}
            </div>
            <h3 className="text-base font-semibold text-[var(--t-text)]">
              {error ? 'Erro na exportação' : step === 'done' ? 'PDF Exportado' : 'Exportando Proposta'}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mt-1">
              {error ? 'Ocorreu um problema ao gerar o PDF' : step === 'done' ? 'O download foi iniciado' : proposta.numero || 'Proposta'}
            </p>
          </div>

          {!error && (
            <div className="px-6 pb-2">
              <div className="space-y-3">
                {STEP_CONFIG.map((s, i) => {
                  const isActive = i === currentStepIdx;
                  const isDone = i < currentStepIdx || step === 'done';
                  const isPending = i > currentStepIdx && step !== 'done';

                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isDone
                          ? 'bg-[var(--t-green)] text-white'
                          : isActive
                            ? 'bg-[var(--t-green)]/15 text-[var(--t-green)]'
                            : 'bg-[var(--t-surface-hover)] text-[var(--t-text-muted)]'
                      }`}>
                        {isDone ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : isActive ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />
                        )}
                      </div>
                      <span className={`text-sm transition-colors duration-300 ${
                        isDone
                          ? 'text-[var(--t-green)] font-medium'
                          : isActive
                            ? 'text-[var(--t-text)] font-medium'
                            : isPending
                              ? 'text-[var(--t-text-muted)]'
                              : 'text-[var(--t-text)]'
                      }`}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="px-6 pb-2">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          <div className="px-6 py-4 flex justify-end gap-2">
            {error ? (
              <>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-xl text-sm text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] transition-colors"
                >
                  Fechar
                </button>
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-[var(--t-green)] hover:brightness-110 transition-all flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Tentar novamente
                </button>
              </>
            ) : step === 'done' ? (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-[var(--t-green)] hover:bg-[var(--t-green)]/10 transition-colors"
              >
                Fechar
              </button>
            ) : (
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-xl text-sm text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] transition-colors flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
