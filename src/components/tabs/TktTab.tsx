'use client';

import { useState } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createTktTrecho } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcTktTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Plane } from 'lucide-react';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { formatFlightForTkt } from '@/lib/flight-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

export function TktTab({ grupo, onChange }: Props) {
  const totals = calcTktTotals(grupo);
  const [flightModalOpen, setFlightModalOpen] = useState<number | null>(null);

  const updateFonte = (trechoIdx: number, fonteIdx: number, field: string, value: number | null | string) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[trechoIdx] = {
      ...tkt.trechos[trechoIdx],
      fontes: [...tkt.trechos[trechoIdx].fontes],
    };
    tkt.trechos[trechoIdx].fontes[fonteIdx] = {
      ...tkt.trechos[trechoIdx].fontes[fonteIdx],
      [field]: value,
    };
    onChange({ ...grupo, tkt });
  };

  const updateDeadline = (trechoIdx: number, value: string | null) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[trechoIdx] = { ...tkt.trechos[trechoIdx], deadline: value };
    onChange({ ...grupo, tkt });
  };

  const addTrecho = () => {
    if (grupo.tkt.trechos.length < 4) {
      onChange({ ...grupo, tkt: { trechos: [...grupo.tkt.trechos, createTktTrecho()] } });
    }
  };

  const removeTrecho = (idx: number) => {
    onChange({ ...grupo, tkt: { trechos: grupo.tkt.trechos.filter((_, i) => i !== idx) } });
  };

  const handleFlightSelect = (trechoIdx: number, offer: FlightOffer) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[trechoIdx] = {
      ...tkt.trechos[trechoIdx],
      fontes: [...tkt.trechos[trechoIdx].fontes],
    };

    const mapped = formatFlightForTkt(offer, 0);
    const existingIdx = tkt.trechos[trechoIdx].fontes.findIndex(f => f.nome === 'API Amadeus');

    if (existingIdx >= 0) {
      tkt.trechos[trechoIdx].fontes[existingIdx] = {
        ...tkt.trechos[trechoIdx].fontes[existingIdx],
        partida_chegada: mapped.partida_chegada,
      };
    } else {
      tkt.trechos[trechoIdx].fontes.push({
        nome: mapped.nome,
        valor_adt: null,
        valor_chd: null,
        partida_chegada: mapped.partida_chegada,
      });
    }

    onChange({ ...grupo, tkt });
  };

  return (
    <div className="space-y-8">
      {/* Totals bar */}
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg flex flex-wrap gap-6">
        <div><span className="text-xs text-[var(--t-accent)]">Total TKT ADT</span><div className="text-lg font-bold">{formatBRL(totals.totalAdt)}</div></div>
        <div><span className="text-xs text-[var(--t-accent)]">Total TKT CHD</span><div className="text-lg font-bold">{formatBRL(totals.totalChd)}</div></div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addTrecho} disabled={grupo.tkt.trechos.length >= 4}>
          <Plus className="w-4 h-4 mr-1" /> Trecho
        </Button>
      </div>

      {grupo.tkt.trechos.map((trecho, tIdx) => {
        const infTrecho = grupo.trechos[tIdx];
        const melhorAdt = minPositivo(trecho.fontes.map(f => f.valor_adt));
        const melhorChd = minPositivo(trecho.fontes.map(f => f.valor_chd));

        return (
          <div key={tIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="font-semibold">Trecho {tIdx + 1}</span>
                {infTrecho && (
                  <span className="text-sm text-[var(--t-text-secondary)]">
                    ADT: {infTrecho.qtd_adt} | CHD: {infTrecho.qtd_chd}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setFlightModalOpen(tIdx)} className="text-blue-300 border-blue-300/30 hover:bg-[var(--t-blue-bg)]0/10 hover:text-blue-200">
                  <Plane className="w-4 h-4 mr-1" /> Buscar voo via API
                </Button>
                <Input type="date" value={trecho.deadline || ''} onChange={e => updateDeadline(tIdx, e.target.value || null)} className="h-8 w-40 bg-[var(--t-input-bg)] text-[var(--t-text)] border-[var(--t-border)]" />
                {grupo.tkt.trechos.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeTrecho(tIdx)} className="text-red-300 hover:text-red-100">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[var(--t-surface-hover)]">
                    <th className="p-2 text-left border">Fonte</th>
                    <th className="p-2 border w-40">Valor ADT</th>
                    <th className="p-2 border w-40">Valor CHD</th>
                    <th className="p-2 border">Partida/Chegada</th>
                  </tr>
                </thead>
                <tbody>
                  {trecho.fontes.map((fonte, fIdx) => {
                    const isMinAdt = fonte.valor_adt !== null && fonte.valor_adt > 0 && fonte.valor_adt === melhorAdt;
                    const isMinChd = fonte.valor_chd !== null && fonte.valor_chd > 0 && fonte.valor_chd === melhorChd;
                    return (
                      <tr key={fIdx} className={fonte.nome === 'API Amadeus' ? 'bg-[var(--t-blue-bg)]' : fIdx % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                        <td className={`p-2 border font-medium ${fonte.nome === 'API Amadeus' ? 'text-blue-700' : ''}`}>{fonte.nome}</td>
                        <td className="p-1 border">
                          <MoneyInput
                            value={fonte.valor_adt}
                            onChange={v => updateFonte(tIdx, fIdx, 'valor_adt', v)}
                            highlight={isMinAdt}
                          />
                        </td>
                        <td className="p-1 border">
                          <MoneyInput
                            value={fonte.valor_chd}
                            onChange={v => updateFonte(tIdx, fIdx, 'valor_chd', v)}
                            highlight={isMinChd}
                          />
                        </td>
                        <td className="p-1 border">
                          <Input
                            value={fonte.partida_chegada}
                            onChange={e => updateFonte(tIdx, fIdx, 'partida_chegada', e.target.value)}
                            className="h-8"
                            placeholder="GRU 10:00 → LIS 22:00"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {/* Best price row */}
                  <tr className="bg-green-100 font-bold">
                    <td className="p-2 border text-green-800">MELHOR R$</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorAdt)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorChd)}</td>
                    <td className="p-2 border"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Flight Search Modal */}
      <FlightSearchModal
        open={flightModalOpen !== null}
        onClose={() => setFlightModalOpen(null)}
        onSelect={(offer) => {
          if (flightModalOpen !== null) handleFlightSelect(flightModalOpen, offer);
        }}
        defaultDataIda={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.data || '' : ''}
        defaultAdultos={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.qtd_adt || 1 : 1}
        defaultCriancas={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.qtd_chd || 0 : 0}
      />
    </div>
  );
}
