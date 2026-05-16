'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function extTime(s: string): string { return s.split(' ')[1]?.substring(0, 5) || ''; }
function extDate(s: string): string { return s.split(' ')[0] || ''; }
function fmtDateShort(s: string): string {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

// ─── FLIGHT CARD ───
function FlightCard({ offer, selected, onSelect, label }: {
  offer: FlightOffer; selected: boolean; onSelect: () => void; label?: string;
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
      className={`w-full text-left rounded-xl border-2 transition-all duration-200 overflow-hidden
        ${selected
          ? 'border-blue-500 bg-[var(--t-surface)] shadow-lg ring-1 ring-blue-500/30'
          : 'border-[var(--t-border)] bg-[var(--t-surface)] hover:border-blue-400/50 hover:shadow-md'
        }`}
    >
      {/* Header */}
      <div className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-[var(--t-bg-secondary)] text-[var(--t-text)] border-[var(--t-border)]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {first.airline_logo && (
            <img src={first.airline_logo} alt="" className="w-5 h-5 rounded bg-white p-0.5 shrink-0" />
          )}
          <span className="font-bold text-sm truncate">{first.airline}</span>
          <span className={`font-mono text-xs ${selected ? 'text-blue-200' : 'text-[var(--t-text-muted)]'}`}>{first.flight_number}</span>
          {label && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${selected ? 'bg-white/20' : 'bg-blue-500/10 text-blue-400'}`}>{label}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] capitalize ${selected ? 'text-blue-200' : 'text-[var(--t-text-muted)]'}`}>
            {fmtDateShort(extDate(first.departure_airport.time || ''))}
          </span>
          <span className="font-bold text-base">R$ {offer.price.toLocaleString('pt-BR')}</span>
        </div>
      </div>

      {/* Route — responsive: stack on very small, inline on normal */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Departure */}
          <div className="text-center shrink-0">
            <div className="text-xl sm:text-2xl font-black tracking-tight text-[var(--t-text)]">{first.departure_airport.id}</div>
            <div className="text-base sm:text-lg font-bold text-[var(--t-text-secondary)]">{extTime(first.departure_airport.time || '')}</div>
            <div className="text-[9px] sm:text-[10px] text-[var(--t-text-muted)] truncate max-w-[80px] sm:max-w-[100px]">{first.departure_airport.name}</div>
          </div>

          {/* Route line */}
          <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className={`flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${selected ? 'bg-blue-500/10 text-blue-400' : 'bg-[var(--t-hover)] text-[var(--t-text-secondary)]'}`}>
              <Clock className="w-3 h-3 shrink-0" />
              {fmtMin(offer.totalDuration)}
            </div>
            <div className="flex items-center w-full">
              <div className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-blue-500' : 'bg-[var(--t-accent)]'}`} />
              <div className="flex-1 relative h-[2px] mx-0.5">
                <div className={`absolute inset-0 border-t-2 border-dashed ${selected ? 'border-blue-400/50' : 'border-[var(--t-border)]'}`} />
                {offer.layovers?.map((lay, idx) => (
                  <div key={idx}
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 border-2 border-[var(--t-surface)]"
                    style={{ left: `${((idx + 1) / (stops + 1)) * 100}%` }}
                    title={`${lay.name} (${fmtMin(lay.duration)})`}
                  />
                ))}
                <Plane className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 ${selected ? 'text-blue-500' : 'text-[var(--t-accent)]'}`} />
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-blue-500' : 'bg-[var(--t-accent)]'}`} />
            </div>
            <div className="text-[9px] sm:text-[10px] text-[var(--t-text-muted)]">
              {stops === 0
                ? <span className="text-emerald-500 font-semibold">Direto</span>
                : <span>{stops} escala{stops > 1 ? 's' : ''}{layoverNames ? `: ${layoverNames}` : ''}</span>
              }
            </div>
          </div>

          {/* Arrival */}
          <div className="text-center shrink-0">
            <div className="text-xl sm:text-2xl font-black tracking-tight text-[var(--t-text)]">{last.arrival_airport.id}</div>
            <div className="text-base sm:text-lg font-bold text-[var(--t-text-secondary)]">{extTime(last.arrival_airport.time || '')}</div>
            <div className="text-[9px] sm:text-[10px] text-[var(--t-text-muted)] truncate max-w-[80px] sm:max-w-[100px]">{last.arrival_airport.name}</div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1.5 mt-2.5 text-[10px] text-[var(--t-text-muted)] flex-wrap">
          {first.airplane && <span className="bg-[var(--t-hover)] px-1.5 py-0.5 rounded">{first.airplane}</span>}
          {first.travel_class && <span className="bg-[var(--t-hover)] px-1.5 py-0.5 rounded capitalize">{first.travel_class}</span>}
          {baggage && <span className="bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">{baggage}</span>}
          {first.legroom && <span className="bg-[var(--t-hover)] px-1.5 py-0.5 rounded">{first.legroom}</span>}
          {carbonExt && <span className="bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded">{carbonExt}</span>}
          {first.often_delayed_by_over_30_min && <span className="bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">Atrasos frequentes</span>}
          {stops > 0 && offer.layovers && (
            <span className="text-amber-500">
              {offer.layovers.map(l => `${l.id} (${fmtMin(l.duration)})`).join(' → ')}
            </span>
          )}
        </div>
      </div>

      {selected && (
        <div className="bg-blue-600 text-white text-center py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> Selecionado
        </div>
      )}
    </button>
  );
}

