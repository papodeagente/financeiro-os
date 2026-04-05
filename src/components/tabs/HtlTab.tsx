'use client';

import { useState } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createHtlHotel } from '@/lib/defaults';
import { minPositivo, formatBRL, calcDiarias } from '@/lib/utils';
import { calcHtlTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Hotel, Trophy, ChevronDown, ChevronUp, MapPin, Clock } from 'lucide-react';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatHotelForHtlInfo } from '@/lib/hotel-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const TIPO_LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

export function HtlTab({ grupo, onChange }: Props) {
  const totals = calcHtlTotals(grupo);
  const [hotelModalOpen, setHotelModalOpen] = useState<number | null>(null);
  const [expandedInfo, setExpandedInfo] = useState<Record<number, boolean>>({});

  const updateFonte = (hotelIdx: number, fonteIdx: number, field: string, value: number | null | string) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], fontes: [...htl.hoteis[hotelIdx].fontes] };
    htl.hoteis[hotelIdx].fontes[fonteIdx] = { ...htl.hoteis[hotelIdx].fontes[fonteIdx], [field]: value };
    onChange({ ...grupo, htl });
  };

  const updateInfo = (hotelIdx: number, field: string, value: string | null) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], info: { ...htl.hoteis[hotelIdx].info, [field]: value } };
    onChange({ ...grupo, htl });
  };

  const addHotel = () => {
    if (grupo.htl.hoteis.length < 10) {
      onChange({ ...grupo, htl: { hoteis: [...grupo.htl.hoteis, createHtlHotel()] } });
    }
  };

  const removeHotel = (idx: number) => {
    onChange({ ...grupo, htl: { hoteis: grupo.htl.hoteis.filter((_, i) => i !== idx) } });
  };

  const handleHotelSelect = (hotelIdx: number, place: GooglePlace) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], info: { ...htl.hoteis[hotelIdx].info } };
    const info = htl.hoteis[hotelIdx].info;
    const mapped = formatHotelForHtlInfo(place);
    if (!info.estacionamento && mapped.estacionamento) info.estacionamento = mapped.estacionamento;
    if (mapped.info_adicional) {
      info.info_adicional = info.info_adicional
        ? `${info.info_adicional}\n\n${mapped.info_adicional}`
        : mapped.info_adicional;
    }
    onChange({ ...grupo, htl });
  };

  return (
    <div className="space-y-6">
      {/* Summary totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {TIPOS.map(t => (
          <div key={t} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total {TIPO_LABELS[t]}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totals[t])}</div>
          </div>
        ))}
      </div>

      {/* Add hotel button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addHotel} disabled={grupo.htl.hoteis.length >= 10}>
          <Plus className="w-4 h-4 mr-1" /> Hotel
        </Button>
      </div>

      {/* Hotels */}
      {grupo.htl.hoteis.map((hotel, hIdx) => {
        const periodo = grupo.periodos[hIdx];
        const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(hotel.fontes.map(f => f[`valor_${t}` as keyof typeof f] as number | null))]));
        const filledCount = hotel.fontes.filter(f => TIPOS.some(t => { const v = f[`valor_${t}` as keyof typeof f] as number | null; return v !== null && v > 0; })).length;
        const isInfoOpen = expandedInfo[hIdx] ?? false;

        return (
          <div key={hIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            {/* Hotel header */}
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Hotel className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--t-text)]">{periodo?.hotel || `Hotel ${hIdx + 1}`}</h3>
                  {periodo && (
                    <div className="flex items-center gap-2 text-xs text-[var(--t-text-muted)] mt-0.5">
                      <MapPin className="w-3 h-3" />
                      <span>{periodo.destino}</span>
                      <span className="text-[var(--t-border)]">|</span>
                      <Clock className="w-3 h-3" />
                      <span>{calcDiarias(periodo.check_in, periodo.check_out)} diárias</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setHotelModalOpen(hIdx)}>
                  <Hotel className="w-4 h-4 mr-1" /> Buscar via API
                </Button>
                {grupo.htl.hoteis.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeHotel(hIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Best price summary */}
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex flex-wrap gap-4">
                    {TIPOS.map(t => bests[t] > 0 ? (
                      <div key={t}>
                        <span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">{TIPO_LABELS[t]}</span>
                        <div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(bests[t])}</div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}

              {/* Source cards */}
              <div className="space-y-3">
                {hotel.fontes.map((fonte, fIdx) => {
                  const isBest = TIPOS.some(t => {
                    const val = fonte[`valor_${t}` as keyof typeof fonte] as number | null;
                    return val !== null && val > 0 && val === bests[t];
                  });

                  return (
                    <div
                      key={fIdx}
                      className={`rounded-xl border p-4 transition-all ${
                        isBest
                          ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30'
                          : 'border-[var(--t-border)] bg-[var(--t-bg)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                        <Input
                          value={fonte.nome}
                          onChange={e => updateFonte(hIdx, fIdx, 'nome', e.target.value)}
                          className="h-8 w-48 text-sm font-medium"
                          placeholder="Nome do fornecedor"
                        />
                        {isBest && (
                          <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">
                            Melhor
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {TIPOS.map(t => {
                          const key = `valor_${t}` as keyof typeof fonte;
                          const val = fonte[key] as number | null;
                          const isMin = val !== null && val > 0 && val === bests[t];
                          return (
                            <div key={t}>
                              <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">{TIPO_LABELS[t]}</label>
                              <MoneyInput value={val} onChange={v => updateFonte(hIdx, fIdx, key, v)} highlight={isMin} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Info panel toggle */}
              <button
                onClick={() => setExpandedInfo(prev => ({ ...prev, [hIdx]: !isInfoOpen }))}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--t-bg)] text-sm font-medium text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] transition-colors"
              >
                <span>Informações do hotel</span>
                {isInfoOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {isInfoOpen && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 content-enter">
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Deadline</Label><Input type="date" value={hotel.info.deadline || ''} onChange={e => updateInfo(hIdx, 'deadline', e.target.value || null)} className="h-9 mt-1" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Check-in</Label><Input value={hotel.info.check_in_hora} onChange={e => updateInfo(hIdx, 'check_in_hora', e.target.value)} className="h-9 mt-1" placeholder="14:00" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Check-out</Label><Input value={hotel.info.check_out_hora} onChange={e => updateInfo(hIdx, 'check_out_hora', e.target.value)} className="h-9 mt-1" placeholder="12:00" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Pensão</Label><Input value={hotel.info.pensao} onChange={e => updateInfo(hIdx, 'pensao', e.target.value)} className="h-9 mt-1" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Estacionamento</Label><Input value={hotel.info.estacionamento} onChange={e => updateInfo(hIdx, 'estacionamento', e.target.value)} className="h-9 mt-1" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Política CHD</Label><Input value={hotel.info.politica_chd} onChange={e => updateInfo(hIdx, 'politica_chd', e.target.value)} className="h-9 mt-1" /></div>
                  <div><Label className="text-xs text-[var(--t-text-muted)]">Política Free</Label><Input value={hotel.info.politica_free} onChange={e => updateInfo(hIdx, 'politica_free', e.target.value)} className="h-9 mt-1" /></div>
                  <div className="col-span-2 md:col-span-4"><Label className="text-xs text-[var(--t-text-muted)]">Info Adicional</Label><Textarea value={hotel.info.info_adicional} onChange={e => updateInfo(hIdx, 'info_adicional', e.target.value)} rows={2} className="mt-1" /></div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <HotelSearchModal
        open={hotelModalOpen !== null}
        onClose={() => setHotelModalOpen(null)}
        onSelect={(place) => {
          if (hotelModalOpen !== null) handleHotelSelect(hotelModalOpen, place);
        }}
        defaultDestino={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.destino || '' : ''}
        defaultHotelName={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.hotel || '' : ''}
      />
    </div>
  );
}
