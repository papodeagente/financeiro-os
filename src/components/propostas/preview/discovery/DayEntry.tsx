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

  return (
    <div className="flex gap-4 group">
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 transition-transform group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${corPrimaria} 0%, rgba(${r},${g},${b},0.8) 100%)`,
            boxShadow: `0 4px 12px rgba(${r},${g},${b},0.3)`,
          }}
        >
          {day.numero}
        </div>
        {!isLast && (
          <div
            className="w-0.5 flex-1 mt-2 rounded-full"
            style={{ background: `linear-gradient(to bottom, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},0.05))` }}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-10">
        <h4 className="text-base sm:text-lg font-semibold text-gray-900 leading-snug">{day.titulo}</h4>

        {/* Action chips */}
        <div className="flex flex-wrap gap-2 mt-3">
          {day.checkIn && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
              <LogIn className="w-3 h-3" />
              {i18n.checkIn}: {day.checkIn.hotel_nome}
            </span>
          )}
          {day.checkOut && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-medium border border-orange-100">
              <LogOut className="w-3 h-3" />
              {i18n.checkOut}: {day.checkOut.hotel_nome}
            </span>
          )}
          {day.transports.map((tr, i) => {
            const Icon = tr.tipo === 'VOO' ? Plane : Bus;
            return (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-100">
                <Icon className="w-3 h-3" />
                {tr.origem} → {tr.destino}
              </span>
            );
          })}
        </div>

        {/* Description */}
        {day.descricao && (
          <p className="mt-4 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
            {day.descricao}
          </p>
        )}

        {/* Activities */}
        {day.atividades.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5" style={{ color: corPrimaria }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: corPrimaria }}>
                Experiências do dia
              </span>
            </div>
            <ul className="space-y-1.5">
              {day.atividades.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: corPrimaria }} />
                  <span className="leading-relaxed">{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Meals */}
        {day.refeicoes_inclusas && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500">
            <Utensils className="w-3 h-3" />
            <span>{day.refeicoes_inclusas}</span>
          </div>
        )}

        {/* Image */}
        {day.imagem && (
          <div className="mt-4 overflow-hidden rounded-xl group/img">
            <img
              src={day.imagem}
              alt={day.titulo}
              className="w-full max-w-md object-cover transition-transform duration-700 group-hover/img:scale-105"
              style={{ maxHeight: 240 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
