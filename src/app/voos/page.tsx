'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plane, Search, Loader2, ArrowRight, Clock, Luggage,
  ChevronDown, ChevronUp, Trophy, AlertCircle,
} from 'lucide-react';
import { AirportInput } from '@/components/AirportInput';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { formatIsoDuration } from '@/lib/flight-data-mapper';

function formatTime(dateStr: string) {
  return dateStr.split('T')[1]?.substring(0, 5) || '';
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function VoosPage() {
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [origemDisplay, setOrigemDisplay] = useState('');
  const [destinoDisplay, setDestinoDisplay] = useState('');
  const [dataIda, setDataIda] = useState('');
  const [dataVolta, setDataVolta] = useState('');
  const [adultos, setAdultos] = useState(1);
  const [criancas, setCriancas] = useState(0);
  const [classe, setClasse] = useState('economica');
  const [results, setResults] = useState<FlightOffer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);
  const [sortBy, setSortBy] = useState<'price' | 'duration'>('price');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const buscar = async () => {
    if (!origem || !destino || !dataIda) {
      setError('Preencha origem, destino e data de ida');
      return;
    }
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
      const offers = json.data?.data || [];
      setResults(offers);
      setCached(json.cached || false);
    } catch (e) {
      setError('Erro ao buscar voos');
    }
    setSearching(false);
  };

  const sorted = [...results].sort((a, b) => {
    if (sortBy === 'price') return parseFloat(a.price.grandTotal) - parseFloat(b.price.grandTotal);
    const durA = a.itineraries[0]?.duration || '';
    const durB = b.itineraries[0]?.duration || '';
    return durA.localeCompare(durB);
  });

  const getAdtPrice = (offer: FlightOffer) => {
    const adt = offer.travelerPricings?.find(t => t.travelerType === 'ADULT');
    return adt ? parseFloat(adt.price.total) : parseFloat(offer.price.grandTotal);
  };

  const getChdPrice = (offer: FlightOffer) => {
    const chd = offer.travelerPricings?.find(t => t.travelerType === 'CHILD');
    return chd ? parseFloat(chd.price.total) : 0;
  };

  const getBaggage = (offer: FlightOffer) => {
    const seg = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0];
    if (!seg?.includedCheckedBags) return 'Verificar';
    if (seg.includedCheckedBags.weight) return `${seg.includedCheckedBags.weight}${seg.includedCheckedBags.weightUnit || 'kg'}`;
    if (seg.includedCheckedBags.quantity) return `${seg.includedCheckedBags.quantity} mala(s)`;
    return 'Verificar';
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-2">
            <Plane className="w-6 h-6 text-[var(--t-green)]" />
            Buscar Voos
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Busque voos reais com preços via Amadeus
          </p>
        </div>

        {/* Search form */}
        <div className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AirportInput label="Origem" value={origemDisplay} onChange={(v, d) => { setOrigem(v); setOrigemDisplay(d); }} />
            <AirportInput label="Destino" value={destinoDisplay} onChange={(v, d) => { setDestino(v); setDestinoDisplay(d); }} />
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Ida</label>
              <input
                type="date"
                value={dataIda}
                onChange={e => setDataIda(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Volta (opcional)</label>
              <input
                type="date"
                value={dataVolta}
                onChange={e => setDataVolta(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Adultos</label>
              <input
                type="number"
                min={1}
                max={50}
                value={adultos}
                onChange={e => setAdultos(+e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Crianças</label>
              <input
                type="number"
                min={0}
                max={20}
                value={criancas}
                onChange={e => setCriancas(+e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Classe</label>
              <select
                value={classe}
                onChange={e => setClasse(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              >
                <option value="economica">Econômica</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="executiva">Executiva</option>
                <option value="primeira">Primeira</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={buscar}
                disabled={searching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 font-medium"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar voos
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 px-4 py-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--t-text-secondary)]">
                {results.length} resultado{results.length !== 1 ? 's' : ''} encontrado{results.length !== 1 ? 's' : ''}
                {cached && <span className="ml-2 text-xs text-amber-400">(cache)</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--t-text-muted)]">Ordenar:</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'price' | 'duration')}
                  className="px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-xs text-[var(--t-text)]"
                >
                  <option value="price">Menor preço</option>
                  <option value="duration">Menor duração</option>
                </select>
              </div>
            </div>

            {sorted.map((offer, idx) => {
              const expanded = expandedId === offer.id;
              const isBest = idx === 0 && sortBy === 'price';

              return (
                <div
                  key={offer.id}
                  className={`bg-[var(--t-surface)] rounded-xl border ${isBest ? 'border-[var(--t-green)]/50' : 'border-[var(--t-border)]'} overflow-hidden`}
                >
                  {isBest && (
                    <div className="bg-[var(--t-green)]/10 px-4 py-1.5 flex items-center gap-1.5 text-[var(--t-green)] text-xs font-medium">
                      <Trophy className="w-3.5 h-3.5" /> MELHOR PREÇO
                    </div>
                  )}

                  <div className="p-4 space-y-3">
                    {offer.itineraries.map((itin, iIdx) => {
                      const firstSeg = itin.segments[0];
                      const lastSeg = itin.segments[itin.segments.length - 1];
                      const stops = itin.segments.length - 1;
                      const stopAirports = stops > 0
                        ? itin.segments.slice(0, -1).map(s => s.arrival.iataCode).join(', ')
                        : null;

                      return (
                        <div key={iIdx} className="flex items-center gap-4">
                          <div className="text-xs text-[var(--t-text-muted)] w-10 shrink-0 font-medium">
                            {iIdx === 0 ? 'IDA' : 'VOLTA'}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-bold text-[var(--t-text)]">{firstSeg.carrierCode} {firstSeg.number}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-sm text-[var(--t-text)]">
                              <span className="font-mono">{firstSeg.departure.iataCode}</span>
                              <span>{formatTime(firstSeg.departure.at)}</span>
                              <span className="flex-1 flex items-center gap-1 text-xs text-[var(--t-text-muted)]">
                                <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                                {stops === 0 ? 'Direto' : `${stops} escala${stops > 1 ? 's' : ''} (${stopAirports})`}
                                <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                              </span>
                              <span className="font-mono">{lastSeg.arrival.iataCode}</span>
                              <span>{formatTime(lastSeg.arrival.at)}</span>
                              {formatDate(firstSeg.departure.at) !== formatDate(lastSeg.arrival.at) && (
                                <span className="text-xs text-amber-400">(+1)</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--t-text-muted)]">
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatIsoDuration(itin.duration)}</span>
                              <span className="flex items-center gap-1"><Luggage className="w-3 h-3" /> {getBaggage(offer)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Price */}
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--t-border)]">
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <span className="text-[var(--t-text-muted)] text-xs">ADT: </span>
                          <span className="text-[var(--t-text)] font-medium">
                            {offer.price.currency} {getAdtPrice(offer).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        {criancas > 0 && getChdPrice(offer) > 0 && (
                          <div>
                            <span className="text-[var(--t-text-muted)] text-xs">CHD: </span>
                            <span className="text-[var(--t-text)] font-medium">
                              {offer.price.currency} {getChdPrice(offer).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-[var(--t-text-muted)] text-xs">Total: </span>
                          <span className="text-[var(--t-green)] font-bold">
                            {offer.price.currency} {parseFloat(offer.price.grandTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setExpandedId(expanded ? null : offer.id)}
                        className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                      >
                        {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Menos</> : <><ChevronDown className="w-3.5 h-3.5" /> Detalhes</>}
                      </button>
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div className="mt-2 bg-[var(--t-bg)] rounded-lg p-3 text-xs text-[var(--t-text-secondary)] space-y-2">
                        {offer.itineraries.map((itin, iIdx) => (
                          <div key={iIdx}>
                            <div className="font-medium text-[var(--t-text)] mb-1">{iIdx === 0 ? 'Ida' : 'Volta'} — Segmentos:</div>
                            {itin.segments.map((seg, sIdx) => (
                              <div key={sIdx} className="flex items-center gap-2 ml-3 mb-1">
                                <span className="font-mono text-[var(--t-green)]">{seg.carrierCode}{seg.number}</span>
                                <span>{seg.departure.iataCode} {formatTime(seg.departure.at)}</span>
                                <ArrowRight className="w-3 h-3" />
                                <span>{seg.arrival.iataCode} {formatTime(seg.arrival.at)}</span>
                                <span className="text-[var(--t-text-muted)]">({formatIsoDuration(seg.duration)})</span>
                              </div>
                            ))}
                          </div>
                        ))}
                        <div className="mt-2 text-[10px] text-[var(--t-text-muted)]">
                          Preços fornecidos por Amadeus — valores indicativos sujeitos a alteração
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {searching && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--t-green)]" />
            <span className="text-sm text-[var(--t-text-secondary)]">Buscando voos...</span>
          </div>
        )}
      </div>
    </div>
  );
}
