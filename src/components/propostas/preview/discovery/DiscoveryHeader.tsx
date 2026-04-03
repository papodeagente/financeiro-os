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
  const i18n = t(idioma);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const logo = proposta.visual.logo_agencia;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14 sm:h-16">
        {/* Logo / Agency name */}
        <div className="flex items-center gap-2 shrink-0">
          {logo ? (
            <img src={logo} alt="" className="h-8 w-auto object-contain" />
          ) : (
            <span className={`text-sm font-semibold ${scrolled ? 'text-gray-800' : 'text-white'}`}>
              {proposta.rodape.nome_vendedor || ''}
            </span>
          )}
        </div>

        {/* Nav links — hidden on mobile */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeSection === item.id
                  ? 'bg-white/20 text-white'
                  : scrolled
                    ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
              } ${activeSection === item.id && scrolled ? '!bg-gray-100 !text-gray-900' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* CTA button */}
        <button
          onClick={() => scrollTo('discovery-pricing')}
          className="px-4 py-2 rounded-full text-xs font-bold text-white transition-all hover:scale-105"
          style={{ backgroundColor: corPrimaria }}
        >
          {i18n.reserveAgora}
        </button>
      </div>
    </header>
  );
}