// ─── SELECTED SUMMARY ───
function SelectedSummary({ offer, label }: { offer: FlightOffer; label: string }) {
  const first = offer.flights[0];
  const last = offer.flights[offer.flights.length - 1];
  return (
    <div className="flex flex-wrap items-center gap-2 bg-blue-600 text-white rounded-lg px-3 py-2 text-sm">
      <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">{label}</span>
      {first.airline_logo && <img src={first.airline_logo} alt="" className="w-4 h-4 rounded bg-white p-0.5" />}
      <span className="font-medium">{first.airline} {first.flight_number}</span>
      <span>{first.departure_airport.id} {extTime(first.departure_airport.time || '')}</span>
      <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
      <span>{last.arrival_airport.id} {extTime(last.arrival_airport.time || '')}</span>
      <span className="text-xs opacity-70">{fmtMin(offer.totalDuration)}</span>
      <span className="ml-auto font-bold whitespace-nowrap">R$ {offer.price.toLocaleString('pt-BR')}</span>
    </div>
  );
}

// ─── MAIN ───
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
  const [searchParams, setSearchParams] = useState<{
    origem: string; destino: string; dataIda: string; dataVolta: string;
    adultos: number; criancas: number; classe: string;
  } | null>(null);

  // Reseta estado APENAS quando o modal abre. Antes ouvia as defaults —
  // que são literais inline no pai e mudam de referência a cada render,
  // causando reset do step/form/results no meio da interação (tremor).
  useEffect(() => {
    if (open) {
      setOrigem(defaultOrigem);
      setDestino(defaultDestino);
      setDataIda(defaultDataIda);
      setDataVolta(defaultDataVolta);
      setAdultos(defaultAdultos);
      setCriancas(defaultCriancas);
      setRoundTrip(!!defaultDataVolta);
      setStep('search');
      setIdaResults([]);
      setVoltaResults([]);
      setSelectedIda(null);
      setSelectedVolta(null);
      setError('');
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Trava scroll do body para o fundo não rolar e produzir tremor.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const reset = useCallback(() => {
    setStep('search');
    setIdaResults([]);
    setVoltaResults([]);
    setSelectedIda(null);
    setSelectedVolta(null);
    setError('');
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const buscarIda = async () => {
    if (!origem || !destino || !dataIda) { setError('Preencha origem, destino e data de ida'); return; }
    if (roundTrip && !dataVolta) { setError('Preencha a data de volta'); return; }
    setError('');
    setSearching(true);
    setIdaResults([]);

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
      if (offers.length === 0) setError('Nenhum voo encontrado para essa rota/data');
      setStep('select-ida');
    } catch { setError('Erro ao buscar voos'); }
    setSearching(false);
  };

  const handleSelectIda = async (offer: FlightOffer) => {
    setSelectedIda(offer);

    if (!roundTrip) {
      setStep('confirm');
      return;
    }

    // Fetch return flights
    setSearching(true);
    setError('');
    setVoltaResults([]);
    setStep('select-volta');

    try {
      const body: Record<string, unknown> = {
        origem: searchParams?.origem || origem,
        destino: searchParams?.destino || destino,
        data_ida: searchParams?.dataIda || dataIda,
        data_volta: searchParams?.dataVolta || dataVolta,
        adultos: searchParams?.adultos || adultos,
        criancas: searchParams?.criancas || criancas,
        classe: searchParams?.classe || classe,
      };

      // Use departure_token if available (better pricing), else fallback to reverse one-way
      if (offer.departureToken) {
        body.departure_token = offer.departureToken;
      } else {
        // Fallback: search reverse direction as one-way
        body.origem = searchParams?.destino || destino;
        body.destino = searchParams?.origem || origem;
        body.data_ida = searchParams?.dataVolta || dataVolta;
        delete body.data_volta;
      }

      const res = await fetch('/api/flights/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }

      const apiData = json.data || {};
      const offers = mapSearchAPIToOffers(apiData.best_flights, apiData.other_flights);
      setVoltaResults(offers);
      if (offers.length === 0) setError('Nenhum voo de volta encontrado');
    } catch { setError('Erro ao buscar voos de volta'); }
    setSearching(false);
  };

  const handleSelectVolta = (offer: FlightOffer) => {
    setSelectedVolta(offer);
    setStep('confirm');
  };

  const handleConfirm = () => {
    if (!selectedIda) return;
    onSelect(selectedIda, selectedVolta || undefined);
    onClose();
  };

  const closeModal = () => { onClose(); };

  // Portal no body — isolado de re-renders do pai (PropostaEditor/blocos).
  return createPortal((
    <div className="fixed inset-0 z-[60] flex flex-col">
      <div className="fixed inset-0 bg-black/70" onClick={closeModal} />
      <div className="relative flex-1 flex flex-col bg-[var(--t-surface)] m-2 sm:m-4 md:m-6 rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden z-10">

        {/* ─── TOP BAR ─── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[var(--t-border)] shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
              <Plane className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-[var(--t-text)] truncate">Buscar Voos</h2>
              {step !== 'search' && (
                <p className="text-[11px] text-[var(--t-text-muted)] truncate">
                  {step === 'select-ida' ? 'Selecione o voo de ida' :
                   step === 'select-volta' ? 'Selecione o voo de volta' :
                   'Confirmar selecao'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {step !== 'search' && (
              <button onClick={reset}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg text-[var(--t-text-muted)] hover:bg-[var(--t-hover)]">
                <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Nova busca</span>
              </button>
            )}
            <button onClick={closeModal}
              className="p-2 rounded-lg text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-hover)]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── SEARCH FORM ─── */}
        {step === 'search' && (
          <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)] shrink-0">
            {/* Trip type — toggle buttons grandes (substitui radios
                pequenos que passavam batido). Selecao clara antes de
                preencher os campos. */}
            <div className="inline-flex p-1 rounded-lg bg-[var(--t-input-bg)] border border-[var(--t-border)] mb-3">
              <button
                type="button"
                onClick={() => setRoundTrip(true)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  roundTrip
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
                }`}
                aria-pressed={roundTrip}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Ida e volta
              </button>
              <button
                type="button"
                onClick={() => setRoundTrip(false)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  !roundTrip
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
                }`}
                aria-pressed={!roundTrip}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Somente ida
              </button>
            </div>

            {/* Fields — grid se ajusta: 4 cols com Data Volta (round trip)
                ou 3 cols sem Data Volta (one way). */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${roundTrip ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-2 sm:gap-3`}>
              <AirportInput label="Origem" value={origem} onChange={(v) => setOrigem(v)} />
              <AirportInput label="Destino" value={destino} onChange={(v) => setDestino(v)} />
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data ida</label>
                <input type="date" value={dataIda} onChange={e => setDataIda(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              {roundTrip && (
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data volta</label>
                  <input type="date" value={dataVolta} onChange={e => setDataVolta(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--t-text-secondary)]">ADT</label>
                <input type="number" min={1} max={50} value={adultos} onChange={e => setAdultos(+e.target.value)}
                  className="w-14 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--t-text-secondary)]">CHD</label>
                <input type="number" min={0} max={20} value={criancas} onChange={e => setCriancas(+e.target.value)}
                  className="w-14 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
              </div>
              <select value={classe} onChange={e => setClasse(e.target.value)}
                className="px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]">
                <option value="economica">Economica</option>
                <option value="executiva">Executiva</option>
                <option value="primeira">Primeira</option>
                <option value="premium_economy">Premium</option>
              </select>
              <button onClick={buscarIda} disabled={searching}
                className="ml-auto flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold transition-colors">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
            </div>
            {error && <div className="text-red-400 text-sm mt-2 bg-red-500/10 px-3 py-2 rounded-lg">{error}</div>}
          </div>
        )}

        {/* ─── STICKY SUMMARY BARS ─── */}
        {selectedIda && step !== 'select-ida' && step !== 'search' && (
          <div className="px-4 sm:px-6 pt-3 pb-1 border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)] shrink-0">
            <SelectedSummary offer={selectedIda} label="IDA" />
            {selectedVolta && step === 'confirm' && (
              <div className="mt-2">
                <SelectedSummary offer={selectedVolta} label="VOLTA" />
              </div>
            )}
            <div className="h-2" />
          </div>
        )}

        {/* ─── RESULTS ─── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 min-h-0">
          {searching && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
              <span className="text-sm text-[var(--t-text-muted)]">
                {step === 'select-volta' ? 'Buscando voos de volta...' : 'Buscando voos...'}
              </span>
            </div>
          )}

          {step === 'search' && !searching && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--t-text-muted)]">
              <Plane className="w-10 h-10 opacity-20" />
              <span className="text-sm">Preencha os campos e clique em Buscar</span>
            </div>
          )}

          {/* IDA results */}
          {step === 'select-ida' && !searching && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0">1</span>
                  Voo de ida
                  <span className="text-[var(--t-text-muted)] font-normal text-xs">({idaResults.length})</span>
                </div>
                <button onClick={reset} className="text-[10px] text-[var(--t-text-muted)] hover:text-[var(--t-text)] flex items-center gap-1">
                  <Search className="w-3 h-3" /> Alterar
                </button>
              </div>
              {error && <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</div>}
              {idaResults.map(offer => (
                <FlightCard key={offer.id} offer={offer} selected={selectedIda?.id === offer.id}
                  onSelect={() => handleSelectIda(offer)} />
              ))}
            </div>
          )}

          {/* VOLTA results */}
          {step === 'select-volta' && !searching && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0">2</span>
                  Voo de volta
                  <span className="text-[var(--t-text-muted)] font-normal text-xs">({voltaResults.length})</span>
                </div>
                <button onClick={() => { setStep('select-ida'); setSelectedIda(null); setSelectedVolta(null); }}
                  className="text-[10px] text-[var(--t-text-muted)] hover:text-[var(--t-text)] flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Trocar ida
                </button>
              </div>
              {error && <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</div>}
              {voltaResults.map(offer => (
                <FlightCard key={offer.id} offer={offer} selected={selectedVolta?.id === offer.id}
                  onSelect={() => handleSelectVolta(offer)} />
              ))}
            </div>
          )}

          {/* CONFIRM */}
          {step === 'confirm' && !searching && (
            <div className="max-w-2xl mx-auto py-4 sm:py-6 space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-bold text-[var(--t-text)]">Confirmar selecao</h3>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                  {selectedVolta ? 'Ida e volta selecionados' : 'Voo de ida selecionado'}
                </p>
              </div>

              {selectedIda && <FlightCard offer={selectedIda} selected label="IDA" onSelect={() => {}} />}
              {selectedVolta && <FlightCard offer={selectedVolta} selected label="VOLTA" onSelect={() => {}} />}

              <div className="bg-[var(--t-bg-secondary)] rounded-xl px-4 py-3 text-center">
                <div className="text-xs text-[var(--t-text-muted)]">Total estimado por pessoa</div>
                <div className="text-2xl sm:text-3xl font-black text-[var(--t-text)] mt-0.5">
                  R$ {((selectedIda?.price || 0) + (selectedVolta?.price || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => {
                    if (selectedVolta) { setStep('select-volta'); setSelectedVolta(null); }
                    else { setStep('select-ida'); setSelectedIda(null); }
                  }}
                  className="px-4 py-2.5 text-sm rounded-lg border border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-hover)]"
                >
                  Voltar
                </button>
                <button onClick={handleConfirm}
                  className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-md flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Confirmar e importar
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="px-4 sm:px-6 py-1.5 border-t border-[var(--t-border)] text-[10px] text-[var(--t-text-muted)] shrink-0">
          Dados: Google Flights via SearchAPI
        </div>
      </div>
    </div>
  ), document.body);
}
