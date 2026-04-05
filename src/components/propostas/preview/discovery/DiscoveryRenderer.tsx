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

  // Build ordered render list — respects editor order
  // ALOJAMENTO blocks trigger viagem summaries (accommodation + map) once
  // TRANSPORTE blocks trigger viagem transport summary once
  // ROTEIRO_DIA blocks are grouped into itinerary once
  // VALORES + INCLUSOS are combined into pricing once
  const rendered = new Set<string>(); // track one-time renders
  const visibleSecoes = proposta.secoes.filter(s => s.visivel);

  // Collect consecutive ROTEIRO_DIA groups
  const roteiroDias = visibleSecoes.filter(s => s.tipo === 'ROTEIRO_DIA');
  const hasItinerary = roteiroDias.length > 0;

  // Collect VALORES + INCLUSOS for combined pricing
  const valoresSecoes = visibleSecoes.filter(s => s.tipo === 'VALORES');
  const inclusosSecoes = visibleSecoes.filter(s => s.tipo === 'INCLUSOS');

  function renderSection(secao: typeof visibleSecoes[number], idx: number) {
    const key = `${secao.id}-${idx}`;

    // ALOJAMENTO → render accommodation summary + route map (once, at position of first ALOJAMENTO)
    if (secao.tipo === 'ALOJAMENTO') {
      if (rendered.has('ALOJAMENTO')) return null;
      rendered.add('ALOJAMENTO');
      const aloj = proposta.viagem?.alojamentos;
      if (!aloj || aloj.length === 0) return null;
      return (
        <div key={key}>
          <AccommodationSummary alojamentos={aloj} idioma={idioma} corPrimaria={corPrimaria} />
          <RouteMap alojamentos={aloj} transportes={proposta.viagem?.transportes || []} idioma={idioma} corPrimaria={corPrimaria} />
        </div>
      );
    }

    // TRANSPORTE → render transport summary (once)
    if (secao.tipo === 'TRANSPORTE') {
      if (rendered.has('TRANSPORTE')) return null;
      rendered.add('TRANSPORTE');
      const transp = proposta.viagem?.transportes;
      if (!transp || transp.length === 0) return null;
      return <TransportSummary key={key} transportes={transp} idioma={idioma} corPrimaria={corPrimaria} />;
    }

    // ROTEIRO_DIA → render grouped itinerary (once, at position of first ROTEIRO_DIA)
    if (secao.tipo === 'ROTEIRO_DIA') {
      if (rendered.has('ROTEIRO_DIA')) return null;
      rendered.add('ROTEIRO_DIA');
      if (!hasItinerary) return null;
      const groups = groupDaysByDestination(proposta);
      if (groups.length === 0) return null;
      return (
        <section key={key} id="discovery-itinerary" className="py-16 bg-gray-50">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-10">{i18n.itinerario}</h2>
            {groups.map((group, gi) => (
              <DestinationBlock key={gi} group={group} index={gi} idioma={idioma} corPrimaria={corPrimaria} />
            ))}
            <div className="text-center mt-8 pt-8 border-t border-gray-200">
              <div className="inline-flex items-center gap-2 text-gray-400 text-sm">
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                {i18n.fimItinerario}
              </div>
            </div>
          </div>
        </section>
      );
    }

    // VALORES → render pricing section with INCLUSOS (once)
    if (secao.tipo === 'VALORES') {
      if (rendered.has('VALORES')) return null;
      rendered.add('VALORES');
      return <PricingSection key={key} valoresSecoes={valoresSecoes} inclusosSecoes={inclusosSecoes} idioma={idioma} corPrimaria={corPrimaria} />;
    }

    // INCLUSOS → skip standalone (rendered with VALORES above). If VALORES comes later, render here.
    if (secao.tipo === 'INCLUSOS') {
      if (rendered.has('VALORES') || rendered.has('INCLUSOS')) return null;
      // If no VALORES block exists, render pricing anyway
      if (valoresSecoes.length === 0) {
        rendered.add('INCLUSOS');
        return <PricingSection key={key} valoresSecoes={[]} inclusosSecoes={inclusosSecoes} idioma={idioma} corPrimaria={corPrimaria} />;
      }
      return null; // will render when VALORES is reached
    }

    // FAQ → Discovery styled
    if (secao.tipo === 'FAQ') {
      const c = secao.conteudo as { perguntas?: { pergunta: string; resposta: string }[] };
      const perguntas = c.perguntas || [];
      if (perguntas.length === 0) return null;
      return (
        <section key={key} className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.perguntasFrequentes}</h2>
            {perguntas.map((faq, fi) => (
              <details key={fi} className="mb-3 bg-white rounded-xl border border-gray-100 overflow-hidden group">
                <summary className="px-5 py-4 cursor-pointer text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors">
                  {faq.pergunta}
                </summary>
                <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{faq.resposta}</div>
              </details>
            ))}
          </div>
        </section>
      );
    }

    // DEPOIMENTO → Discovery styled
    if (secao.tipo === 'DEPOIMENTO') {
      const c = secao.conteudo as { depoimentos?: { texto: string; autor: string; foto?: string; foto_url?: string; destino?: string }[] };
      const deps = c.depoimentos || [];
      if (deps.length === 0) return null;
      return (
        <section key={key} className="py-16 bg-white">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid sm:grid-cols-2 gap-6">
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

    // All other blocks (TEXTO, SERVICO, GALERIA, VIDEO, MAPA, COUNTDOWN, CTA) → PreviewRenderer
    return (
      <section key={key} className="py-12 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <PreviewRenderer secoes={[secao]} corPrimaria={corPrimaria} idioma={idioma} />
        </div>
      </section>
    );
  }

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

      {visibleSecoes.map((s, i) => renderSection(s, i))}

      {/* Footer */}
      <DiscoveryFooter proposta={proposta} slug={slug} idioma={idioma} />
    </div>
  );
}
