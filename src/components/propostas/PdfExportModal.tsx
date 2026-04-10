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
import { DiscoveryHero } from './preview/discovery/DiscoveryHero';
import { IntroSection } from './preview/discovery/IntroSection';
import { AccommodationSummary } from './preview/discovery/AccommodationSummary';
import { TransportSummary } from './preview/discovery/TransportSummary';
import { PricingSection } from './preview/discovery/PricingSection';
import { DestinationBlock } from './preview/discovery/DestinationBlock';
import { groupDaysByDestination } from '@/lib/discovery-utils';

// Sections to exclude from PDF (non-functional in static output)
const EXCLUDED_TIPOS = new Set(['VIDEO', 'MAPA', 'COUNTDOWN', 'CTA']);

/**
 * Tailwind v4 emits lab()/oklch()/oklab() colors that html2canvas cannot parse.
 *
 * Strategy: Read all CSS rules from the MAIN document (where they're loaded),
 * serialize them, replace unsupported color functions with rgb fallbacks,
 * then inject the sanitized CSS into the CLONED document — replacing all
 * original stylesheets. The main document is NEVER modified.
 */
function buildSanitizedCss(): string {
  const allRules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (let i = 0; i < rules.length; i++) {
        allRules.push(rules[i].cssText);
      }
    } catch {
      // Cross-origin stylesheet — skip (cannot read rules)
    }
  }
  // Replace lab()/oklch()/oklab() with transparent
  return allRules.join('\n').replace(/(?:lab|oklch|oklab)\s*\([^)]*\)/g, 'transparent');
}

function applyCleanStylesheet(clonedDoc: Document, sanitizedCss: string) {
  // Remove ALL existing stylesheets from the cloned doc
  clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());

  // Inject single sanitized stylesheet
  const style = clonedDoc.createElement('style');
  style.textContent = sanitizedCss;
  clonedDoc.head.appendChild(style);
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
      const timeout = setTimeout(resolve, 10000); // 10s max per image
      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); resolve(); }; // don't block on failed images
    });
  });

  return Promise.allSettled(promises).then(() => {});
}

// ---------- Classic PDF Layout ----------

