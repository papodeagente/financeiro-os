'use client';

import { useState } from 'react';
import type { AlojamentoData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { HotelModal } from './HotelModal';

const REGIME_KEYS: Record<string, keyof ReturnType<typeof t>> = {
  RO: 'regimeRO', BB: 'regimeBB', HB: 'regimeHB', FB: 'regimeFB', AI: 'regimeAI',
};

const MARKER_COLORS = [
  '#004aad', '#0891b2', '#7c3aed', '#d97706', '#dc2626',
  '#059669', '#c026d3', '#0d9488', '#ea580c', '#4f46e5',
];

interface Props {
  alojamentos: AlojamentoData[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function formatDate(d: string, idioma: IdiomaProposal): string {
  if (!d) return '—';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: 'short' });
}

export function AccommodationSummary({ alojamentos, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const [selectedHotel, setSelectedHotel] = useState<AlojamentoData | null>(null);

  if (alojamentos.length === 0) return null;

  return (
    <>
      <section id="discovery-accommodations" className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.resumoAlojamentos}</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2" style={{ borderColor: corPrimaria }}>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.alojamento}</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.destino}</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.checkIn}</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.checkOut}</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">{i18n.estadia}</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.base}</th>
                </tr>
              </thead>
              <tbody>
                {alojamentos.map((a, i) => {
                  const regimeKey = REGIME_KEYS[a.regime] || 'regimeBB';
                  const regimeLabel = i18n[regimeKey] as string;
                  const markerColor = MARKER_COLORS[i % MARKER_COLORS.length];
                  const isClickable = !a.viagem_noturna && a.hotel_nome;

                  return (
                    <tr
                      key={a.id || i}
                      className={`border-b border-gray-100 transition-colors ${isClickable ? 'hover:bg-gray-100/70 cursor-pointer' : 'hover:bg-gray-100/50'}`}
                      onClick={() => isClickable && setSelectedHotel(a)}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: markerColor }}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <div>
                            <div className={`font-medium text-gray-900 ${isClickable ? 'underline decoration-dotted underline-offset-2' : ''}`}>
                              {a.viagem_noturna ? `✈ ${i18n.viagemNoturna}` : (a.hotel_nome || '—')}
                            </div>
                            {a.hotel_estrelas ? (
                              <div className="text-xs text-amber-500">{'★'.repeat(a.hotel_estrelas)}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-gray-600">{a.destino_nome || '—'}</td>
                      <td className="py-3 px-3 text-gray-600">{formatDate(a.check_in, idioma)}</td>
                      <td className="py-3 px-3 text-gray-600">{formatDate(a.check_out, idioma)}</td>
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                          {a.noites || 0} {i18n.noites}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-600">{regimeLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Regime legend */}
          <div className="mt-6 flex flex-wrap gap-4 text-xs text-gray-500">
            {Object.entries(REGIME_KEYS).map(([code, key]) => (
              <span key={code}>
                <strong>{code}</strong> = {i18n[key] as string}
              </span>
            ))}
          </div>
        </div>
      </section>

      {selectedHotel && (
        <HotelModal
          alojamento={selectedHotel}
          idioma={idioma}
          corPrimaria={corPrimaria}
          onClose={() => setSelectedHotel(null)}
        />
      )}
    </>
  );
}
