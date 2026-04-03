'use client';

import type { DayInfo } from '@/lib/discovery-utils';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  day: DayInfo;
  isLast: boolean;
  idioma: IdiomaProposal;
  corPrimaria: string;
}

export function DayEntry({ day, isLast, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);

  return (
    <div className="flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: corPrimaria }}
        >
          {day.numero}
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-2" />}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-8 ${isLast ? '' : ''}`}>
        <h4 className="text-base font-semibold text-gray-900">{day.titulo}</h4>

        {/* Action badges */}
        <div className="flex flex-wrap gap-2 mt-2">
          {day.checkIn && (
            <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
              {i18n.checkIn}: {day.checkIn.hotel_nome}
            </span>
          )}
          {day.checkOut && (
            <span className="px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-medium">
              {i18n.checkOut}: {day.checkOut.hotel_nome}
            </span>
          )}
          {day.transports.map((tr, i) => (
            <span key={i} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
              {tr.tipo === 'VOO' ? '✈️' : '🚐'} {tr.origem} → {tr.destino}
            </span>
          ))}
        </div>

        {/* Description */}
        {day.descricao && (
          <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
            {day.descricao}
          </p>
        )}

        {/* Activities */}
        {day.atividades.length > 0 && (
          <ul className="mt-3 space-y-1">
            {day.atividades.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: corPrimaria }} />
                {a}
              </li>
            ))}
          </ul>
        )}

        {/* Meals */}
        {day.refeicoes_inclusas && (
          <p className="mt-2 text-xs text-gray-500">
            🍽️ {day.refeicoes_inclusas}
          </p>
        )}

        {/* Image */}
        {day.imagem && (
          <img
            src={day.imagem}
            alt={day.titulo}
            className="mt-4 w-full max-w-md rounded-xl object-cover"
            style={{ maxHeight: 220 }}
          />
        )}
      </div>
    </div>
  );
}
