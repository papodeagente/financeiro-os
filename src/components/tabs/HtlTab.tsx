'use client';

import { useState, useRef, useEffect } from 'react';
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

const ALL_TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const TIPO_LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

function fonteHasData(fonte: { valor_sgl: number | null; valor_dbl: number | null; valor_tpl: number | null; valor_qdp: number | null; valor_chd: number | null }) {
  return ALL_TIPOS.some(t => {
    const v = fonte[`valor_${t}` as keyof typeof fonte] as number | null;
    return v !== null && v > 0;
  });
}

export function HtlTab({ grupo, onChange }: Props) {
  const tarifas = grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp'];
  const TIPOS = [...tarifas.filter(t => ALL_TIPOS.includes(t as typeof ALL_TIPOS[number])), 'chd'] as typeof ALL_TIPOS[number][];
  const totals = calcHtlTotals(grupo);
  const [hotelModalOpen, setHotelModalOpen] = useState<number | null>(null);
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [expandedInfo, setExpandedInfo] = useState<Record<number, boolean>>({});
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

    // Merge check-in/out times
    if (mapped.check_in_hora) info.check_in_hora = mapped.check_in_hora;
    if (mapped.check_out_hora) info.check_out_hora = mapped.check_out_hora;
    if (!info.estacionamento && mapped.estacionamento) info.estacionamento = mapped.estacionamento;
    if (mapped.info_adicional) {
      info.info_adicional = info.info_adicional
        ? `${info.info_adicional}\n\n${mapped.info_adicional}`
        : mapped.info_adicional;
    }

    // Store API images and metadata for proposta generation
    // Proxy external URLs to avoid CORS/referrer blocking
    const proxyUrl = (url: string) => {
      if (!url) return '';
      if (url.startsWith('/')) return url; // local
      return `/api/img-proxy?url=${encodeURIComponent(url)}`;
    };
    info.hotel_imagem = proxyUrl(place.images?.[0]?.original || place.images?.[0]?.thumbnail || '');
    info.hotel_galeria = (place.images || []).slice(0, 8).map(img => proxyUrl(img.original || img.thumbnail));
    info.hotel_estrelas = place.extracted_hotel_class || (place.rating ? Math.round(place.rating) : undefined);
    info.hotel_link = place.link || '';
    info.hotel_descricao = place.description || '';
    info.hotel_rating = place.rating || undefined;
    info.hotel_reviews_count = place.reviews || undefined;
    info.hotel_amenities = place.amenities || undefined;
    info.hotel_preco_noite = place.price_per_night?.extracted_price_before_taxes || undefined;
    if (place.gps_coordinates) {
      info.hotel_lat = place.gps_coordinates.latitude;
      info.hotel_lng = place.gps_coordinates.longitude;
    }

    // Also update periodo hotel name if available
    const updatedGrupo = { ...grupo, htl };
    if (place.name && updatedGrupo.periodos[hotelIdx]) {
      updatedGrupo.periodos = [...updatedGrupo.periodos];
      updatedGrupo.periodos[hotelIdx] = { ...updatedGrupo.periodos[hotelIdx], hotel: place.name };
    }

    // Auto-fill price in first empty fonte if API has price
    if (place.total_price?.extracted_price_before_taxes) {
      const totalPrice = place.total_price.extracted_price_before_taxes;
      const fontes = [...htl.hoteis[hotelIdx].fontes];
      const apiIdx = fontes.findIndex(f => f.nome === 'Google Hotels');
      const priceEntry = { nome: 'Google Hotels', valor_sgl: totalPrice, valor_dbl: totalPrice, valor_tpl: totalPrice, valor_qdp: totalPrice, valor_chd: null as number | null };
      if (apiIdx >= 0) {
        fontes[apiIdx] = { ...fontes[apiIdx], ...priceEntry };
      } else {
        fontes.push(priceEntry);
      }
      htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], fontes };
    }

    onChange(updatedGrupo);
  };

  const isVisible = (hIdx: number, fIdx: number) =>
    fonteHasData(grupo.htl.hoteis[hIdx].fontes[fIdx]) || addedSources[hIdx]?.has(fIdx) || false;

  const addSource = (hIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [hIdx]: new Set([...(prev[hIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (hIdx: number, fIdx: number) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hIdx] = { ...htl.hoteis[hIdx], fontes: [...htl.hoteis[hIdx].fontes] };
    htl.hoteis[hIdx].fontes[fIdx] = { ...htl.hoteis[hIdx].fontes[fIdx], valor_sgl: null, valor_dbl: null, valor_tpl: null, valor_qdp: null, valor_chd: null };
    onChange({ ...grupo, htl });
    setAddedSources(prev => { const s = new Set(prev[hIdx] || []); s.delete(fIdx); return { ...prev, [hIdx]: s }; });
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

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addHotel} disabled={grupo.htl.hoteis.length >= 10}>
          <Plus className="w-4 h-4 mr-1" /> Hotel
        </Button>
      </div>

      {grupo.htl.hoteis.map((hotel, hIdx) => {
        const periodo = grupo.periodos[hIdx];
        const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(hotel.fontes.map(f => f[`valor_${t}` as keyof typeof f] as number | null))]));
        const visibleIndices = hotel.fontes.map((_, i) => i).filter(i => isVisible(hIdx, i));
        const hiddenSources = hotel.fontes.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(hIdx, i));
        const filledCount = hotel.fontes.filter(fonteHasData).length;
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
                      <MapPin className="w-3 h-3" /><span>{periodo.destino}</span>
                      <span className="text-[var(--t-border)]">|</span>
                      <Clock className="w-3 h-3" /><span>{calcDiarias(periodo.check_in, periodo.check_out)} diárias</span>
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
                {visibleIndices.map(fIdx => {
                  const fonte = hotel.fontes[fIdx];
                  const isBest = TIPOS.some(t => {
                    const val = fonte[`valor_${t}` as keyof typeof fonte] as number | null;
                    return val !== null && val > 0 && val === bests[t];
                  });
                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 transition-all ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                          <Input value={fonte.nome} onChange={e => updateFonte(hIdx, fIdx, 'nome', e.target.value)} className="h-8 w-48 text-sm font-medium" placeholder="Nome do fornecedor" />
                          {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                        </div>
                        <button onClick={() => clearSource(hIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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

              {/* Add source picker */}
              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === hIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === hIdx ? null : hIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors">
                    <Plus className="w-4 h-4" /> Adicionar cotação
                  </button>
                  {pickerOpen === hIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione a fonte</div>
                      {hiddenSources.map(s => (
                        <button key={s.idx} onClick={() => addSource(hIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {visibleIndices.length === 0 && (
                <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">
                  Nenhuma cotação adicionada. Clique em &ldquo;Adicionar cotação&rdquo; para começar.
                </div>
              )}

              {/* Info panel toggle */}
              <button onClick={() => setExpandedInfo(prev => ({ ...prev, [hIdx]: !isInfoOpen }))} className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--t-bg)] text-sm font-medium text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] transition-colors">
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
        onSelect={(place) => { if (hotelModalOpen !== null) handleHotelSelect(hotelModalOpen, place); }}
        defaultDestino={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.destino || '' : ''}
        defaultHotelName={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.hotel || '' : ''}
        defaultCheckIn={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.check_in || '' : ''}
        defaultCheckOut={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.check_out || '' : ''}
      />
    </div>
  );
}
