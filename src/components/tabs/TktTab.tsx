'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createTktTrecho } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcTktTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Plane, Trophy } from 'lucide-react';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { formatFlightForTkt } from '@/lib/flight-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';

interface Props { grupo: GrupoViagem; onChange: (grupo: GrupoViagem) => void; }

function fonteHasData(f: { valor_adt: number | null; valor_chd: number | null; partida_chegada: string }) {
  return (f.valor_adt !== null && f.valor_adt > 0) || (f.valor_chd !== null && f.valor_chd > 0) || !!f.partida_chegada;
}

export function TktTab({ grupo, onChange }: Props) {
  const totals = calcTktTotals(grupo);
  const [flightModalOpen, setFlightModalOpen] = useState<number | null>(null);
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateFonte = (tIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    tkt.trechos[tIdx].fontes[fIdx] = { ...tkt.trechos[tIdx].fontes[fIdx], [field]: value };
    onChange({ ...grupo, tkt });
  };

  const updateDeadline = (tIdx: number, value: string | null) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], deadline: value };
    onChange({ ...grupo, tkt });
  };

  const addTrecho = () => { if (grupo.tkt.trechos.length < 4) onChange({ ...grupo, tkt: { trechos: [...grupo.tkt.trechos, createTktTrecho()] } }); };
  const removeTrecho = (idx: number) => { onChange({ ...grupo, tkt: { trechos: grupo.tkt.trechos.filter((_, i) => i !== idx) } }); };

  const handleFlightSelect = (tIdx: number, offer: FlightOffer) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    const mapped = formatFlightForTkt(offer, 0);
    const existingIdx = tkt.trechos[tIdx].fontes.findIndex(f => f.nome === 'Google Flights');
    if (existingIdx >= 0) {
      tkt.trechos[tIdx].fontes[existingIdx] = { ...tkt.trechos[tIdx].fontes[existingIdx], partida_chegada: mapped.partida_chegada, valor_adt: mapped.valor_adt };
    } else {
      tkt.trechos[tIdx].fontes.push({ nome: mapped.nome, valor_adt: mapped.valor_adt, valor_chd: null, partida_chegada: mapped.partida_chegada });
    }
    onChange({ ...grupo, tkt });
  };

  const isVisible = (tIdx: number, fIdx: number) =>
    fonteHasData(grupo.tkt.trechos[tIdx].fontes[fIdx]) || addedSources[tIdx]?.has(fIdx) || false;

  const addSource = (tIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [tIdx]: new Set([...(prev[tIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (tIdx: number, fIdx: number) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    tkt.trechos[tIdx].fontes[fIdx] = { ...tkt.trechos[tIdx].fontes[fIdx], valor_adt: null, valor_chd: null, partida_chegada: '' };
    onChange({ ...grupo, tkt });
    setAddedSources(prev => { const s = new Set(prev[tIdx] || []); s.delete(fIdx); return { ...prev, [tIdx]: s }; });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        {(['totalAdt', 'totalChd'] as const).map((k, i) => (
          <div key={k} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total TKT {i === 0 ? 'ADT' : 'CHD'}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals[k])}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addTrecho} disabled={grupo.tkt.trechos.length >= 4}><Plus className="w-4 h-4 mr-1" /> Trecho</Button>
      </div>

      {grupo.tkt.trechos.map((trecho, tIdx) => {
        const infTrecho = grupo.trechos[tIdx];
        const melhorAdt = minPositivo(trecho.fontes.map(f => f.valor_adt));
        const melhorChd = minPositivo(trecho.fontes.map(f => f.valor_chd));
        const visibleIndices = trecho.fontes.map((_, i) => i).filter(i => isVisible(tIdx, i));
        const hiddenSources = trecho.fontes.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(tIdx, i));
        const filledCount = trecho.fontes.filter(fonteHasData).length;

        return (
          <div key={tIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center"><Plane className="w-5 h-5 text-[var(--t-green)]" /></div>
                <div>
                  <h3 className="font-semibold text-[var(--t-text)]">Trecho {tIdx + 1}</h3>
                  {infTrecho && <span className="text-xs text-[var(--t-text-muted)]">ADT: {infTrecho.qtd_adt} | CHD: {infTrecho.qtd_chd}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-[var(--t-text-muted)]">
                  <span>Deadline</span>
                  <Input type="date" value={trecho.deadline || ''} onChange={e => updateDeadline(tIdx, e.target.value || null)} className="h-8 w-40" />
                </div>
                <Button variant="outline" size="sm" onClick={() => setFlightModalOpen(tIdx)}><Plane className="w-4 h-4 mr-1" /> Buscar via API</Button>
                {grupo.tkt.trechos.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeTrecho(tIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]"><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex gap-6">
                    {melhorAdt > 0 && <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">ADT</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhorAdt)}</div></div>}
                    {melhorChd > 0 && <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">CHD</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhorChd)}</div></div>}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {visibleIndices.map(fIdx => {
                  const fonte = trecho.fontes[fIdx];
                  const isMinAdt = fonte.valor_adt !== null && fonte.valor_adt > 0 && fonte.valor_adt === melhorAdt;
                  const isMinChd = fonte.valor_chd !== null && fonte.valor_chd > 0 && fonte.valor_chd === melhorChd;
                  const isBest = isMinAdt || isMinChd;
                  const isApi = fonte.nome === 'API Amadeus';
                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 transition-all ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : isApi ? 'border-[var(--t-status-info)]/30 bg-[var(--t-status-info-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                          <Input value={fonte.nome} onChange={e => updateFonte(tIdx, fIdx, 'nome', e.target.value)} className="h-8 w-48 text-sm font-medium" placeholder="Nome da fonte" />
                          {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                          {isApi && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-info-bg)] text-[var(--t-status-info)]">API</span>}
                        </div>
                        <button onClick={() => clearSource(tIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div><label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor ADT</label><MoneyInput value={fonte.valor_adt} onChange={v => updateFonte(tIdx, fIdx, 'valor_adt', v)} highlight={isMinAdt} /></div>
                        <div><label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor CHD</label><MoneyInput value={fonte.valor_chd} onChange={v => updateFonte(tIdx, fIdx, 'valor_chd', v)} highlight={isMinChd} /></div>
                        <div><label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Partida / Chegada</label><Input value={fonte.partida_chegada} onChange={e => updateFonte(tIdx, fIdx, 'partida_chegada', e.target.value)} className="h-8" placeholder="GRU 10:00 → LIS 22:00" /></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === tIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === tIdx ? null : tIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
                  {pickerOpen === tIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione a fonte</div>
                      {hiddenSources.map(s => (
                        <button key={s.idx} onClick={() => addSource(tIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}
            </div>
          </div>
        );
      })}

      <FlightSearchModal open={flightModalOpen !== null} onClose={() => setFlightModalOpen(null)}
        onSelect={(offer) => { if (flightModalOpen !== null) handleFlightSelect(flightModalOpen, offer); }}
        defaultDataIda={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.data || '' : ''}
        defaultAdultos={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.qtd_adt || 1 : 1}
        defaultCriancas={flightModalOpen !== null ? grupo.trechos[flightModalOpen]?.qtd_chd || 0 : 0}
      />
    </div>
  );
}
