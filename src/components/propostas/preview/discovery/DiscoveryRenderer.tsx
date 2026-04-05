'use client';

import { useState, useEffect, useCallback } from 'react';
import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { DiscoveryHeader } from './DiscoveryHeader';
import { DiscoveryHero } from './DiscoveryHero';
import { IntroSection } from './IntroSection';
import { AccommodationSummary } from './AccommodationSummary';
import { TransportSummary } from './TransportSummary';
import { RouteMap } from './RouteMap';
import { PricingSection } from './PricingSection';
import { DestinationBlock } from './DestinationBlock';
import { DiscoveryFooter } from './DiscoveryFooter';
import { PreviewRenderer } from '../PreviewRenderer';
import { groupDaysByDestination } from '@/lib/discovery-utils';

interface NavItem { id: string; label: string }

interface Props {
  proposta: Proposta;
  slug: string;
  idioma: IdiomaProposal;
}

function buildNavItems(proposta: Proposta, idioma: IdiomaProposal): NavItem[] {
  const i18n = t(idioma);
  const items: NavItem[] = [{ id: 'discovery-intro', label: i18n.inicio }];

  const viagem = proposta.viagem;
  if (viagem?.alojamentos && viagem.alojamentos.length > 0) {
    items.push({ id: 'discovery-accommodations', label: i18n.resumoAlojamentos });
  }
  // Map — if any alojamento has coordinates
  if (viagem?.alojamentos?.some(a => a.lat && a.lng)) {
    items.push({ id: 'discovery-map', label: i18n.mapaRota });
  }

  if (viagem?.transportes && viagem.transportes.length > 0) {
    items.push({ id: 'discovery-transport', label: i18n.resumoTransportes });
  }

  // Check for ROTEIRO_DIA blocks
  if (proposta.secoes.some(s => s.tipo === 'ROTEIRO_DIA')) {
    items.push({ id: 'discovery-itinerary', label: i18n.itinerario });
  }

  // Check for VALORES blocks
  if (proposta.secoes.some(s => s.tipo === 'VALORES')) {
    items.push({ id: 'discovery-pricing', label: i18n.precos });
  }

  return items;
}

