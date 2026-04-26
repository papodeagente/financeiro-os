'use client';

import type { DayGroup } from '@/lib/discovery-utils';
import { DayEntry } from './DayEntry';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

const REGIME_KEYS: Record<string, keyof ReturnType<typeof t>> = {
  RO: 'regimeRO', BB: 'regimeBB', HB: 'regimeHB', FB: 'regimeFB', AI: 'regimeAI',
};

interface Props {
  group: DayGroup;
  index: number;
  idioma: IdiomaProposal;
  corPrimaria: string;
}

export function DestinationBlock({ group, index, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);
  const aloj = group.alojamento;

  return (
    <div className="mb-12">
      {/* Destination header */}
      {group.destinoNome && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: corPrimaria }}
            >
              {index + 1}
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
              {group.destinoNome}
            </h3>
          </div>

          {/* Hotel card */}
          {aloj && !aloj.viagem_noturna && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm mb-6">
              <div className="flex flex-col sm:flex-row">
                {aloj.hotel_imagem && (
                  <div className="sm:w-48 h-40 sm:h-auto shrink-0">
                    <img
                      src={aloj.hotel_imagem}
                      alt={aloj.hotel_nome}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{aloj.hotel_nome}</h4>
                    {aloj.hotel_estrelas ? (
                      <span className="text-amber-500 text-sm">{'★'.repeat(aloj.hotel_estrelas)}</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>{i18n.estadia}: {aloj.noites} {i18n.noites}</span>
                    <span>{i18n.regime}: {i18n[REGIME_KEYS[aloj.regime] || 'regimeBB'] as string}</span>
                    {aloj.quarto_tipo && <span>Quarto: {aloj.quarto_tipo}</span>}
                  </div>
                  {aloj.hotel_descricao && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">{aloj.hotel_descricao}</p>
                  )}
                </div>
              </div>
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
