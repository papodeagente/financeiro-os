'use client';

import { useEffect, useRef } from 'react';
import type { TransporteData } from '@/lib/crm-types';
import type { IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  voo: TransporteData;
  idioma: IdiomaProposal;
  corPrimaria: string;
  onClose: () => void;
}

function formatDate(d: string, idioma: IdiomaProposal): string {
  if (!d) return '—';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function parseDetails(detalhes?: string): { isVolta: boolean; stops: string; price: string; extras: string[] } {
  if (!detalhes) return { isVolta: false, stops: '', price: '', extras: [] };
  let raw = detalhes;
  const isVolta = raw.startsWith('VOLTA');
  if (isVolta) raw = raw.replace(/^VOLTA\s*\|\s*/, '');

  const parts = raw.split('|').map(s => s.trim());
  let stops = '';
  let price = '';
  const extras: string[] = [];

  for (const p of parts) {
    if (/R\$|USD|\$/.test(p)) price = p;
    else if (/direto|escala|stop|conex/i.test(p)) stops = p;
    else if (p) extras.push(p);
  }

  return { isVolta, stops, price, extras };
}

export function FlightDetailModal({ voo, idioma, corPrimaria, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { isVolta, stops, price, extras } = parseDetails(voo.detalhes);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleEsc); document.body.style.overflow = ''; };
  }, [onClose]);

  const labels = {
    pt: { flight: 'Detalhes do Voo', departure: 'Partida', arrival: 'Chegada', duration: 'Duração', date: 'Data', airline: 'Companhia', flightNo: 'Número do voo', type: 'Tipo', outbound: 'Ida', return: 'Volta', direct: 'Voo direto', connections: 'Conexões', price: 'Preço', info: 'Informações' },
    en: { flight: 'Flight Details', departure: 'Departure', arrival: 'Arrival', duration: 'Duration', date: 'Date', airline: 'Airline', flightNo: 'Flight number', type: 'Type', outbound: 'Outbound', return: 'Return', direct: 'Direct flight', connections: 'Connections', price: 'Price', info: 'Information' },
    es: { flight: 'Detalles del Vuelo', departure: 'Salida', arrival: 'Llegada', duration: 'Duración', date: 'Fecha', airline: 'Aerolínea', flightNo: 'Número de vuelo', type: 'Tipo', outbound: 'Ida', return: 'Vuelta', direct: 'Vuelo directo', connections: 'Conexiones', price: 'Precio', info: 'Información' },
  };
  const l = labels[idioma === 'en' ? 'en' : idioma === 'es' ? 'es' : 'pt'];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
        >
          ✕
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 rounded-t-2xl text-white" style={{ backgroundColor: corPrimaria }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">✈️</span>
            <h3 className="text-lg font-bold">{l.flight}</h3>
            {isVolta && (
              <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{l.return}</span>
            )}
          </div>
          {voo.data && <p className="text-sm opacity-80 capitalize">{formatDate(voo.data, idioma)}</p>}
        </div>

        {/* Route visualization */}
        <div className="px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            {/* Departure */}
            <div className="text-center">
              <div className="text-3xl font-black text-gray-900">{voo.origem}</div>
              {voo.horario_saida && (
                <div className="text-lg font-bold text-gray-700 mt-1">{voo.horario_saida}</div>
              )}
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-0.5">{l.departure}</div>
            </div>

            {/* Route line */}
            <div className="flex-1 flex flex-col items-center gap-1.5 px-2">
              {voo.tempo_estimado && (
                <div
                  className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ backgroundColor: `${corPrimaria}15`, color: corPrimaria }}
                >
                  {voo.tempo_estimado}
                </div>
              )}
              <div className="flex items-center w-full">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: corPrimaria }} />
                <div className="flex-1 h-0.5 mx-1" style={{ backgroundColor: `${corPrimaria}40` }}>
                  <div className="h-full border-t-2 border-dashed" style={{ borderColor: `${corPrimaria}60` }} />
                </div>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: corPrimaria }} />
              </div>
              {stops && (
                <div className="text-[10px] text-gray-500">{stops}</div>
              )}
            </div>

            {/* Arrival */}
            <div className="text-center">
              <div className="text-3xl font-black text-gray-900">{voo.destino}</div>
              {voo.horario_chegada && (
                <div className="text-lg font-bold text-gray-700 mt-1">{voo.horario_chegada}</div>
              )}
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-0.5">{l.arrival}</div>
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="px-6 pb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {voo.companhia && (
              <DetailRow icon="🏢" label={l.airline} value={voo.companhia} />
            )}
            {voo.numero_voo && (
              <DetailRow icon="🔢" label={l.flightNo} value={voo.numero_voo} />
            )}
            <DetailRow icon="🏷️" label={l.type} value={isVolta ? l.return : l.outbound} />
            {voo.tempo_estimado && (
              <DetailRow icon="⏱️" label={l.duration} value={voo.tempo_estimado} />
            )}
            {stops && (
              <DetailRow icon="🔄" label={l.connections} value={stops} />
            )}
            {price && (
              <DetailRow icon="💰" label={l.price} value={price} />
            )}
          </div>

          {extras.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1.5">{l.info}</div>
              <div className="flex flex-wrap gap-2">
                {extras.map((e, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{e}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50">
      <span className="text-sm">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
        <div className="text-sm font-medium text-gray-900">{value}</div>
      </div>
    </div>
  );
}
