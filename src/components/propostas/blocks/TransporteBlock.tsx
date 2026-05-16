'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Plane, Search } from 'lucide-react';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { formatFlightForTransporte } from '@/lib/flight-data-mapper';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import type { BlockProps } from './types';
import type { TransporteData, TipoTransporte } from '@/lib/crm-types';

// Voo foi separado em bloco dedicado 'VOO'. Aqui ficam só os transportes
// terrestres/marítimos. Bloco TRANSPORTE pré-existente com tipo='VOO' continua
// renderizando normal (back-compat), só não pode mais ser criado novo.
const TIPOS: { id: TipoTransporte; label: string; icon: string }[] = [
  { id: 'TRANSFER', label: 'Transfer', icon: '🚐' },
  { id: 'TREM', label: 'Trem', icon: '🚆' },
  { id: 'ONIBUS', label: 'Onibus', icon: '🚌' },
  { id: 'CARRO', label: 'Carro', icon: '🚗' },
  { id: 'BARCO', label: 'Barco', icon: '⛴️' },
];

/**
 * Converte um FlightOffer único (já sem returnFlights) em conteúdo de bloco TRANSPORTE.
 * Reaproveita o mapper completo passando uma cópia sem o return leg.
 */
function offerToTransporte(offer: FlightOffer, isVolta = false): Partial<TransporteData> {
  const oneWayOffer: FlightOffer = { ...offer, returnFlights: undefined, returnDuration: undefined, returnLayovers: undefined };
  const [conteudo] = formatFlightForTransporte(oneWayOffer) as unknown as Partial<TransporteData>[];
  if (isVolta) {
    conteudo.detalhes = `VOLTA | ${(conteudo.detalhes || '').replace(/^VOLTA \| /, '')}`;
  }
  return conteudo;
}

export function TransporteBlock({ conteudo, onChange, onInsertAfter }: BlockProps) {
  const c = conteudo as Partial<TransporteData>;
  const [flightModalOpen, setFlightModalOpen] = useState(false);

  const update = (patch: Partial<TransporteData>) => {
    onChange({ ...conteudo, ...patch } as Record<string, unknown>);
  };

  const isVoo = c.tipo === 'VOO';

  // Aplica voo da API direto neste bloco (caso 1-way) ou cria 2o bloco
  // VOLTA via onInsertAfter (caso round-trip). Preserva o id do bloco.
  const handleFlightSelect = (ida: FlightOffer, volta?: FlightOffer) => {
    const idaContent = offerToTransporte(ida, false);
    onChange({
      ...conteudo,
      ...idaContent,
      id: c.id || idaContent.id,
      tipo: 'VOO',
    } as Record<string, unknown>);
    if (volta && onInsertAfter) {
      const voltaContent = offerToTransporte(volta, true);
      onInsertAfter('TRANSPORTE', { ...voltaContent, tipo: 'VOO' } as Record<string, unknown>);
    }
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

      {/* Buscar Voo na API — modal in-place, atualiza ESTE bloco */}
      {isVoo && (
        <>
          <button
            onClick={() => setFlightModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:border-blue-400 text-blue-600 text-xs font-medium transition-all"
          >
            <Plane className="w-4 h-4" />
            <Search className="w-3.5 h-3.5" />
            {c.companhia ? 'Trocar voo (buscar de novo)' : 'Buscar Voo na API'}
          </button>
          <FlightSearchModal
            open={flightModalOpen}
            onClose={() => setFlightModalOpen(false)}
            onSelect={handleFlightSelect}
            defaultOrigem={c.origem || ''}
            defaultDestino={c.destino || ''}
            defaultDataIda={c.data || ''}
          />
        </>
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

    </div>
  );
}
