'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plane, Search, Loader2, ArrowRight, Clock,
  ChevronDown, ChevronUp, Trophy, AlertCircle, Check, ArrowLeft,
} from 'lucide-react';
import { AirportInput } from '@/components/AirportInput';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { mapSearchAPIToOffers } from '@/lib/flight-data-mapper';
import { completeFlightHandoff, getActiveHandoffInfo } from '@/lib/api-search-handoff';

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function extractTime(dateStr: string): string {
  return dateStr.split(' ')[1]?.substring(0, 5) || '';
}

export default function VoosPage() {
  const searchParams = useSearchParams();
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
  const [selecting, setSelecting] = useState<string | null>(null);

  // Handoff vindo da tab do grupo
  const handoff = getActiveHandoffInfo();
  const isHandoff = !!handoff && !!handoff.returnTo;
  const autoRanRef = useRef(false);

  // Prefill via query params + auto-search uma vez quando todos os obrigatórios
  // estiverem presentes (origem + destino + ida).
  useEffect(() => {
    const o = searchParams.get('origem') || '';
    const d = searchParams.get('destino') || '';
    const ida = searchParams.get('ida') || '';
    const volta = searchParams.get('volta') || '';
    const ad = searchParams.get('adultos');
    const cr = searchParams.get('criancas');
    const cl = searchParams.get('classe') || '';
    if (o) { setOrigem(o); setOrigemDisplay(o); }
    if (d) { setDestino(d); setDestinoDisplay(d); }
    if (ida) setDataIda(ida);
    if (volta) setDataVolta(volta);
    if (ad) setAdultos(Math.max(1, parseInt(ad) || 1));
    if (cr) setCriancas(Math.max(0, parseInt(cr) || 0));
    if (cl) setClasse(cl);
    if (o && d && ida && !autoRanRef.current) {
      autoRanRef.current = true;
      setTimeout(() => buscarComArgs({
        origem: o, destino: d, dataIda: ida, dataVolta: volta,
        adultos: parseInt(ad || '1'), criancas: parseInt(cr || '0'), classe: cl || 'economica',
      }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscarComArgs = async (a: {
    origem: string; destino: string; dataIda: string; dataVolta?: string;
    adultos: number; criancas: number; classe: string;
  }) => {
    if (!a.origem || !a.destino || !a.dataIda) {
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
        body: JSON.stringify({ origem: a.origem, destino: a.destino, data_ida: a.dataIda, data_volta: a.dataVolta || undefined, adultos: a.adultos, criancas: a.criancas, classe: a.classe }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }
      const apiData = json.data || {};
      const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
      setResults(offers);
      setCached(json.cached || false);
      if (offers.length === 0) setError('Nenhum voo encontrado para essa rota/data');
    } catch {
      setError('Erro ao buscar voos');
    }
    setSearching(false);
  };

  const buscar = () => buscarComArgs({ origem, destino, dataIda, dataVolta, adultos, criancas, classe });

  const selecionarVoo = async (offer: FlightOffer) => {
    if (!handoff?.key || !handoff?.returnTo) return;
    setSelecting(offer.id);
    try {
      completeFlightHandoff(handoff.key, offer, handoff.returnTo);
    } finally {
      setSelecting(null);
    }
  };

  const sorted = [...results].sort((a, b) => {
    if (sortBy === 'price') return a.price - b.price;
    return a.totalDuration - b.totalDuration;
  });

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
            Busque voos reais com preços via Google Flights
          </p>
        </div>

        {/* Faixa de handoff — só aparece quando vindo de um grupo */}
        {isHandoff && handoff?.returnTo && (
          <div className="flex items-center justify-between gap-3 bg-[var(--t-green-bg)] border border-[var(--t-green)]/30 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-[var(--t-green)]">
              <Plane className="w-4 h-4 shrink-0" />
              <span>Selecione um voo para inserir no trecho. Companhia, horários, escalas e preço ficam salvos.</span>
            </div>
            <a
              href={handoff.returnTo}
              className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)] shrink-0"
            >
              <ArrowLeft className="w-3 h-3" /> Voltar sem selecionar
            </a>
          </div>
        )}

        {/* Search form */}
        <div className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AirportInput label="Origem" value={origemDisplay} onChange={(v, d) => { setOrigem(v); setOrigemDisplay(d); }} />
            <AirportInput label="Destino" value={destinoDisplay} onChange={(v, d) => { setDestino(v); setDestinoDisplay(d); }} />
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Ida</label>
              <input type="date" value={dataIda} onChange={e => setDataIda(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data Volta (opcional)</label>
              <input type="date" value={dataVolta} onChange={e => setDataVolta(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Adultos</label>
              <input type="number" min={1} max={50} value={adultos} onChange={e => setAdultos(+e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Crianças</label>
              <input type="number" min={0} max={20} value={criancas} onChange={e => setCriancas(+e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Classe</label>
              <select value={classe} onChange={e => setClasse(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]">
                <option value="economica">Econômica</option>
                <option value="executiva">Executiva</option>
                <option value="primeira">Primeira</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={buscar} disabled={searching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 font-medium">
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
                <select value={sortBy} onChange={e => setSortBy(e.target.value as 'price' | 'duration')}
                  className="px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-xs text-[var(--t-text)]">
                  <option value="price">Menor preço</option>
                  <option value="duration">Menor duração</option>
                </select>
              </div>
            </div>

            {sorted.map((offer, idx) => {
              const expanded = expandedId === offer.id;
              const isBest = idx === 0 && sortBy === 'price';
              const firstSeg = offer.flights[0];
              const lastSeg = offer.flights[offer.flights.length - 1];
              const stops = offer.flights.length - 1;
              const layoverNames = offer.layovers?.map(l => l.id).join(', ');

              return (
                <div key={offer.id}
                  className={`bg-[var(--t-surface)] rounded-xl border ${isBest ? 'border-[var(--t-green)]/50' : 'border-[var(--t-border)]'} overflow-hidden`}>
                  {isBest && (
                    <div className="bg-[var(--t-green)]/10 px-4 py-1.5 flex items-center gap-1.5 text-[var(--t-green)] text-xs font-medium">
                      <Trophy className="w-3.5 h-3.5" /> MELHOR PREÇO
                    </div>
                  )}

                  <div className="p-4 space-y-3">
                    {/* Outbound */}
                    <div className="flex items-center gap-4">
                      <div className="text-xs text-[var(--t-text-muted)] w-10 shrink-0 font-medium">IDA</div>
                      {firstSeg.airline_logo && <img src={firstSeg.airline_logo} alt="" className="w-6 h-6 rounded" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-bold text-[var(--t-text)]">{firstSeg.airline} {firstSeg.flight_number}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-sm text-[var(--t-text)]">
                          <span className="font-mono">{firstSeg.departure_airport.id}</span>
                          <span>{extractTime(firstSeg.departure_airport.time || '')}</span>
                          <span className="flex-1 flex items-center gap-1 text-xs text-[var(--t-text-muted)]">
                            <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                            {stops === 0 ? 'Direto' : `${stops} escala${stops > 1 ? 's' : ''} (${layoverNames})`}
                            <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                          </span>
                          <span className="font-mono">{lastSeg.arrival_airport.id}</span>
                          <span>{extractTime(lastSeg.arrival_airport.time || '')}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--t-text-muted)]">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatMinutes(offer.totalDuration)}</span>
                          {firstSeg.extensions && firstSeg.extensions.length > 0 && (
                            <span>{firstSeg.extensions.slice(0, 2).join(' · ')}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Return */}
                    {offer.returnFlights && offer.returnFlights.length > 0 && (() => {
                      const retFirst = offer.returnFlights[0];
                      const retLast = offer.returnFlights[offer.returnFlights.length - 1];
                      const retStops = offer.returnFlights.length - 1;
                      const retLayovers = offer.returnLayovers?.map(l => l.id).join(', ');
                      return (
                        <div className="flex items-center gap-4">
                          <div className="text-xs text-[var(--t-text-muted)] w-10 shrink-0 font-medium">VOLTA</div>
                          {retFirst.airline_logo && <img src={retFirst.airline_logo} alt="" className="w-6 h-6 rounded" />}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-bold text-[var(--t-text)]">{retFirst.airline} {retFirst.flight_number}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-sm text-[var(--t-text)]">
                              <span className="font-mono">{retFirst.departure_airport.id}</span>
                              <span>{extractTime(retFirst.departure_airport.time || '')}</span>
                              <span className="flex-1 flex items-center gap-1 text-xs text-[var(--t-text-muted)]">
                                <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                                {retStops === 0 ? 'Direto' : `${retStops} escala${retStops > 1 ? 's' : ''} (${retLayovers})`}
                                <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
                              </span>
                              <span className="font-mono">{retLast.arrival_airport.id}</span>
                              <span>{extractTime(retLast.arrival_airport.time || '')}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--t-text-muted)]">
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatMinutes(offer.returnDuration || 0)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Price */}
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--t-border)]">
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <span className="text-[var(--t-text-muted)] text-xs">Preço: </span>
                          <span className="text-[var(--t-green)] font-bold">
                            R$ {offer.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {isHandoff && (
                          <button
                            onClick={() => selecionarVoo(offer)}
                            disabled={selecting !== null}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                          >
                            {selecting === offer.id ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Selecionando...</>
                            ) : (
                              <><Check className="w-3.5 h-3.5" /> Selecionar este voo</>
                            )}
                          </button>
                        )}
                        <button onClick={() => setExpandedId(expanded ? null : offer.id)}
                          className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                          {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Menos</> : <><ChevronDown className="w-3.5 h-3.5" /> Detalhes</>}
                        </button>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div className="mt-2 bg-[var(--t-bg)] rounded-lg p-3 text-xs text-[var(--t-text-secondary)] space-y-2">
                        <div className="font-medium text-[var(--t-text)] mb-1">Segmentos:</div>
                        {offer.flights.map((seg, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2 ml-3 mb-1">
                            {seg.airline_logo && <img src={seg.airline_logo} alt="" className="w-4 h-4 rounded" />}
                            <span className="font-mono text-[var(--t-green)]">{seg.flight_number}</span>
                            <span>{seg.departure_airport.id} {extractTime(seg.departure_airport.time || '')}</span>
                            <ArrowRight className="w-3 h-3" />
                            <span>{seg.arrival_airport.id} {extractTime(seg.arrival_airport.time || '')}</span>
                            <span className="text-[var(--t-text-muted)]">({formatMinutes(seg.duration)})</span>
                            <span className="text-[var(--t-text-muted)]">{seg.airplane}</span>
                          </div>
                        ))}
                        {offer.layovers && offer.layovers.length > 0 && (
                          <div className="mt-1">
                            <span className="text-[var(--t-text-muted)]">Escalas: </span>
                            {offer.layovers.map((l, i) => (
                              <span key={i} className="text-[var(--t-text-muted)]">
                                {l.name} ({formatMinutes(l.duration)}){i < offer.layovers!.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 text-[10px] text-[var(--t-text-muted)]">
                          Dados fornecidos por Google Flights via SearchAPI — valores indicativos sujeitos a alteração
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
