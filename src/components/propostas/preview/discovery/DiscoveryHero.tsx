'use client';

import { Proposta } from '@/lib/crm-types';

interface Props {
  proposta: Proposta;
}

export function DiscoveryHero({ proposta }: Props) {
  const img = proposta.visual.imagem_capa;
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const viagem = proposta.viagem;
  const logo = proposta.visual.logo_agencia;

  // Extract destination names from viagem
  const destinos = viagem?.destinos?.map(d => d.nome).filter(Boolean) || [];
  const duracao = viagem
    ? `${viagem.duracao_dias} Dias / ${viagem.duracao_noites} Noites`
    : '';

  return (
    <section className="relative h-screen w-full overflow-hidden">
      {/* Background image */}
      {img ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${img})` }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: corPrimaria }} />
      )}

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/20" />

      {/* Content */}
      <div className="relative h-full flex flex-col items-center justify-center text-center text-white px-6">
        {/* Subtitle / client name */}
        {proposta.cliente_nome && (
          <p className="text-sm sm:text-base uppercase tracking-[0.3em] text-white/70 mb-4">
            {proposta.cliente_nome}
          </p>
        )}

        {/* Title */}
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold leading-tight max-w-4xl">
          {proposta.cabecalho.titulo || 'Proposta de Viagem'}
        </h1>

        {/* Duration badge */}
        {duracao && (
          <div
            className="mt-6 px-5 py-2 rounded-full text-sm font-medium text-white"
            style={{ backgroundColor: `${corPrimaria}cc` }}
          >
            {duracao}
          </div>
        )}

        {/* Destination pills */}
        {destinos.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {destinos.map((d, i) => (
              <span key={i} className="px-3 py-1 rounded-full bg-white/15 text-white/90 text-xs font-medium backdrop-blur-sm">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Logo bottom-right */}
      {logo && (
        <div className="absolute bottom-8 right-8">
          <img src={logo} alt="" className="h-10 w-auto opacity-80" />
        </div>
      )}

      {/* Scroll arrow */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg className="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
}
