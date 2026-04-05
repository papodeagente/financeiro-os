'use client';

import { useState, useCallback } from 'react';
import { Plane, Search, Loader2, Clock, X, Check, ArrowRight, ArrowLeftRight, ChevronRight, RotateCcw } from 'lucide-react';
import { AirportInput } from './AirportInput';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { mapSearchAPIToOffers } from '@/lib/flight-data-mapper';

interface FlightSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (ida: FlightOffer, volta?: FlightOffer) => void;
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
  return dateStr.split(' ')[1]?.substring(0, 5) || '';
}

function extractDate(dateStr: string): string {
  return dateStr.split(' ')[0] || '';
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

// ─── FLIGHT CARD ───
function FlightCard({ offer, selected, onSelect, label }: {
  offer: FlightOffer;
  selected: boolean;
  onSelect: () => void;
  label?: string;
}) {
  const first = offer.flights[0];
  const last = offer.flights[offer.flights.length - 1];
  const stops = offer.flights.length - 1;
  const layoverNames = offer.layovers?.map(l => l.id).join(', ') || '';
  const baggage = first.extensions?.find(e => {
    const l = e.toLowerCase();
    return l.includes('bag') || l.includes('mala') || l.includes('checked') || l.includes('despacha');
  });
  const carbonExt = first.extensions?.find(e => e.toLowerCase().includes('co2') || e.toLowerCase().includes('carbon'));

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border-2 transition-all duration-200 overflow-hidden group
        ${selected
          ? 'border-blue-500 bg-blue-50/50 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/20'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md'
        }`}
    >
      {/* Header */}
      <div className={`px-5 py-3 flex items-center justify-between border-b ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-900 text-white border-gray-900'}`}>
        <div className="flex items-center gap-3">
          {first.airline_logo && (
            <img src={first.airline_logo} alt="" className="w-6 h-6 rounded bg-white p-0.5" />
          )}
          <span className="font-bold text-sm">{first.airline}</span>
          <span className={`font-mono text-sm ${selected ? 'text-blue-200' : 'text-sky-300'}`}>{first.flight_number}</span>
          {label && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selected ? 'bg-blue-500 text-white' : 'bg-sky-500/20 text-sky-300'}`}>{label}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs opacity-70 capitalize">{formatDateShort(extractDate(first.departure_airport.time || ''))}</span>
          <span className="font-bold text-lg">R$ {offer.price.toLocaleString('pt-BR')}</span>
        </div>
      </div>

      {/* Route */}
      <div className="px-5 py-5">
        <div className="flex items-center gap-4">
          {/* Departure */}
          <div className="text-center min-w-[80px]">
            <div className="text-2xl font-black tracking-tight text-gray-900">{first.departure_airport.id}</div>
            <div className="text-lg font-bold text-gray-700">{extractTime(first.departure_airport.time || '')}</div>
            <div className="text-[10px] text-gray-400 truncate max-w-[100px]">{first.departure_airport.name}</div>
          </div>

          {/* Route line */}
          <div className="flex-1 flex flex-col items-center gap-1 px-2">
            {/* Duration */}
            <div className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${selected ? 'bg-blue-100 text-blue-700' : 'bg-sky-50 text-sky-700'}`}>
              <Clock className="w-3 h-3" />
              {formatMinutes(offer.totalDuration)}
            </div>
            {/* Line with stops */}
            <div className="flex items-center w-full gap-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-blue-500' : 'bg-sky-500'}`} />
              <div className="flex-1 relative h-[2px]">
                <div className={`absolute inset-0 border-t-2 border-dashed ${selected ? 'border-blue-400' : 'border-sky-300'}`} />
                {/* Stop dots */}
                {offer.layovers?.map((lay, idx) => (
                  <div
                    key={idx}
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 border-2 border-white"
                    style={{ left: `${((idx + 1) / (stops + 1)) * 100}%` }}
                    title={`${lay.name} (${formatMinutes(lay.duration)})`}
                  />
                ))}
                <Plane className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 ${selected ? 'text-blue-500' : 'text-sky-500'}`} />
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-blue-500' : 'bg-sky-500'}`} />
            </div>
            {/* Stops info */}
            <div className="text-[10px] text-gray-500">
              {stops === 0 ? (
                <span className="text-emerald-600 font-semibold">Voo direto</span>
              ) : (
                <span>{stops} escala{stops > 1 ? 's' : ''}: <span className="font-medium">{layoverNames}</span></span>
              )}
            </div>
          </div>

          {/* Arrival */}
          <div className="text-center min-w-[80px]">
            <div className="text-2xl font-black tracking-tight text-gray-900">{last.arrival_airport.id}</div>
            <div className="text-lg font-bold text-gray-700">{extractTime(last.arrival_airport.time || '')}</div>
            <div className="text-[10px] text-gray-400 truncate max-w-[100px]">{last.arrival_airport.name}</div>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500 flex-wrap">
          {first.airplane && <span className="bg-gray-100 px-2 py-0.5 rounded">{first.airplane}</span>}
          {first.travel_class && <span className="bg-gray-100 px-2 py-0.5 rounded capitalize">{first.travel_class}</span>}
          {baggage && <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{baggage}</span>}
          {first.legroom && <span className="bg-gray-100 px-2 py-0.5 rounded">{first.legroom}</span>}
          {carbonExt && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">{carbonExt}</span>}
          {first.often_delayed_by_over_30_min && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded">Atrasos frequentes</span>}
          {/* Multi-segment details */}
          {stops > 0 && offer.layovers && (
            <span className="text-amber-600">
              Conexao: {offer.layovers.map(l => `${l.id} (${formatMinutes(l.duration)})`).join(' → ')}
            </span>
          )}
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="bg-blue-600 text-white text-center py-2 text-sm font-semibold flex items-center justify-center gap-2">
          <Check className="w-4 h-4" /> Selecionado
        </div>
      )}
    </button>
  );
}

