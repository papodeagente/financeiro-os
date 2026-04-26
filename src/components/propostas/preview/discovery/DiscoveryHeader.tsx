'use client';

import { useState, useEffect } from 'react';
import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface NavItem { id: string; label: string }

interface Props {
  proposta: Proposta;
  idioma: IdiomaProposal;
  navItems: NavItem[];
  activeSection: string;
}

export function DiscoveryHeader({ proposta, idioma, navItems, activeSection }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const i18n = t(idioma);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 80);
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min((y / docHeight) * 100, 100) : 0;
      setProgress(pct);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNavOpen(false);
  };

  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const logo = proposta.visual.logo_agencia;

  // Contextual CTA label based on scroll position
  const ctaLabel = (() => {
    if (progress < 25) return i18n.reserveAgora;
    if (progress < 60) return 'Ver preço';
    if (progress < 90) return 'Quero esta viagem';
    return 'Falar agora';
  })();

  const ctaTarget = progress < 60 ? 'discovery-pricing' : 'discovery-footer';

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14 sm:h-16">
          {/* Logo / Agency name */}
          <button
            onClick={() => scrollTo('discovery-intro')}
            className="flex items-center gap-2 shrink-0"
          >
            {logo ? (
              <img src={logo} alt="" className="h-8 w-auto object-contain" />
            ) : (
              <span className={`text-sm font-semibold transition-colors ${scrolled ? 'text-gray-800' : 'text-white drop-shadow-sm'}`}>
                {proposta.rodape.nome_vendedor || ''}
              </span>
            )}
          </button>

          {/* Nav links — desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(item => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className="relative px-3 py-2 text-xs font-medium transition-colors group"
                >
                  <span
                    className={`transition-colors ${
                      active
                        ? scrolled ? 'text-gray-900' : 'text-white'
                        : scrolled ? 'text-gray-500 hover:text-gray-900' : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </span>
                  {/* Animated underline */}
                  <span
                    className="absolute left-3 right-3 -bottom-0.5 h-[2px] rounded-full transition-all duration-300 origin-left"
                    style={{
                      backgroundColor: corPrimaria,
                      transform: active ? 'scaleX(1)' : 'scaleX(0)',
                    }}
                  />
                </button>
              );
            })}
          </nav>

          {/* Right side: CTA + mobile menu */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollTo(ctaTarget)}
              className="px-4 py-2 rounded-full text-xs font-bold text-white transition-all hover:scale-105 shadow-md"
              style={{ backgroundColor: corPrimaria }}
            >
              {ctaLabel}
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileNavOpen(o => !o)}
              className={`md:hidden p-2 rounded-lg transition-colors ${
                scrolled ? 'text-gray-700 hover:bg-gray-100' : 'text-white hover:bg-white/10'
              }`}
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                {mobileNavOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Reading progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-transparent">
          <div
            className="h-full transition-all duration-150 ease-out"
            style={{ width: `${progress}%`, backgroundColor: corPrimaria }}
          />
        </div>
      </header>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute top-14 left-0 right-0 bg-white shadow-lg border-b border-gray-100">
            <nav className="max-w-7xl mx-auto px-4 py-3 flex flex-col">
              {navItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={`py-3 px-4 text-left text-sm rounded-lg transition-colors ${
                    activeSection === item.id
                      ? 'font-semibold'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  style={activeSection === item.id ? { color: corPrimaria, backgroundColor: `${corPrimaria}10` } : {}}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