export function DiscoveryRenderer({ proposta, slug, idioma }: Props) {
  const [activeSection, setActiveSection] = useState('discovery-intro');
  const navItems = buildNavItems(proposta, idioma);
  const i18n = t(idioma);
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';

  // IntersectionObserver for active nav tracking
  const observeSections = useCallback(() => {
    const sectionIds = navItems.map(n => n.id);
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-40% 0px -50% 0px', threshold: 0 }
    );

    sectionIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [navItems]);

  useEffect(() => {
    const cleanup = observeSections();
    return cleanup;
  }, [observeSections]);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Extract sections for fallback rendering
  const valoresSecoes = proposta.secoes.filter(s => s.tipo === 'VALORES' && s.visivel);
  const inclusosSecoes = proposta.secoes.filter(s => s.tipo === 'INCLUSOS' && s.visivel);
  const faqSecoes = proposta.secoes.filter(s => s.tipo === 'FAQ' && s.visivel);
  const depoimentoSecoes = proposta.secoes.filter(s => s.tipo === 'DEPOIMENTO' && s.visivel);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <DiscoveryHeader
        proposta={proposta}
        idioma={idioma}
        navItems={navItems}
        activeSection={activeSection}
      />

      <DiscoveryHero proposta={proposta} />

      <IntroSection proposta={proposta} idioma={idioma} />

      {/* Accommodation Summary */}
      {proposta.viagem?.alojamentos && proposta.viagem.alojamentos.length > 0 && (
        <AccommodationSummary
          alojamentos={proposta.viagem.alojamentos}
          idioma={idioma}
          corPrimaria={corPrimaria}
        />
      )}

      {/* Route Map */}
      {proposta.viagem?.alojamentos && proposta.viagem.alojamentos.length > 0 && (
        <RouteMap
          alojamentos={proposta.viagem.alojamentos}
          transportes={proposta.viagem?.transportes || []}
          idioma={idioma}
          corPrimaria={corPrimaria}
        />
      )}

      {/* Transport Summary */}
      {proposta.viagem?.transportes && proposta.viagem.transportes.length > 0 && (
        <TransportSummary
          transportes={proposta.viagem.transportes}
          idioma={idioma}
          corPrimaria={corPrimaria}
        />
      )}

      {/* Itinerary grouped by destination */}
      {proposta.secoes.some(s => s.tipo === 'ROTEIRO_DIA') && (() => {
        const groups = groupDaysByDestination(proposta);
        if (groups.length === 0) return null;
        return (
          <section id="discovery-itinerary" className="py-16 bg-gray-50">
            <div className="max-w-4xl mx-auto px-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-10">{i18n.itinerario}</h2>
              {groups.map((group, i) => (
                <DestinationBlock
                  key={i}
                  group={group}
                  index={i}
                  idioma={idioma}
                  corPrimaria={corPrimaria}
                />
              ))}
              {/* End of itinerary marker */}
              <div className="text-center mt-8 pt-8 border-t border-gray-200">
                <div className="inline-flex items-center gap-2 text-gray-400 text-sm">
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                  {i18n.fimItinerario}
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Pricing */}
      <PricingSection
        valoresSecoes={valoresSecoes}
        inclusosSecoes={inclusosSecoes}
        idioma={idioma}
        corPrimaria={corPrimaria}
      />

      {/* FAQ */}
      {faqSecoes.length > 0 && (
        <section className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.perguntasFrequentes}</h2>
            {faqSecoes.map(s => {
              const c = s.conteudo as { perguntas?: { pergunta: string; resposta: string }[] };
              return (c.perguntas || []).map((faq, i) => (
                <details key={`${s.id}-${i}`} className="mb-3 bg-white rounded-xl border border-gray-100 overflow-hidden group">
                  <summary className="px-5 py-4 cursor-pointer text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors">
                    {faq.pergunta}
                  </summary>
                  <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
                    {faq.resposta}
                  </div>
                </details>
              ));
            })}
          </div>
        </section>
      )}

      {/* Testimonials */}
      {depoimentoSecoes.length > 0 && (
        <section className="py-16 bg-white">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid sm:grid-cols-2 gap-6">
              {depoimentoSecoes.map(s => {
                const c = s.conteudo as { depoimentos?: { texto: string; autor: string; foto?: string; foto_url?: string; destino?: string }[] };
                return (c.depoimentos || []).map((dep, i) => (
                  <div key={`${s.id}-${i}`} className="p-6 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-sm text-gray-700 italic leading-relaxed">&ldquo;{dep.texto}&rdquo;</p>
                    <div className="mt-4 flex items-center gap-3">
                      {(dep.foto_url || dep.foto) && <img src={dep.foto_url || dep.foto} alt="" className="w-10 h-10 rounded-full object-cover" />}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{dep.autor}</div>
                        {dep.destino && <div className="text-xs text-gray-500">{dep.destino}</div>}
                      </div>
                    </div>
                  </div>
                ));
              })}
            </div>
          </div>
        </section>
      )}

      {/* Remaining blocks (GALERIA, TEXTO, SERVICO, VIDEO, MAPA, COUNTDOWN, CTA) */}
      {(() => {
        const handledTypes = new Set(['ROTEIRO_DIA', 'VALORES', 'INCLUSOS', 'FAQ', 'DEPOIMENTO', 'ALOJAMENTO', 'TRANSPORTE']);
        const remaining = proposta.secoes.filter(s => s.visivel && !handledTypes.has(s.tipo));
        if (remaining.length === 0) return null;
        return (
          <section className="py-12 bg-white">
            <div className="max-w-4xl mx-auto px-6">
              <PreviewRenderer secoes={remaining} corPrimaria={corPrimaria} idioma={idioma} />
            </div>
          </section>
        );
      })()}

      {/* Footer */}
      <DiscoveryFooter proposta={proposta} slug={slug} idioma={idioma} />
    </div>
  );
}
