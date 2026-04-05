'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Plane, Search } from 'lucide-react';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { formatFlightForProposta } from '@/lib/flight-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { BlockProps } from './types';

export function ServicoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { icone?: string; titulo?: string; descricao?: string; detalhes?: string[]; valor?: number; imagem?: string };
  const [flightModalOpen, setFlightModalOpen] = useState(false);

  const isFlightService = (c.icone || '').includes('✈');

  const handleFlightSelect = (ida: FlightOffer, volta?: FlightOffer) => {
    // Merge return data into the offer for the proposta format
    const combined: FlightOffer = volta
      ? { ...ida, returnFlights: volta.flights, returnDuration: volta.totalDuration, returnLayovers: volta.layovers }
      : ida;
    const mapped = formatFlightForProposta(combined);
    onChange({ ...conteudo, ...mapped });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-2">
        <Input
          value={c.icone || ''}
          onChange={e => onChange({ ...conteudo, icone: e.target.value })}
          placeholder="Icone"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-1"
        />
        <Input
          value={c.titulo || ''}
          onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
          placeholder="Ex: Voo Sao Paulo → Lisboa"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-5"
        />
      </div>

      {/* Buscar Voo via API — quando ícone é avião */}
      {isFlightService && (
        <button
          onClick={() => setFlightModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:border-blue-400 text-blue-400 text-xs font-medium transition-all"
        >
          <Plane className="w-4 h-4" />
          <Search className="w-3.5 h-3.5" />
          Buscar Voo na API
        </button>
      )}

      <textarea
        value={c.descricao || ''}
        onChange={e => onChange({ ...conteudo, descricao: e.target.value })}
        rows={2}
        placeholder="Descricao do servico..."
        className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
      />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={c.valor || ''}
          onChange={e => onChange({ ...conteudo, valor: Number(e.target.value) })}
          placeholder="Valor (R$)"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
        />
        <ImageUpload
          compact
          currentUrl={c.imagem}
          onUpload={urls => onChange({ ...conteudo, imagem: urls[0] })}
          onRemove={() => onChange({ ...conteudo, imagem: '' })}
        />
      </div>

      {/* Flight Search Modal */}
      {isFlightService && (
        <FlightSearchModal
          open={flightModalOpen}
          onClose={() => setFlightModalOpen(false)}
          onSelect={handleFlightSelect}
        />
      )}
    </div>
  );
}
