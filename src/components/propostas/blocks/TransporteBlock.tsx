'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Plane, Search } from 'lucide-react';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { BlockProps } from './types';
import type { TransporteData, TipoTransporte } from '@/lib/crm-types';

const TIPOS: { id: TipoTransporte; label: string; icon: string }[] = [
  { id: 'VOO', label: 'Voo', icon: '✈️' },
  { id: 'TRANSFER', label: 'Transfer', icon: '🚐' },
  { id: 'TREM', label: 'Trem', icon: '🚆' },
  { id: 'ONIBUS', label: 'Onibus', icon: '🚌' },
  { id: 'CARRO', label: 'Carro', icon: '🚗' },
  { id: 'BARCO', label: 'Barco', icon: '⛴️' },
];

function extractTime(dateStr: string): string {
  return dateStr.split(' ')[1]?.substring(0, 5) || '';
}

function extractDate(dateStr: string): string {
  return dateStr.split(' ')[0] || '';
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function TransporteBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as Partial<TransporteData>;
  const [flightModalOpen, setFlightModalOpen] = useState(false);

  const update = (patch: Partial<TransporteData>) => {
    onChange({ ...conteudo, ...patch } as Record<string, unknown>);
  };

  const isVoo = c.tipo === 'VOO';

  const handleFlightSelect = (offer: FlightOffer) => {
    const firstSeg = offer.flights[0];
    const lastSeg = offer.flights[offer.flights.length - 1];
    const stops = offer.flights.length - 1;
    const layoverNames = offer.layovers?.map(l => l.id).join(', ') || '';
    const stopsStr = stops === 0 ? 'Voo direto' : `${stops} escala(s): ${layoverNames}`;

    update({
      tipo: 'VOO',
      data: extractDate(firstSeg.departure_airport.time || ''),
      origem: firstSeg.departure_airport.id,
      destino: lastSeg.arrival_airport.id,
      companhia: firstSeg.airline,
      numero_voo: firstSeg.flight_number,
      horario_saida: extractTime(firstSeg.departure_airport.time || ''),
      horario_chegada: extractTime(lastSeg.arrival_airport.time || ''),
      tempo_estimado: formatMinutes(offer.totalDuration),
      detalhes: `${stopsStr} | R$ ${offer.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Tipo</label>
          <select
            value={c.tipo || 'TRANSFER'}
            onChange={e => update({ tipo: e.target.value as TipoTransporte })}
            className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-2 py-2 text-sm"
          >
            {TIPOS.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Data</label>
          <Input
            type="date"
            value={c.data || ''}
            onChange={e => update({ data: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      {/* Buscar Voo via API — só quando tipo = VOO */}
      {isVoo && (
        <button
          onClick={() => setFlightModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:border-blue-400 text-blue-400 text-xs font-medium transition-all"
        >
          <Plane className="w-4 h-4" />
          <Search className="w-3.5 h-3.5" />
          Buscar Voo na API
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Origem</label>
          <Input
            value={c.origem || ''}
            onChange={e => update({ origem: e.target.value })}
            placeholder="Ex: GRU / Tel Aviv"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Destino</label>
          <Input
            value={c.destino || ''}
            onChange={e => update({ destino: e.target.value })}
            placeholder="Ex: TLV / Jerusalem"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      {isVoo && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Companhia</label>
            <Input
              value={c.companhia || ''}
              onChange={e => update({ companhia: e.target.value })}
              placeholder="LATAM, GOL..."
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Numero do voo</label>
            <Input
              value={c.numero_voo || ''}
              onChange={e => update({ numero_voo: e.target.value })}
              placeholder="LA8084"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Horario saida</label>
          <Input
            type="time"
            value={c.horario_saida || ''}
            onChange={e => update({ horario_saida: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Horario chegada</label>
          <Input
            type="time"
            value={c.horario_chegada || ''}
            onChange={e => update({ horario_chegada: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      {!isVoo && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Distancia (km)</label>
            <Input
              type="number"
              value={c.distancia_km || ''}
              onChange={e => update({ distancia_km: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="120"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Tempo estimado</label>
            <Input
              value={c.tempo_estimado || ''}
              onChange={e => update({ tempo_estimado: e.target.value })}
              placeholder="1h30"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
        </div>
      )}

      {isVoo && (
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Tempo estimado</label>
          <Input
            value={c.tempo_estimado || ''}
            onChange={e => update({ tempo_estimado: e.target.value })}
            placeholder="10h30"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      )}

      <div>
        <label className="text-[10px] text-[var(--t-text-muted)]">Detalhes</label>
        <textarea
          value={c.detalhes || ''}
          onChange={e => update({ detalhes: e.target.value })}
          rows={2}
          placeholder="Informacoes adicionais..."
          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
        />
      </div>

      {/* Flight Search Modal */}
      <FlightSearchModal
        open={flightModalOpen}
        onClose={() => setFlightModalOpen(false)}
        onSelect={handleFlightSelect}
        defaultOrigem={c.origem || ''}
        defaultDestino={c.destino || ''}
        defaultDataIda={c.data || ''}
      />
    </div>
  );
}
