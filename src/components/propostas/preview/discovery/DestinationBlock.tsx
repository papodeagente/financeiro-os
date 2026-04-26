'use client';

import { useState } from 'react';
import type { DayGroup } from '@/lib/discovery-utils';
import { DayEntry } from './DayEntry';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { MapPin, Calendar, Moon, ChevronDown } from 'lucide-react';

const REGIME_KEYS: Record<string, keyof ReturnType<typeof t>> = {
  RO: 'regimeRO', BB: 'regimeBB', HB: 'regimeHB', FB: 'regimeFB', AI: 'regimeAI',
};

interface Props {
  group: DayGroup;
  index: number;
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 74, b: 173 };
}

function formatDateRange(checkIn?: string, checkOut?: string, idioma: IdiomaProposal = 'pt-BR'): string {
  if (!checkIn) return '';
  const locale = idioma === 'pt-BR' ? 'pt-BR' : idioma === 'es' ? 'es-ES' : 'en-US';
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  };
  if (!checkOut) return fmt(checkIn);
  return `${fmt(checkIn)} — ${fmt(checkOut)}`;
}

export function DestinationBlock({ group, index, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const aloj = group.alojamento;
  const { r, g, b } = hexToRgb(corPrimaria);
  const [hotelExpanded, setHotelExpanded] = useState(false);

  const dateRange = aloj ? formatDateRange(aloj.check_in, aloj.check_out, idioma) : '';
  const hasHero = group.destinoNome && (aloj?.hotel_imagem);

  return (
    <div className="mb-16">
      {/* Destination hero banner — image-led when image available */}
      {hasHero && aloj && (
        <div className="relative rounded-2xl overflow-hidden mb-6 group/hero">
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-1000 group-hover/hero:scale-105"
            style={{ backgroundImage: `url(${aloj.hotel_imagem})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
          <div
            className="absolute inset-0 mix-blend-multiply opacity-30"
            style={{ background: `linear-gradient(135deg, rgba(${r},${g},${b},0.6) 0%, transparent 60%)` }}
          />

          <div className="relative p-6 sm:p-8 min-h-[260px] flex flex-col justify-end text-white">
            {/* Number badge */}
            <div
              className="inline-flex items-center gap-2 self-start mb-3 px-3 py-1 rounded-full backdrop-blur-md text-[11px] font-bold uppercase tracking-widest border border-white/30 bg-white/10"
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span className="w-1 h-1 rounded-full bg-white/60" />
              <span>Destino</span>
            </div>

            <h3 className="text-2xl sm:text-4xl font-bold leading-tight tracking-tight">
              {group.destinoNome}
            </h3>

            {/* Meta strip */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/90">
              {dateRange && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {dateRange}
                </span>
              )}
              {aloj.noites ? (
                <span className="inline-flex items-center gap-1.5">
                  <Moon className="w-4 h-4" />
                  {aloj.noites} {i18n.noites}
                </span>
              ) : null}
              {group.dias.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {group.dias.length} {group.dias.length === 1 ? 'dia' : 'dias'} no roteiro
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fallback header (no image) */}
      {!hasHero && group.destinoNome && (
        <div className="mb-6 flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
            style={{ background: `linear-gradient(135deg, ${corPrimaria}, rgba(${r},${g},${b},0.8))` }}
          >
            {index + 1}
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
            {group.destinoNome}
          </h3>
          {dateRange && (
            <span className="text-sm text-gray-500 inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {dateRange}
            </span>
          )}
        </div>
      )}

      {/* Compact hotel card (collapsible details) */}
      {aloj && !aloj.viagem_noturna && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm mb-8">
          <button
            onClick={() => setHotelExpanded(e => !e)}
            className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 transition-colors"
          >
            {!hasHero && aloj.hotel_imagem && (
              <img
                src={aloj.hotel_imagem}
                alt={aloj.hotel_nome}
                className="w-20 h-20 rounded-xl object-cover shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-semibold text-gray-900 truncate">{aloj.hotel_nome}</h4>
                {aloj.hotel_estrelas ? (
                  <span className="text-amber-500 text-xs">{'★'.repeat(aloj.hotel_estrelas)}</span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                <span>{i18n.estadia}: {aloj.noites} {i18n.noites}</span>
                <span>{i18n.regime}: {i18n[REGIME_KEYS[aloj.regime] || 'regimeBB'] as string}</span>
                {aloj.quarto_tipo && <span>Quarto: {aloj.quarto_tipo}</span>}
              </div>
            </div>
            {aloj.hotel_descricao && (
              <ChevronDown
                className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${hotelExpanded ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          {hotelExpanded && aloj.hotel_descricao && (
            <div className="px-4 pb-4 pt-0 border-t border-gray-100 mt-1">
              <p className="text-sm text-gray-600 leading-relaxed pt-3">
                {aloj.hotel_descricao}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Days */}
      <div>
        {group.dias.map((day, i) => (
          <div key={day.numero} {...(i > 0 ? { 'data-pdf-break': true } : {})}>
            <DayEntry
              day={day}
              isLast={i === group.dias.length - 1}
              idioma={idioma}
              corPrimaria={corPrimaria}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
