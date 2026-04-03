'use client';

import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  proposta: Proposta;
  idioma: IdiomaProposal;
}

export function IntroSection({ proposta, idioma }: Props) {
  const i18n = t(idioma);
  const viagem = proposta.viagem;
  const mensagem = proposta.cabecalho.mensagem_abertura;
  const tags = viagem?.interesses_tags || [];
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';

  if (!mensagem && tags.length === 0) return null;

  return (
    <section id="discovery-intro" className="py-16 sm:py-20 bg-white">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
          {i18n.introducao}
        </h2>

        {mensagem && (
          <p className="text-gray-600 text-base sm:text-lg leading-relaxed whitespace-pre-line">
            {mensagem}
          </p>
        )}

        {/* Info cards */}
        {viagem && (
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            {viagem.duracao_dias > 0 && (
              <div className="px-6 py-4 rounded-xl bg-gray-50 border border-gray-100">
                <div className="text-2xl font-bold" style={{ color: corPrimaria }}>
                  {viagem.duracao_dias}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Dias</div>
              </div>
            )}
            {viagem.duracao_noites > 0 && (
              <div className="px-6 py-4 rounded-xl bg-gray-50 border border-gray-100">
                <div className="text-2xl font-bold" style={{ color: corPrimaria }}>
                  {viagem.duracao_noites}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">{i18n.noites}</div>
              </div>
            )}
            {viagem.destinos?.length > 0 && (
              <div className="px-6 py-4 rounded-xl bg-gray-50 border border-gray-100">
                <div className="text-2xl font-bold" style={{ color: corPrimaria }}>
                  {viagem.destinos.length}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Destinos</div>
              </div>
            )}
          </div>
        )}

        {/* Interest tags */}
        {tags.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {tags.map((tag, i) => (
              <span
                key={i}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: corPrimaria }}
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