// ─── SELECTED SUMMARY BAR ───
function SelectedSummary({ offer, label }: { offer: FlightOffer; label: string }) {
  const first = offer.flights[0];
  const last = offer.flights[offer.flights.length - 1];
  return (
    <div className="flex items-center gap-3 bg-blue-600 text-white rounded-xl px-4 py-3">
      <span className="text-xs font-bold bg-blue-500 px-2 py-0.5 rounded">{label}</span>
      {first.airline_logo && <img src={first.airline_logo} alt="" className="w-5 h-5 rounded bg-white p-0.5" />}
      <span className="font-medium text-sm">{first.airline} {first.flight_number}</span>
      <span className="text-sm">
        {first.departure_airport.id} {extractTime(first.departure_airport.time || '')}
      </span>
      <ArrowRight className="w-3 h-3 opacity-60" />
      <span className="text-sm">
        {last.arrival_airport.id} {extractTime(last.arrival_airport.time || '')}
      </span>
      <span className="text-xs opacity-70">{formatMinutes(offer.totalDuration)}</span>
      <span className="ml-auto font-bold">R$ {offer.price.toLocaleString('pt-BR')}</span>
    </div>
  );
}

// ─── MAIN MODAL ───
type Step = 'search' | 'select-ida' | 'select-volta' | 'confirm';

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
  const [roundTrip, setRoundTrip] = useState(!!defaultDataVolta);

  const [step, setStep] = useState<Step>('search');
  const [idaResults, setIdaResults] = useState<FlightOffer[]>([]);
  const [voltaResults, setVoltaResults] = useState<FlightOffer[]>([]);
  const [selectedIda, setSelectedIda] = useState<FlightOffer | null>(null);
  const [selectedVolta, setSelectedVolta] = useState<FlightOffer | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Store search params for return flight search
  const [searchParams, setSearchParams] = useState<{
    origem: string; destino: string; dataIda: string; dataVolta: string;
    adultos: number; criancas: number; classe: string;
  } | null>(null);

  const reset = useCallback(() => {
    setStep('search');
    setIdaResults([]);
    setVoltaResults([]);
    setSelectedIda(null);
    setSelectedVolta(null);
    setError('');
  }, []);

  if (!open) return null;

  const buscarIda = async () => {
    if (!origem || !destino || !dataIda) { setError('Preencha origem, destino e data de ida'); return; }
    if (roundTrip && !dataVolta) { setError('Preencha a data de volta'); return; }
    setError('');
    setSearching(true);

    const params = { origem, destino, dataIda, dataVolta: roundTrip ? dataVolta : '', adultos, criancas, classe };
    setSearchParams(params);

    try {
      const res = await fetch('/api/flights/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origem, destino, data_ida: dataIda,
          data_volta: roundTrip ? dataVolta : undefined,
          adultos, criancas, classe,
        }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }

      const apiData = json.data || {};
      const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
      setIdaResults(offers);
      if (offers.length === 0) { setError('Nenhum voo encontrado'); }
      setStep('select-ida');
    } catch { setError('Erro ao buscar voos'); }
    setSearching(false);
  };

  const handleSelectIda = async (offer: FlightOffer) => {
    setSelectedIda(offer);

    if (!roundTrip) {
      // One-way: go straight to confirm
      setStep('confirm');
      return;
    }

    // Round-trip: fetch return flights using departure_token
    if (offer.departureToken && searchParams) {
      setSearching(true);
      setError('');
      try {
        const res = await fetch('/api/flights/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origem: searchParams.origem,
            destino: searchParams.destino,
            data_ida: searchParams.dataIda,
            data_volta: searchParams.dataVolta,
            adultos: searchParams.adultos,
            criancas: searchParams.criancas,
            classe: searchParams.classe,
            departure_token: offer.departureToken,
          }),
        });
        const json = await res.json();
        if (json.error) { setError(json.error); setSearching(false); setStep('select-volta'); return; }

        const apiData = json.data || {};
        const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
        setVoltaResults(offers);
        if (offers.length === 0) setError('Nenhum voo de volta encontrado');
      } catch { setError('Erro ao buscar voos de volta'); }
      setSearching(false);
    } else {
      // No departure_token: search return as separate one-way
      setSearching(true);
      setError('');
      try {
        const res = await fetch('/api/flights/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origem: destino, destino: origem,
            data_ida: dataVolta,
            adultos, criancas, classe,
          }),
        });
        const json = await res.json();
        if (json.error) { setError(json.error); setSearching(false); setStep('select-volta'); return; }

        const apiData = json.data || {};
        const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
        setVoltaResults(offers);
        if (offers.length === 0) setError('Nenhum voo de volta encontrado');
      } catch { setError('Erro ao buscar voos de volta'); }
      setSearching(false);
    }
    setStep('select-volta');
  };

  const handleSelectVolta = (offer: FlightOffer) => {
    setSelectedVolta(offer);
    setStep('confirm');
  };

  const handleConfirm = () => {
    if (selectedIda) {
      onSelect(selectedIda, selectedVolta || undefined);
      onClose();
      reset();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex-1 flex flex-col bg-[var(--t-surface)] m-3 md:m-6 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── TOP BAR ─── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--t-border)] bg-[var(--t-surface)]">
          <h2 className="text-xl font-bold text-[var(--t-text)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Plane className="w-5 h-5 text-blue-500" />
            </div>
            Buscar Voos
            {step !== 'search' && (
              <span className="text-sm font-normal text-[var(--t-text-muted)]">
                {step === 'select-ida' ? '— Selecione o voo de ida' :
                 step === 'select-volta' ? '— Selecione o voo de volta' :
                 '— Confirmar selecao'}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {step !== 'search' && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg text-[var(--t-text-secondary)] hover:bg-[var(--t-hover)] transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Nova busca
              </button>
            )}
            <button onClick={() => { onClose(); reset(); }} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] p-2 rounded-lg hover:bg-[var(--t-hover)]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── SEARCH FORM ─── */}
        {step === 'search' && (
          <div className="px-6 py-6 border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)]">
            {/* Trip type toggle */}
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={roundTrip} onChange={() => setRoundTrip(true)}
                  className="accent-blue-500" />
                <ArrowLeftRight className="w-4 h-4 text-[var(--t-text-secondary)]" />
                <span className="text-sm text-[var(--t-text)]">Ida e volta</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!roundTrip} onChange={() => setRoundTrip(false)}
                  className="accent-blue-500" />
                <ArrowRight className="w-4 h-4 text-[var(--t-text-secondary)]" />
                <span className="text-sm text-[var(--t-text)]">Somente ida</span>
              </label>
            </div>

            {/* Search fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AirportInput label="Origem" value={defaultOrigem} onChange={(v) => setOrigem(v)} />
              <AirportInput label="Destino" value={defaultDestino} onChange={(v) => setDestino(v)} />
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data ida</label>
                <input type="date" value={dataIda} onChange={e => setDataIda(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data volta</label>
                <input type="date" value={dataVolta} onChange={e => setDataVolta(e.target.value)}
                  disabled={!roundTrip}
                  className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] disabled:opacity-40" />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--t-text-secondary)]">Adultos</label>
                <input type="number" min={1} max={50} value={adultos} onChange={e => setAdultos(+e.target.value)}
                  className="w-16 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--t-text-secondary)]">Criancas</label>
                <input type="number" min={0} max={20} value={criancas} onChange={e => setCriancas(+e.target.value)}
                  className="w-16 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              <select value={classe} onChange={e => setClasse(e.target.value)}
                className="px-3 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]">
                <option value="economica">Economica</option>
                <option value="executiva">Executiva</option>
                <option value="primeira">Primeira Classe</option>
                <option value="premium_economy">Premium Economy</option>
              </select>
              <button onClick={buscarIda} disabled={searching}
                className="ml-auto flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold transition-colors shadow-md">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar voos
              </button>
            </div>
            {error && <div className="text-red-400 text-sm mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</div>}
          </div>
        )}

        {/* ─── SELECTED IDA BAR (shown during volta/confirm steps) ─── */}
        {selectedIda && step !== 'select-ida' && step !== 'search' && (
          <div className="px-6 py-3 border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)]">
            <SelectedSummary offer={selectedIda} label="IDA" />
          </div>
        )}

        {/* ─── SELECTED VOLTA BAR (shown during confirm) ─── */}
        {selectedVolta && step === 'confirm' && (
          <div className="px-6 pb-3 border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)]">
            <SelectedSummary offer={selectedVolta} label="VOLTA" />
          </div>
        )}

        {/* ─── RESULTS AREA ─── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Loading */}
          {searching && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="text-sm text-[var(--t-text-muted)]">
                {step === 'select-volta' || (selectedIda && roundTrip) ? 'Buscando voos de volta...' : 'Buscando voos...'}
              </span>
            </div>
          )}

          {/* Idle search */}
          {step === 'search' && !searching && idaResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--t-text-muted)]">
              <Plane className="w-12 h-12 opacity-20" />
              <span className="text-sm">Preencha os campos e clique em Buscar</span>
            </div>
          )}

          {/* ─── IDA RESULTS ─── */}
          {step === 'select-ida' && !searching && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[var(--t-text)] flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">1</span>
                  Selecione o voo de ida
                  <span className="text-[var(--t-text-muted)] font-normal">({idaResults.length} opcoes)</span>
                </h3>
                <button onClick={reset}
                  className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text)] flex items-center gap-1">
                  <Search className="w-3 h-3" /> Alterar busca
                </button>
              </div>
              {error && <div className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</div>}
              {idaResults.map(offer => (
                <FlightCard
                  key={offer.id}
                  offer={offer}
                  selected={selectedIda?.id === offer.id}
                  onSelect={() => handleSelectIda(offer)}
                />
              ))}
            </div>
          )}

          {/* ─── VOLTA RESULTS ─── */}
          {step === 'select-volta' && !searching && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[var(--t-text)] flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">2</span>
                  Selecione o voo de volta
                  <span className="text-[var(--t-text-muted)] font-normal">({voltaResults.length} opcoes)</span>
                </h3>
                <button onClick={() => { setStep('select-ida'); setSelectedIda(null); setSelectedVolta(null); }}
                  className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text)] flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Trocar voo de ida
                </button>
              </div>
              {error && <div className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</div>}
              {voltaResults.map(offer => (
                <FlightCard
                  key={offer.id}
                  offer={offer}
                  selected={selectedVolta?.id === offer.id}
                  onSelect={() => handleSelectVolta(offer)}
                />
              ))}
            </div>
          )}

          {/* ─── CONFIRM STEP ─── */}
          {step === 'confirm' && !searching && (
            <div className="max-w-2xl mx-auto py-8 space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-bold text-[var(--t-text)]">Confirmar selecao</h3>
                <p className="text-sm text-[var(--t-text-muted)] mt-1">
                  {selectedVolta ? 'Voo de ida e volta selecionados' : 'Voo de ida selecionado'}
                </p>
              </div>

              {/* IDA card */}
              {selectedIda && (
                <FlightCard offer={selectedIda} selected label="IDA" onSelect={() => {}} />
              )}

              {/* VOLTA card */}
              {selectedVolta && (
                <FlightCard offer={selectedVolta} selected label="VOLTA" onSelect={() => {}} />
              )}

              {/* Total */}
              <div className="bg-[var(--t-bg-secondary)] rounded-xl p-4 text-center">
                <span className="text-sm text-[var(--t-text-muted)]">Total estimado</span>
                <div className="text-3xl font-black text-[var(--t-text)]">
                  R$ {((selectedIda?.price || 0) + (selectedVolta?.price || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
                <span className="text-xs text-[var(--t-text-muted)]">por pessoa</span>
              </div>

              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => {
                    if (selectedVolta) { setStep('select-volta'); setSelectedVolta(null); }
                    else { setStep('select-ida'); setSelectedIda(null); }
                  }}
                  className="px-6 py-3 text-sm rounded-xl border border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-hover)]"
                >
                  Voltar
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-8 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Confirmar e importar
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="px-6 py-2 border-t border-[var(--t-border)] text-[10px] text-[var(--t-text-muted)] flex items-center justify-between">
          <span>Dados fornecidos por Google Flights via SearchAPI</span>
          {(step === 'select-ida' || step === 'select-volta') && (
            <span className="text-[var(--t-text-secondary)]">
              Clique em um voo para selecionar
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
