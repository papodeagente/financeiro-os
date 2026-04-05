'use client';

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

export function IngTab({ grupo, onChange }: Props) {
  const totals = calcIngTotals(grupo);

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

  const addAtrativo = () => {
    if (grupo.ing.atrativos.length < 10) onChange({ ...grupo, ing: { atrativos: [...grupo.ing.atrativos, createIngAtrativo()] } });
  };

  const removeAtrativo = (idx: number) => {
    onChange({ ...grupo, ing: { atrativos: grupo.ing.atrativos.filter((_, i) => i !== idx) } });
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
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
        const filledCount = atr.fontes.filter(f => TIPOS.some(t => { const v = f[`valor_${t}` as keyof typeof f] as number | null; return v !== null && v > 0; })).length;

        return (
          <div key={aIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Ticket className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div className="flex items-center gap-3">
                  <Input value={atr.nome} onChange={e => updateAtrativo(aIdx, 'nome', e.target.value)} placeholder={`Atrativo ${aIdx + 1}`} className="h-9 w-48 font-medium" />
                  <div className="flex items-center gap-1.5 text-[var(--t-text-muted)]">
                    <Calendar className="w-3.5 h-3.5" />
                    <Input type="date" value={atr.data || ''} onChange={e => updateAtrativo(aIdx, 'data', e.target.value || null)} className="h-8 w-40" />
                  </div>
                </div>
              </div>
              {grupo.ing.atrativos.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeAtrativo(aIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="p-4 space-y-4">
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

              <div className="space-y-3">
                {atr.fontes.map((fonte, fIdx) => {
                  const isBest = TIPOS.some(t => {
                    const val = fonte[`valor_${t}` as keyof typeof fonte] as number | null;
                    return val !== null && val > 0 && val === bests[t];
                  });

                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                        <Input
                          value={fonte.nome}
                          onChange={e => updateFonte(aIdx, fIdx, 'nome', e.target.value)}
                          className="h-8 w-48 text-sm font-medium"
                          placeholder="Nome da fonte"
                        />
                        {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {TIPOS.map(t => {
                          const key = `valor_${t}` as keyof typeof fonte;
                          const val = fonte[key] as number | null;
                          const isMin = val !== null && val > 0 && val === bests[t];
                          return (
                            <div key={t}>
                              <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">{TIPO_LABELS[t]}</label>
                              <MoneyInput value={val} onChange={v => updateFonte(aIdx, fIdx, key, v)} highlight={isMin} />
                            </div>
                          );
                        })}
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Info</label>
                          <Textarea value={fonte.info} onChange={e => updateFonte(aIdx, fIdx, 'info', e.target.value)} rows={1} className="min-h-[32px]" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
