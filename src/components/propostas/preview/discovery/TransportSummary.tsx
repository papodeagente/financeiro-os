'use client';

import type { TransporteData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { RichFlightCard } from '../RichFlightCard';

const TIPO_ICONS: Record<string, string> = {
  VOO: '✈️', TRANSFER: '🚐', TREM: '🚆', ONIBUS: '🚌', CARRO: '🚗', BARCO: '⛴️',
};

interface Props {
  transportes: TransporteData[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function formatDate(d: string, idioma: IdiomaProposal): string {
  if (!d) return '—';
  const date = new Date(d + 'T12:00:00');
  if (isNaN(date.getTime())) return '—';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return date.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export function TransportSummary({ transportes, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const cor = corPrimaria || '#3b82f6';

  if (transportes.length === 0) return null;

  const voos = transportes.filter(t => t.tipo === 'VOO');
  const outros = transportes.filter(t => t.tipo !== 'VOO');

  return (
    <section id="discovery-transport" className="py-16 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.resumoTransportes}</h2>

        {/* Voos — cartao rico com expansao */}
        {voos.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              ✈️ {i18n.voos}
            </h3>
            <div className="space-y-4">
              {voos.map((v, i) => (
                <RichFlightCard key={v.id || i} voo={v} idioma={idioma} corPrimaria={cor} />
              ))}
            </div>
          </div>
        )}

        {/* Outros transportes — transfer, trem, onibus, etc */}
        {outros.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              🚐 {i18n.transfers}
            </h3>
            <div className="space-y-3">
              {outros.map((tr, i) => (
                <div key={tr.id || i} className="flex items-center gap-4 p-4 sm:p-5 rounded-xl bg-gray-50 border border-gray-100 shadow-sm">
                  <span className="text-2xl sm:text-3xl">{TIPO_ICONS[tr.tipo] || '🚐'}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base sm:text-lg font-bold text-gray-900">{tr.origem || '?'} → {tr.destino || '?'}</h4>
                    <div className="flex flex-wrap gap-2 sm:gap-3 mt-1 text-xs sm:text-sm text-gray-500">
                      {tr.data && <span>{formatDate(tr.data, idioma)}</span>}
                      {tr.horario_saida && tr.horario_chegada && <span>{tr.horario_saida} → {tr.horario_chegada}</span>}
                      {tr.tempo_estimado && <span>{tr.tempo_estimado}</span>}
                      {tr.distancia_km ? <span>{tr.distancia_km} km</span> : null}
                    </div>
                    {tr.detalhes && <p className="text-xs sm:text-sm text-gray-500 mt-1">{tr.detalhes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
