'use client';

import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  proposta: Proposta;
  slug: string;
  idioma: IdiomaProposal;
}

export function DiscoveryFooter({ proposta, idioma }: Props) {
  const i18n = t(idioma);
  const viagem = proposta.viagem;
  const rodape = proposta.rodape;

  return (
    <footer id="discovery-footer">
      {/* Contato do consultor — sem form duplicado. O unico CTA agora e
          o AceitarProposta logo acima (so 1 caminho pra converter:
          aceitar ou pedir alteracoes). */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h3 className="text-xl font-bold text-gray-900 mb-4">
            {i18n.entrarEmContato}
          </h3>
          {rodape.nome_vendedor && (
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm inline-block">
              <p className="font-semibold text-gray-900">{rodape.nome_vendedor}</p>
              {rodape.email_vendedor && (
                <p className="text-sm text-gray-500 mt-1">{rodape.email_vendedor}</p>
              )}
              <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                {rodape.whatsapp_vendedor && (
                  <a
                    href={`https://wa.me/${rodape.whatsapp_vendedor.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-medium transition-all hover:scale-105"
                    style={{ backgroundColor: '#25D366' }}
                  >
                    WhatsApp
                  </a>
                )}
                {rodape.telefone_vendedor && (
                  <span className="text-sm text-gray-500">{rodape.telefone_vendedor}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* About agency */}
      {viagem?.sobre_agencia && (
        <section className="py-12 bg-white">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{i18n.sobreAgencia}</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{viagem.sobre_agencia}</p>
          </div>
        </section>
      )}

      {/* Terms */}
      {viagem?.termos_condicoes && (
        <section className="py-12 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{i18n.termos}</h3>
            <div className="text-xs text-gray-500 leading-relaxed whitespace-pre-line">{viagem.termos_condicoes}</div>
          </div>
        </section>
      )}

      {/* Bottom bar */}
      <div className="py-8 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h3 className="text-lg font-bold mb-1">{proposta.cabecalho.titulo}</h3>
          {proposta.cabecalho.subtitulo && (
            <p className="text-gray-400 text-sm">{proposta.cabecalho.subtitulo}</p>
          )}
          {rodape.nome_vendedor && (
            <p className="mt-4 text-gray-400 text-sm">
              {i18n.conecteSe} {rodape.nome_vendedor}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
