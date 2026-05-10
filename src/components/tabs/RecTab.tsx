'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createRecPasseio } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcRecTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Map, Trophy, Calendar } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

function fonteHasData(f: { valor_adt: number | null; valor_chd: number | null }) {
  return (f.valor_adt !== null && f.valor_adt > 0) || (f.valor_chd !== null && f.valor_chd > 0);
}

export function RecTab({ grupo, onChange }: Props) {
  const totals = calcRecTotals(grupo);
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updatePasseio = (pIdx: number, field: string, value: string | null) => {
    const rec = { ...grupo.rec, passeios: [...grupo.rec.passeios] };
    rec.passeios[pIdx] = { ...rec.passeios[pIdx], [field]: value };
    onChange({ ...grupo, rec });
  };

  const updateFornecedor = (pIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const rec = { ...grupo.rec, passeios: [...grupo.rec.passeios] };
    rec.passeios[pIdx] = { ...rec.passeios[pIdx], fornecedores: [...rec.passeios[pIdx].fornecedores] };
    rec.passeios[pIdx].fornecedores[fIdx] = { ...rec.passeios[pIdx].fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, rec });
  };

  const addPasseio = () => {
    if (grupo.rec.passeios.length < 10) onChange({ ...grupo, rec: { passeios: [...grupo.rec.passeios, createRecPasseio()] } });
  };

  const removePasseio = (idx: number) => {
    onChange({ ...grupo, rec: { passeios: grupo.rec.passeios.filter((_, i) => i !== idx) } });
  };

  const isVisible = (pIdx: number, fIdx: number) =>
    fonteHasData(grupo.rec.passeios[pIdx].fornecedores[fIdx]) || addedSources[pIdx]?.has(fIdx) || false;

  const addSource = (pIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [pIdx]: new Set([...(prev[pIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (pIdx: number, fIdx: number) => {
    const rec = { ...grupo.rec, passeios: [...grupo.rec.passeios] };
    rec.passeios[pIdx] = { ...rec.passeios[pIdx], fornecedores: [...rec.passeios[pIdx].fornecedores] };
    rec.passeios[pIdx].fornecedores[fIdx] = { ...rec.passeios[pIdx].fornecedores[fIdx], valor_adt: null, valor_chd: null };
    onChange({ ...grupo, rec });
    setAddedSources(prev => { const s = new Set(prev[pIdx] || []); s.delete(fIdx); return { ...prev, [pIdx]: s }; });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
          <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total REC ADT</span>
          <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalAdt)}</div>
        </div>
        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
          <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total REC CHD</span>
          <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalChd)}</div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addPasseio} disabled={grupo.rec.passeios.length >= 10}><Plus className="w-4 h-4 mr-1" /> Passeio</Button>
      </div>

      {grupo.rec.passeios.map((passeio, pIdx) => {
        const melhorAdt = minPositivo(passeio.fornecedores.map(f => f.valor_adt));
        const melhorChd = minPositivo(passeio.fornecedores.map(f => f.valor_chd));
        const visibleIndices = passeio.fornecedores.map((_, i) => i).filter(i => isVisible(pIdx, i));
        const hiddenSources = passeio.fornecedores.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(pIdx, i));
        const filledCount = passeio.fornecedores.filter(fonteHasData).length;

        return (
          <div key={pIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Map className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div className="flex items-center gap-3">
                  <Input value={passeio.nome} onChange={e => updatePasseio(pIdx, 'nome', e.target.value)} placeholder={`Passeio ${pIdx + 1}`} className="h-9 w-48 font-medium" />
                  <div className="flex items-center gap-1.5 text-[var(--t-text-muted)]">
                    <Calendar className="w-3.5 h-3.5" />
                    <Input type="date" value={passeio.data || ''} onChange={e => updatePasseio(pIdx, 'data', e.target.value || null)} className="h-8 w-40" />
                  </div>
                </div>
              </div>
              {grupo.rec.passeios.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removePasseio(pIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
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
                  const f = passeio.fornecedores[fIdx];
                  const isMinAdt = f.valor_adt !== null && f.valor_adt > 0 && f.valor_adt === melhorAdt;
                  const isMinChd = f.valor_chd !== null && f.valor_chd > 0 && f.valor_chd === melhorChd;
                  const isBest = isMinAdt || isMinChd;

                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                          <Input value={f.nome} onChange={e => updateFornecedor(pIdx, fIdx, 'nome', e.target.value)} placeholder="Nome do fornecedor" className="h-8 w-48 text-sm font-medium" />
                          {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                        </div>
                        <button onClick={() => clearSource(pIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <MoneyCustoVenda
                          label="ADT"
                          custo={f.valor_adt}
                          venda={f.valor_venda_adt}
                          onCustoChange={v => updateFornecedor(pIdx, fIdx, 'valor_adt', v)}
                          onVendaChange={v => updateFornecedor(pIdx, fIdx, 'valor_venda_adt', v)}
                          highlightCusto={isMinAdt}
                        />
                        <MoneyCustoVenda
                          label="CHD"
                          custo={f.valor_chd}
                          venda={f.valor_venda_chd}
                          onCustoChange={v => updateFornecedor(pIdx, fIdx, 'valor_chd', v)}
                          onVendaChange={v => updateFornecedor(pIdx, fIdx, 'valor_venda_chd', v)}
                          highlightCusto={isMinChd}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                          <Input type="date" value={f.deadline || ''} onChange={e => updateFornecedor(pIdx, fIdx, 'deadline', e.target.value || null)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Info</label>
                          <Textarea value={f.info} onChange={e => updateFornecedor(pIdx, fIdx, 'info', e.target.value)} rows={1} className="min-h-[32px]" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === pIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === pIdx ? null : pIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
                  {pickerOpen === pIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione o fornecedor</div>
                      {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(pIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
                    </div>
                  )}
                </div>
              )}
              {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
