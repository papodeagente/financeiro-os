'use client';

import { Proposta } from '@/lib/crm-types';

interface Props {
  proposta: Proposta;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 74, b: 173 };
}

export function DiscoveryHero({ proposta }: Props) {
  const img = proposta.visual.imagem_capa;
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const viagem = proposta.viagem;
  const { r, g, b } = hexToRgb(corPrimaria);

  const destinos = viagem?.destinos?.map(d => d.nome).filter(Boolean) || [];
  const duracao = viagem
    ? `${viagem.duracao_dias} dias · ${viagem.duracao_noites} noites`
    : '';

  const subtitulo = proposta.cabecalho.subtitulo;
  const tituloProposta = proposta.cabecalho.titulo || 'Proposta de Viagem';

  // Pull credibility from sobre_agencia (extract first metric line if present)
  const sobreAgencia = viagem?.sobre_agencia || '';
  // Extract numbers like "12 anos", "600+ viagens", "4.9"
  const metrics: string[] = [];
  const yearMatch = sobreAgencia.match(/(\d+)\s*anos/i);
  if (yearMatch) metrics.push(`${yearMatch[1]} anos de mercado`);
  const tripsMatch = sobreAgencia.match(/(\d[\d.]*)\s*\+?\s*(viagens|viajantes|passageiros|fam[ií]lias|cabines)/i);
  if (tripsMatch) metrics.push(`${tripsMatch[1]}+ ${tripsMatch[2].toLowerCase()}`);
  const ratingMatch = sobreAgencia.match(/(\d[.,]\d)\s*(\/\s*5|estrelas)?/);
  if (ratingMatch) metrics.push(`★ ${ratingMatch[1].replace(',', '.')}`);

  return (
    <section className="relative h-[100svh] min-h-[600px] w-full overflow-hidden">
      {/* Background image */}
      {img ? (
        <div
          className="absolute inset-0 bg-cover bg-center scale-105"
          style={{
            backgroundImage: `url(${img})`,
            animation: 'heroZoom 20s ease-out forwards',
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: corPrimaria }} />
      )}

      {/* Branded gradient overlay — vertical (legibility) + horizontal tint (brand color) */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/80" />
      <div
        className="absolute inset-0 mix-blend-multiply opacity-40"
        style={{
          background: `linear-gradient(135deg, rgba(${r},${g},${b},0.7) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)`,
        }}
      />

      {/* Decorative grain — subtle */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
        }}
      />

      {/* Content */}
      <div className="relative h-full flex flex-col items-center justify-center text-center text-white px-6 max-w-5xl mx-auto">
        {/* Eyebrow — for whom */}
        {proposta.cliente_nome && (
          <p
            className="text-[11px] sm:text-xs uppercase tracking-[0.4em] text-white/70 mb-5"
            style={{ animation: 'heroFadeIn 0.8s ease-out 0.2s both' }}
          >
            Proposta exclusiva para {proposta.cliente_nome}
          </p>
        )}

        {/* Tagline — sets the mood */}
        {subtitulo && (
          <p
            className="text-base sm:text-lg text-white/85 italic font-light mb-3 max-w-2xl"
            style={{ animation: 'heroFadeIn 0.8s ease-out 0.4s both' }}
          >
            {subtitulo}
          </p>
        )}

        {/* Title */}
        <h1
          className="text-4xl sm:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight max-w-4xl mb-6"
          style={{ animation: 'heroFadeIn 1s ease-out 0.6s both' }}
        >
          {tituloProposta}
        </h1>

        {/* Duration + destinos in single row */}
        <div
          className="flex flex-wrap items-center justify-center gap-2 mb-6"
          style={{ animation: 'heroFadeIn 0.8s ease-out 0.9s both' }}
        >
          {duracao && (
            <span
              className="px-4 py-1.5 rounded-full text-sm font-semibold backdrop-blur-md border border-white/30"
              style={{ backgroundColor: `rgba(${r},${g},${b},0.4)` }}
            >
              {duracao}
            </span>
          )}
          {destinos.map((d, i) => (
            <span
              key={i}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white/90 text-xs font-medium backdrop-blur-md border border-white/15"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Trust metrics */}
        {metrics.length > 0 && (
          <div
            className="flex items-center gap-4 sm:gap-6 mt-2 text-white/75 text-xs sm:text-sm"
            style={{ animation: 'heroFadeIn 0.8s ease-out 1.1s both' }}
          >
            {metrics.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <span className="w-1 h-1 rounded-full bg-white/40" />}
                <span className="font-medium tracking-wide">{m}</span>
              </div>
            ))}
          </div>
        )}

        {/* Dual CTA */}
        <div
          className="absolute bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 flex flex-col sm:flex-row items-center gap-3"
          style={{ animation: 'heroFadeIn 1s ease-out 1.3s both' }}
        >
          <button
            onClick={() => document.getElementById('discovery-itinerary')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-6 py-3 rounded-full bg-white/10 backdrop-blur-md border border-white/30 text-white text-sm font-semibold hover:bg-white/20 transition-all hover:scale-105"
          >
            Ver roteiro completo
          </button>
          <button
            onClick={() => document.getElementById('discovery-pricing')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-6 py-3 rounded-full bg-white text-gray-900 text-sm font-bold hover:scale-105 transition-all shadow-2xl"
          >
            Ver investimento →
          </button>
        </div>
      </div>

      {/* Scroll indicator — subtle line + arrow */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
        <div className="w-px h-8 bg-gradient-to-b from-transparent to-white/40" />
        <svg className="w-4 h-4 text-white/50 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      <style jsx>{`
        @keyframes heroZoom {
          from { transform: scale(1.15); }
          to { transform: scale(1.02); }
        }
        @keyframes heroFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
