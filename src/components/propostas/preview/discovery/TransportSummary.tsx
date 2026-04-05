'use client';

import type { TransporteData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

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
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function FlightCard({ voo, idioma, cor }: { voo: TransporteData; idioma: IdiomaProposal; cor: string }) {
  const formattedDate = formatDate(voo.data, idioma);
  const isVolta = voo.detalhes?.startsWith('VOLTA');
  const label = isVolta ? 'VOLTA' : undefined;
  const stopsInfo = voo.detalhes?.replace(/^VOLTA \| /, '').split(' | ')[0] || '';

  return (
    <div className="rounded-xl overflow-hidden border-2 shadow-md" style={{ borderColor: cor }}>
      {/* Header — cor primaria */}
      <div className="text-white px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: cor }}>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1l5.7 3.3-1.8 1.8-2.5-.4c-.4-.1-.8.1-1 .4l-.2.3c-.2.3-.1.7.2.9l2.8 1.6 1.6 2.8c.2.3.6.4.9.2l.3-.2c.3-.2.5-.6.4-1l-.4-2.5 1.8-1.8 3.3 5.7c.2.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z" />
          </svg>
          <span className="font-bold text-sm tracking-wide truncate">{voo.companhia || 'Voo'}</span>
          {voo.numero_voo && <span className="font-mono text-sm opacity-80">{voo.numero_voo}</span>}
          {label && (
            <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">{label}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {formattedDate && <span className="text-xs opacity-70 capitalize">{formattedDate}</span>}
        </div>
      </div>

      {/* Route */}
      <div className="bg-white px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          {/* Departure */}
          <div className="text-center shrink-0">
            <div className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">{voo.origem || '---'}</div>
            {voo.horario_saida && (
              <div className="text-base sm:text-lg font-bold text-gray-700 mt-1">{voo.horario_saida}</div>
            )}
            <div className="text-[10px] sm:text-[11px] text-gray-400 uppercase tracking-wider mt-0.5">
              {idioma === 'en' ? 'Departure' : idioma === 'es' ? 'Salida' : 'Partida'}
            </div>
          </div>

          {/* Route line */}
          <div className="flex-1 flex flex-col items-center gap-1 min-w-0 px-1 sm:px-2">
            {voo.tempo_estimado && (
              <div className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: `${cor}12`, color: cor }}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                </svg>
                {voo.tempo_estimado}
              </div>
            )}
            <div className="flex items-center w-full">
              <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
              <div className="flex-1 relative h-[2px] mx-0.5">
                <div className="absolute inset-0 border-t-2 border-dashed" style={{ borderColor: `${cor}50` }} />
                <svg className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: cor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1l5.7 3.3-1.8 1.8-2.5-.4c-.4-.1-.8.1-1 .4l-.2.3c-.2.3-.1.7.2.9l2.8 1.6 1.6 2.8c.2.3.6.4.9.2l.3-.2c.3-.2.5-.6.4-1l-.4-2.5 1.8-1.8 3.3 5.7c.2.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z" />
                </svg>
              </div>
              <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
            </div>
            {stopsInfo && (
              <div className="text-[9px] sm:text-[10px] text-gray-500 text-center truncate max-w-full">{stopsInfo}</div>
            )}
          </div>

          {/* Arrival */}
          <div className="text-center shrink-0">
            <div className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">{voo.destino || '---'}</div>
            {voo.horario_chegada && (
              <div className="text-base sm:text-lg font-bold text-gray-700 mt-1">{voo.horario_chegada}</div>
            )}
            <div className="text-[10px] sm:text-[11px] text-gray-400 uppercase tracking-wider mt-0.5">
              {idioma === 'en' ? 'Arrival' : idioma === 'es' ? 'Llegada' : 'Chegada'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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

        {/* Flights */}
        {voos.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              ✈️ {i18n.voos}
            </h3>
            <div className="space-y-4">
              {voos.map((v, i) => (
                <FlightCard key={v.id || i} voo={v} idioma={idioma} cor={cor} />
              ))}
            </div>
          </div>
        )}

        {/* Other transports */}
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
