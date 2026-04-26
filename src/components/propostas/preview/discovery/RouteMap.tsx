'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { AlojamentoData, TransporteData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { MapPin, Calendar, Moon } from 'lucide-react';

const RouteMapInterno = dynamic(() => import('./RouteMapInterno'), {
  ssr: false,
  loading: () => (
    <div className="w-full bg-gray-100 rounded-[20px] flex items-center justify-center text-gray-400 text-sm" style={{ height: 560 }}>
      Carregando mapa...
    </div>
  ),
});

const PIN_COLORS = [
  '#004aad', '#0891b2', '#7c3aed', '#d97706', '#dc2626',
  '#059669', '#c026d3', '#0d9488', '#ea580c', '#4f46e5',
];

interface Props {
  alojamentos: AlojamentoData[];
  transportes: TransporteData[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function formatRangeShort(checkIn?: string, checkOut?: string, idioma: IdiomaProposal = 'pt-BR'): string {
  if (!checkIn) return '';
  const locale = idioma === 'pt-BR' ? 'pt-BR' : idioma === 'es' ? 'es-ES' : 'en-US';
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  };
  if (!checkOut) return fmt(checkIn);
  return `${fmt(checkIn)} — ${fmt(checkOut)}`;
}

export function RouteMap({ alojamentos, transportes, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const validAlojs = alojamentos.filter(a => a.lat && a.lng);
  if (validAlojs.length === 0) return null;

  return (
    <section id="discovery-map" className="py-16 bg-gray-50 relative" style={{ zIndex: 0 }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{i18n.mapaRota}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {validAlojs.length} destino{validAlojs.length === 1 ? '' : 's'} · clique nos itens ao lado para explorar
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-4">
          {/* Map */}
          <div className="rounded-[20px] overflow-hidden">
            <RouteMapInterno
              alojamentos={alojamentos}
              transportes={transportes}
              corPrimaria={corPrimaria}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
            />
          </div>

          {/* Side itinerary panel */}
          <aside
            className="bg-white rounded-[20px] border border-gray-200 overflow-hidden flex flex-col"
            style={{ maxHeight: 560 }}
          >
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Roteiro resumido</p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">
                {validAlojs.length} {validAlojs.length === 1 ? 'parada' : 'paradas'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {validAlojs.map((a, i) => {
                const color = PIN_COLORS[i % PIN_COLORS.length];
                const letter = String.fromCharCode(65 + i);
                const isSelected = selectedIndex === i;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedIndex(isSelected ? null : i)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition-all relative ${
                      isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {isSelected && (
                      <span
                        className="absolute left-0 top-0 bottom-0 w-1"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5 transition-transform"
                        style={{
                          backgroundColor: color,
                          transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                          boxShadow: isSelected ? `0 4px 12px ${color}60` : 'none',
                        }}
                      >
                        {letter}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {a.destino_nome}
                        </p>
                        {a.hotel_nome && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            <MapPin className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                            {a.hotel_nome}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-500">
                          {(a.check_in || a.check_out) && (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatRangeShort(a.check_in, a.check_out, idioma)}
                            </span>
                          )}
                          {a.noites ? (
                            <span className="inline-flex items-center gap-1">
                              <Moon className="w-3 h-3" />
                              {a.noites}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