function PdfClassicLayout({ proposta, secoes, idioma }: { proposta: Proposta; secoes: SecaoProposta[]; idioma: IdiomaProposal }) {
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

      <CapaSection proposta={proposta} />

      {proposta.cabecalho.mensagem_abertura && (
        <div className="max-w-3xl mx-auto px-6 py-10 text-center">
          <p className="text-lg leading-relaxed opacity-80 italic">
            {proposta.cabecalho.mensagem_abertura}
          </p>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-8">
        <PreviewRenderer secoes={secoes} corPrimaria={corPrimaria} idioma={idioma} />
      </div>

      <div className="max-w-3xl mx-auto px-6">
        <RodapeSection proposta={proposta} />
      </div>

      {proposta.cabecalho.validade && (
        <div className="text-center pb-8 text-sm opacity-40">
          {t(idioma).validaAte}{' '}
          {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString(
            idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR'
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Discovery PDF Layout ----------

function PdfDiscoveryLayout({ proposta, secoes, idioma }: { proposta: Proposta; secoes: SecaoProposta[]; idioma: IdiomaProposal }) {
  const i18n = t(idioma);
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const visibleSecoes = secoes.filter(s => s.visivel);

  // Collect grouped sections
  const roteiroDias = visibleSecoes.filter(s => s.tipo === 'ROTEIRO_DIA');
  const valoresSecoes = visibleSecoes.filter(s => s.tipo === 'VALORES');
  const inclusosSecoes = visibleSecoes.filter(s => s.tipo === 'INCLUSOS');

  // Track one-time renders
  const rendered = new Set<string>();

  function renderSection(secao: SecaoProposta, idx: number) {
    const key = `${secao.id}-${idx}`;

    if (secao.tipo === 'ALOJAMENTO') {
      if (rendered.has('ALOJAMENTO')) return null;
      rendered.add('ALOJAMENTO');
      const aloj = proposta.viagem?.alojamentos;
      if (!aloj || aloj.length === 0) return null;
      return (
        <div key={key}>
          <AccommodationSummary alojamentos={aloj} idioma={idioma} corPrimaria={corPrimaria} />
        </div>
      );
    }

    if (secao.tipo === 'TRANSPORTE') {
      if (rendered.has('TRANSPORTE')) return null;
      rendered.add('TRANSPORTE');
      const transp = proposta.viagem?.transportes;
      if (!transp || transp.length === 0) return null;
      return <TransportSummary key={key} transportes={transp} idioma={idioma} corPrimaria={corPrimaria} />;
    }

    if (secao.tipo === 'ROTEIRO_DIA') {
      if (rendered.has('ROTEIRO_DIA')) return null;
      rendered.add('ROTEIRO_DIA');
      if (roteiroDias.length === 0) return null;
      const groups = groupDaysByDestination(proposta);
      if (groups.length === 0) return null;
      return (
        <section key={key} className="py-16 bg-gray-50">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-10">{i18n.itinerario}</h2>
            {groups.map((group, gi) => (
              <DestinationBlock key={gi} group={group} index={gi} idioma={idioma} corPrimaria={corPrimaria} />
            ))}
          </div>
        </section>
      );
    }

    if (secao.tipo === 'VALORES') {
      if (rendered.has('VALORES')) return null;
      rendered.add('VALORES');
      return <PricingSection key={key} valoresSecoes={valoresSecoes} inclusosSecoes={inclusosSecoes} idioma={idioma} corPrimaria={corPrimaria} />;
    }

    if (secao.tipo === 'INCLUSOS') {
      if (rendered.has('VALORES') || rendered.has('INCLUSOS')) return null;
      if (valoresSecoes.length === 0) {
        rendered.add('INCLUSOS');
        return <PricingSection key={key} valoresSecoes={[]} inclusosSecoes={inclusosSecoes} idioma={idioma} corPrimaria={corPrimaria} />;
      }
      return null;
    }

    // FAQ — force open (no <details> toggle)
    if (secao.tipo === 'FAQ') {
      const c = secao.conteudo as { perguntas?: { pergunta: string; resposta: string }[] };
      const perguntas = c.perguntas || [];
      if (perguntas.length === 0) return null;
      return (
        <section key={key} className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.perguntasFrequentes}</h2>
            {perguntas.map((faq, fi) => (
              <div key={fi} className="mb-3 bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 text-sm font-medium text-gray-800">{faq.pergunta}</div>
                <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{faq.resposta}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    // DEPOIMENTO
    if (secao.tipo === 'DEPOIMENTO') {
      const c = secao.conteudo as { depoimentos?: { texto: string; autor: string; foto?: string; foto_url?: string; destino?: string }[] };
      const deps = c.depoimentos || [];
      if (deps.length === 0) return null;
      return (
        <section key={key} className="py-16 bg-white">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid grid-cols-2 gap-6">
              {deps.map((dep, di) => (
                <div key={di} className="p-6 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="text-sm text-gray-700 italic leading-relaxed">&ldquo;{dep.texto}&rdquo;</p>
                  <div className="mt-4 flex items-center gap-3">
                    {(dep.foto_url || dep.foto) && <img src={dep.foto_url || dep.foto} alt="" className="w-10 h-10 rounded-full object-cover" />}
                    <div>
                      <div className="text-sm font-medium text-gray-900">{dep.autor}</div>
                      {dep.destino && <div className="text-xs text-gray-500">{dep.destino}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    // All other blocks → PreviewRenderer
    return (
      <section key={key} className="py-12 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <PreviewRenderer secoes={[secao]} corPrimaria={corPrimaria} idioma={idioma} />
        </div>
      </section>
    );
  }

  return (
    <div className="bg-white text-gray-900">
      {/* Hero with fixed height (replaces h-screen) */}
      <div style={{ height: '600px', overflow: 'hidden', position: 'relative' }}>
        <DiscoveryHero proposta={proposta} />
      </div>

      <IntroSection proposta={proposta} idioma={idioma} />

      {visibleSecoes.map((s, i) => renderSection(s, i))}

      {/* Simplified footer (no lead form, no acceptance) */}
      <div className="py-12 bg-gray-50 border-t border-gray-200">
        <div className="max-w-3xl mx-auto px-6 text-center">
          {proposta.rodape.mensagem && (
            <p className="text-gray-600 italic mb-6">{proposta.rodape.mensagem}</p>
          )}
          <p className="text-lg font-semibold text-gray-900">{proposta.rodape.nome_vendedor}</p>
          <div className="mt-2 text-sm text-gray-500 space-y-1">
            {proposta.rodape.email_vendedor && <p>{proposta.rodape.email_vendedor}</p>}
            {proposta.rodape.telefone_vendedor && <p>{proposta.rodape.telefone_vendedor}</p>}
          </div>
          {proposta.cabecalho.validade && (
            <p className="mt-6 text-xs text-gray-400">
              {i18n.validaAte}{' '}
              {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString(
                idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR'
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Main Modal Component ----------

export function PdfExportModal({ proposta, open, onClose }: Props) {
  const [step, setStep] = useState<PdfStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  const idioma = (proposta.idioma || 'pt-BR') as IdiomaProposal;

  // Filter out non-PDF-friendly sections
  const pdfSecoes = proposta.secoes.filter(s => !EXCLUDED_TIPOS.has(s.tipo));

  const generatePdf = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);

    try {
      // Step 1: Wait for React to paint
      setStep('rendering');
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      // Wait for custom fonts if needed
      if (proposta.visual.fonte === 'Playfair Display') {
        await document.fonts.ready;
      }

      if (cancelledRef.current) return;

      // Step 2: Wait for images
      setStep('images');
      if (containerRef.current) {
        await waitForImages(containerRef.current);
      }

      if (cancelledRef.current) return;

      // Step 3: Generate PDF
      setStep('generating');
      const html2pdf = (await import('html2pdf.js')).default;

      if (!containerRef.current) throw new Error('Container de renderização não encontrado');

      // Pre-build sanitized CSS from the main document (never modifies it)
      const sanitizedCss = buildSanitizedCss();

      await html2pdf()
        .set({
          margin: [8, 0, 8, 0],
          filename: `${proposta.numero || 'proposta'}.pdf`,
          image: { type: 'jpeg', quality: 0.92 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            width: 794,
            windowWidth: 794,
            allowTaint: false,
            onclone: (clonedDoc: Document) => {
              // Replace all stylesheets in the clone with sanitized CSS
              applyCleanStylesheet(clonedDoc, sanitizedCss);
            },
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.no-break'] },
        })
        .from(containerRef.current)
        .save();

      if (cancelledRef.current) return;

      // Step 4: Done
      setStep('done');
      setTimeout(() => {
        if (!cancelledRef.current) onClose();
      }, 2000);
    } catch (err) {
      console.error('[PDF export]', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido ao gerar PDF');
    }
  }, [proposta, onClose]);

  // Start generation when modal opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure React renders the off-screen container first
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
        {/* Injected PDF-specific overrides */}
        <style>{`
          [data-pdf-container] * { animation: none !important; transition: none !important; }
          [data-pdf-container] .animate-spin, [data-pdf-container] .animate-bounce { animation: none !important; }
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
          {/* Header */}
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

          {/* Progress steps */}
          {!error && (
            <div className="px-6 pb-2">
              <div className="space-y-3">
                {STEP_CONFIG.map((s, i) => {
                  const isActive = i === currentStepIdx;
                  const isDone = i < currentStepIdx || step === 'done';
                  const isPending = i > currentStepIdx && step !== 'done';

                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      {/* Step indicator */}
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
                      {/* Step label */}
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

          {/* Error message */}
          {error && (
            <div className="px-6 pb-2">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* Actions */}
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
