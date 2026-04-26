'use client';

import type { DayInfo } from '@/lib/discovery-utils';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { Plane, Bus, Utensils, LogIn, LogOut, MapPin, Sparkles } from 'lucide-react';

interface Props {
  day: DayInfo;
  isLast: boolean;
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 74, b: 173 };
}

export function DayEntry({ day, isLast, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const { r, g, b } = hexToRgb(corPrimaria);

  // Alternate image side based on day number for Wetu-style flow
  const imageOnRight = day.numero % 2 === 1;
  const hasImage = !!day.imagem;

  return (
    <div className="relative group">
      {/* Timeline rail */}
      <div className="absolute left-5 sm:left-6 top-0 bottom-0 flex flex-col items-center pointer-events-none">
        <div
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white font-bold text-base sm:text-lg shrink-0 z-10 transition-transform group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${corPrimaria} 0%, rgba(${r},${g},${b},0.78) 100%)`,
            boxShadow: `0 6px 18px rgba(${r},${g},${b},0.4)`,
            border: '3px solid white',
          }}
        >
          {day.numero}
        </div>
        {!isLast && (
          <div
            className="w-0.5 flex-1 mt-1 rounded-full"
            style={{ background: `linear-gradient(to bottom, rgba(${r},${g},${b},0.35), rgba(${r},${g},${b},0.05))` }}
          />
        )}
      </div>

      {/* Content card */}
      <div className="ml-16 sm:ml-20 pb-12">
        <div
          className={`bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow ${
            hasImage ? 'sm:flex' : ''
          } ${hasImage && !imageOnRight ? 'sm:flex-row-reverse' : ''}`}
        >
          {/* Image */}
          {hasImage && (
            <div className="sm:w-[42%] sm:shrink-0 relative overflow-hidden">
              <div
                className="w-full h-56 sm:h-full bg-cover bg-center transition-transform duration-1000 group-hover:scale-105"
                style={{ backgroundImage: `url(${day.imagem})`, minHeight: 240 }}
              />
              {/* Day label overlay (visible on mobile/small images) */}
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest">
                Dia {day.numero}
              </div>
            </div>
          )}

          {/* Text */}
          <div className="p-5 sm:p-6 flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: corPrimaria }}
              >
                Dia {day.numero}
              </span>
              <span className="w-1 h-1 rounded-full bg-gray-300" />
              <span className="text-[11px] text-gray-400 uppercase tracking-wider">Roteiro</span>
            </div>

            <h4 className="text-lg sm:text-xl font-bold text-gray-900 leading-snug">
              {day.titulo}
            </h4>

            {/* Action chips */}
            {(day.checkIn || day.checkOut || day.transports.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {day.checkIn && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-100">
                    <LogIn className="w-3 h-3" />
                    {i18n.checkIn}: {day.checkIn.hotel_nome}
                  </span>
                )}
                {day.checkOut && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-[11px] font-medium border border-orange-100">
                    <LogOut className="w-3 h-3" />
                    {i18n.checkOut}: {day.checkOut.hotel_nome}
                  </span>
                )}
                {day.transports.map((tr, i) => {
                  const Icon = tr.tipo === 'VOO' ? Plane : Bus;
                  return (
                    <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-medium border border-blue-100">
                      <Icon className="w-3 h-3" />
                      {tr.origem} → {tr.destino}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Description */}
            {day.descricao && (
              <p className="mt-4 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {day.descricao}
              </p>
            )}

            {/* Activities */}
            {day.atividades.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: corPrimaria }} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: corPrimaria }}>
                    Experiências do dia
                  </span>
                </div>
                <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                  {day.atividades.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: corPrimaria }} />
                      <span className="leading-snug">{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Meals */}
            {day.refeicoes_inclusas && (
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
                <Utensils className="w-3 h-3" />
                <span className="font-medium">{day.refeicoes_inclusas}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
