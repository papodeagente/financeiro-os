'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createIngAtrativo } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcIngTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Ticket, Trophy, Calendar } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

const TIPOS = ['adt', 'chd', 'inf', 'meia'] as const;
const TIPO_LABELS: Record<string, string> = { adt: 'ADT', chd: 'CHD', inf: 'INF', meia: 'Meia' };

function fonteHasData(f: Record<string, unknown>) {
  return TIPOS.some(t => { const v = f[`valor_${t}`] as number | null; return v !== null && v > 0; });
}

export function IngTab({ grupo, onChange }: Props) {
  const totals = calcIngTotals(grupo);
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateAtrativo = (aIdx: number, field: string, value: string | null) => {
    const ing = { ...grupo.ing, atrativos: [...grupo.ing.atrativos] };
    ing.atrativos[aIdx] = { ...ing.atrativos[aIdx], [field]: value };
    onChange({ ...grupo, ing });
  };

  const updateFonte = (aIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const ing = { ...grupo.ing, atrativos: [...grupo.ing.atrativos] };
    ing.atrativos[aIdx] = { ...ing.atrativos[aIdx], fontes: [...ing.atrativos[aIdx].fontes] };
    ing.atrativos[aIdx].fontes[fIdx] = { ...ing.atrativos[aIdx].fontes[fIdx], [field]: value };
    onChange({ ...grupo, ing });
  };

  const addAtrativo = () => { if (grupo.ing.atrativos.length < 10) onChange({ ...grupo, ing: { atrativos: [...grupo.ing.atrativos, createIngAtrativo()] } }); };
  const removeAtrativo = (idx: number) => { onChange({ ...grupo, ing: { atrativos: grupo.ing.atrativos.filter((_, i) => i !== idx) } }); };

  const isVisible = (aIdx: number, fIdx: number) =>
    fonteHasData(grupo.ing.atrativos[aIdx].fontes[fIdx] as unknown as Record<string, unknown>) || addedSources[aIdx]?.has(fIdx) || false;

  const addSource = (aIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [aIdx]: new Set([...(prev[aIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (aIdx: number, fIdx: number) => {
    const ing = { ...grupo.ing, atrativos: [...grupo.ing.atrativos] };
    ing.atrativos[aIdx] = { ...ing.atrativos[aIdx], fontes: [...ing.atrativos[aIdx].fontes] };
    ing.atrativos[aIdx].fontes[fIdx] = { ...ing.atrativos[aIdx].fontes[fIdx], valor_adt: null, valor_chd: null, valor_inf: null, valor_meia: null };
    onChange({ ...grupo, ing });
    setAddedSources(prev => { const s = new Set(prev[aIdx] || []); s.delete(fIdx); return { ...prev, [aIdx]: s }; });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIPOS.map(t => (
          <div key={t} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total {TIPO_LABELS[t]}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals[`total${t.charAt(0).toUpperCase() + t.slice(1)}` as keyof typeof totals] as number)}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addAtrativo} disabled={grupo.ing.atrativos.length >= 10}><Plus className="w-4 h-4 mr-1" /> Atrativo</Button>
      </div>

      {grupo.ing.atrativos.map((atr, aIdx) => {
        const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(atr.fontes.map(f => f[`valor_${t}` as keyof typeof f] as number | null))]));
        const visibleIndices = atr.fontes.map((_, i) => i).filter(i => isVisible(aIdx, i));
        const hiddenSources = atr.fontes.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(aIdx, i));
        const filledCount = atr.fontes.filter(f => fonteHasData(f as unknown as Record<string, unknown>)).length;

        return (
          <div key={aIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center"><Ticket className="w-5 h-5 text-[var(--t-green)]" /></div>
                <div className="flex items-center gap-3">
                  <Input value={atr.nome} onChange={e => updateAtrativo(aIdx, 'nome', e.target.value)} placeholder={`Atrativo ${aIdx + 1}`} className="h-9 w-48 font-medium" />
                  <div className="flex items-center gap-1.5 text-[var(--t-text-muted)]"><Calendar className="w-3.5 h-3.5" /><Input type="date" value={atr.data || ''} onChange={e => updateAtrativo(aIdx, 'data', e.target.value || null)} className="h-8 w-40" /></div>
                </div>
              </div>
              {grupo.ing.atrativos.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeAtrativo(aIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]"><Trash2 className="w-4 h-4" /></Button>}
            </div>

            <div className="p-4 space-y-4">
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex flex-wrap gap-4">
                    {TIPOS.map(t => bests[t] > 0 ? (<div key={t}><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">{TIPO_LABELS[t]}</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(bests[t])}</div></div>) : null)}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {visibleIndices.map(fIdx => {
                  const fonte = atr.fontes[fIdx];
                  const isBest = TIPOS.some(t => { const val = fonte[`valor_${t}` as keyof typeof fonte] as number | null; return val !== null && val > 0 && val === bests[t]; });
                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                          <Input value={fonte.nome} onChange={e => updateFonte(aIdx, fIdx, 'nome', e.target.value)} className="h-8 w-48 text-sm font-medium" placeholder="Nome da fonte" />
                          {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                        </div>
                        <button onClick={() => clearSource(aIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {TIPOS.map(t => {
                          const key = `valor_${t}` as keyof typeof fonte;
                          const val = fonte[key] as number | null;
                          const isMin = val !== null && val > 0 && val === bests[t];
                          return (<div key={t}><label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">{TIPO_LABELS[t]}</label><MoneyInput value={val} onChange={v => updateFonte(aIdx, fIdx, key, v)} highlight={isMin} /></div>);
                        })}
                        <div><label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Info</label><Textarea value={fonte.info} onChange={e => updateFonte(aIdx, fIdx, 'info', e.target.value)} rows={1} className="min-h-[32px]" /></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === aIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === aIdx ? null : aIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
                  {pickerOpen === aIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione a fonte</div>
                      {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(aIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
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
