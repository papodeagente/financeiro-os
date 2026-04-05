'use client';

import { useState } from 'react';
import { Plane, Search, Loader2, Clock, X, Check, ArrowRight } from 'lucide-react';
import { AirportInput } from './AirportInput';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { mapSearchAPIToOffers } from '@/lib/flight-data-mapper';

interface FlightSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (offer: FlightOffer) => void;
  defaultOrigem?: string;
  defaultDestino?: string;
  defaultDataIda?: string;
  defaultDataVolta?: string;
  defaultAdultos?: number;
  defaultCriancas?: number;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function extractTime(dateStr: string): string {
  const parts = dateStr.split(' ');
  return parts[1]?.substring(0, 5) || '';
}

export function FlightSearchModal({
  open, onClose, onSelect,
  defaultOrigem = '', defaultDestino = '', defaultDataIda = '', defaultDataVolta = '',
  defaultAdultos = 1, defaultCriancas = 0,
}: FlightSearchModalProps) {
  const [origem, setOrigem] = useState(defaultOrigem);
  const [destino, setDestino] = useState(defaultDestino);
  const [dataIda, setDataIda] = useState(defaultDataIda);
  const [dataVolta, setDataVolta] = useState(defaultDataVolta);
  const [adultos, setAdultos] = useState(defaultAdultos);
  const [criancas, setCriancas] = useState(defaultCriancas);
  const [classe, setClasse] = useState('economica');
  const [results, setResults] = useState<FlightOffer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const buscar = async () => {
    if (!origem || !destino || !dataIda) { setError('Preencha origem, destino e data de ida'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      const res = await fetch('/api/flights/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origem, destino, data_ida: dataIda, data_volta: dataVolta || undefined, adultos, criancas, classe }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }

      // SearchAPI returns { data: { best_flights, other_flights, ... } }
      const apiData = json.data || {};
      const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
      setResults(offers);
      if (offers.length === 0) setError('Nenhum voo encontrado para essa rota/data');
    } catch { setError('Erro ao buscar voos'); }
    setSearching(false);
  };

  const handleSelect = (offer: FlightOffer) => {
    onSelect(offer);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--t-border)]">
          <h2 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2">
            <Plane className="w-5 h-5 text-[var(--t-green)]" />
            Buscar Voos
          </h2>
          <button onClick={onClose} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search form */}
        <div className="px-5 py-4 border-b border-[var(--t-border)]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AirportInput label="Origem" value={defaultOrigem} onChange={(v) => setOrigem(v)} />
            <AirportInput label="Destino" value={defaultDestino} onChange={(v) => setDestino(v)} />
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Ida</label>
              <input type="date" value={dataIda} onChange={e => setDataIda(e.target.value)} className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Volta</label>
              <input type="date" value={dataVolta} onChange={e => setDataVolta(e.target.value)} className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--t-text-secondary)]">ADT:</label>
              <input type="number" min={1} max={50} value={adultos} onChange={e => setAdultos(+e.target.value)} className="w-16 px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-sm text-[var(--t-text)]" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--t-text-secondary)]">CHD:</label>
              <input type="number" min={0} max={20} value={criancas} onChange={e => setCriancas(+e.target.value)} className="w-16 px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-sm text-[var(--t-text)]" />
            </div>
            <select value={classe} onChange={e => setClasse(e.target.value)} className="px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-sm text-[var(--t-text)]">
              <option value="economica">Econômica</option>
              <option value="executiva">Executiva</option>
              <option value="primeira">Primeira</option>
            </select>
            <button onClick={buscar} disabled={searching} className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
          {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
            </div>
          )}

          {results.length > 0 && (
            <div className="text-xs text-[var(--t-text-muted)] mb-2">{results.length} voo(s) encontrado(s)</div>
          )}

          {results.map(offer => {
            const firstSeg = offer.flights[0];
            const lastSeg = offer.flights[offer.flights.length - 1];
            const stops = offer.flights.length - 1;
            const layoverNames = offer.layovers?.map(l => l.id).join(', ');

            return (
              <div key={offer.id} className="bg-[var(--t-bg)] rounded-lg shadow-[var(--t-card-shadow)] p-3 hover:border-[var(--t-green)]/50 transition-colors">
                {/* Outbound */}
                <div className="flex items-center gap-3 mb-1.5">
                  {firstSeg.airline_logo && (
                    <img src={firstSeg.airline_logo} alt="" className="w-5 h-5 rounded" />
                  )}
                  <span className="text-[10px] font-medium text-[var(--t-text-muted)] w-10">IDA</span>
                  <span className="text-xs font-bold text-[var(--t-text)]">
                    {firstSeg.airline} {firstSeg.flight_number}
                  </span>
                  <span className="text-xs text-[var(--t-text)]">
                    {firstSeg.departure_airport.id} {extractTime(firstSeg.departure_airport.time || '')}
                  </span>
                  <span className="text-[10px] text-[var(--t-text-muted)] flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" />
                    {stops === 0 ? 'Direto' : `${stops}x (${layoverNames || ''})`}
                  </span>
                  <span className="text-xs text-[var(--t-text)]">
                    {lastSeg.arrival_airport.id} {extractTime(lastSeg.arrival_airport.time || '')}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--t-text-muted)]">
                    <Clock className="w-3 h-3" /> {formatMinutes(offer.totalDuration)}
                  </span>
                  {/* Extensions (baggage, etc) */}
                  {firstSeg.extensions && firstSeg.extensions.length > 0 && (
                    <span className="text-[10px] text-[var(--t-text-muted)]">
                      {firstSeg.extensions.slice(0, 2).join(' · ')}
                    </span>
                  )}
                </div>

                {/* Return flights if present */}
                {offer.returnFlights && offer.returnFlights.length > 0 && (() => {
                  const retFirst = offer.returnFlights[0];
                  const retLast = offer.returnFlights[offer.returnFlights.length - 1];
                  const retStops = offer.returnFlights.length - 1;
                  const retLayovers = offer.returnLayovers?.map(l => l.id).join(', ');
                  return (
                    <div className="flex items-center gap-3 mb-1.5">
                      {retFirst.airline_logo && (
                        <img src={retFirst.airline_logo} alt="" className="w-5 h-5 rounded" />
                      )}
                      <span className="text-[10px] font-medium text-[var(--t-text-muted)] w-10">VOLTA</span>
                      <span className="text-xs font-bold text-[var(--t-text)]">
                        {retFirst.airline} {retFirst.flight_number}
                      </span>
                      <span className="text-xs text-[var(--t-text)]">
                        {retFirst.departure_airport.id} {extractTime(retFirst.departure_airport.time || '')}
                      </span>
                      <span className="text-[10px] text-[var(--t-text-muted)] flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        {retStops === 0 ? 'Direto' : `${retStops}x (${retLayovers || ''})`}
                      </span>
                      <span className="text-xs text-[var(--t-text)]">
                        {retLast.arrival_airport.id} {extractTime(retLast.arrival_airport.time || '')}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[var(--t-text-muted)]">
                        <Clock className="w-3 h-3" /> {formatMinutes(offer.returnDuration || 0)}
                      </span>
                    </div>
                  );
                })()}

                {/* Price + select */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-bold text-[var(--t-green)]">
                    R$ {offer.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                  <button
                    onClick={() => handleSelect(offer)}
                    className="flex items-center gap-1 px-3 py-1 bg-[var(--t-green)]/10 text-[var(--t-green)] text-xs rounded hover:bg-[var(--t-green)]/20 font-medium"
                  >
                    <Check className="w-3 h-3" /> Selecionar
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-[var(--t-border)] text-[10px] text-[var(--t-text-muted)]">
          Dados fornecidos por Google Flights via SearchAPI
        </div>
      </div>
    </div>
  );
}
