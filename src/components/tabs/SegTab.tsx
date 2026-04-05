'use client';

import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcSegTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Trophy, Shield } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP' };

export function SegTab({ grupo, onChange }: Props) {
  const totals = calcSegTotals(grupo);

  const update = (sIdx: number, field: string, value: number | null | string) => {
    const seg = { ...grupo.seg, seguradoras: [...grupo.seg.seguradoras] };
    seg.seguradoras[sIdx] = { ...seg.seguradoras[sIdx], [field]: value };
    onChange({ ...grupo, seg });
  };

  const filledCount = grupo.seg.seguradoras.filter(s => TIPOS.some(t => {
    const val = s[`valor_${t}` as keyof typeof s] as number | null;
    return val !== null && val > 0;
  })).length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIPOS.map(t => (
          <div key={t} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Melhor {LABELS[t]}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals[t])}</div>
          </div>
        ))}
      </div>

      {/* Supplier cards */}
      <div className="space-y-3">
        {grupo.seg.seguradoras.map((seg, sIdx) => {
          const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(grupo.seg.seguradoras.map(s => s[`valor_${t}` as keyof typeof s] as number | null))]));
          const isBest = TIPOS.some(t => {
            const val = seg[`valor_${t}` as keyof typeof seg] as number | null;
            return val !== null && val > 0 && val === bests[t];
          });

          return (
            <div key={sIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-[var(--t-green)]" />
                </div>
                <Input value={seg.nome} onChange={e => update(sIdx, 'nome', e.target.value)} placeholder="Nome da seguradora" className="h-8 w-48 text-sm font-medium" />
                {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {TIPOS.map(t => {
                  const key = `valor_${t}` as keyof typeof seg;
                  const val = seg[key] as number | null;
                  const isMin = val !== null && val > 0 && val === bests[t];
                  return (
                    <div key={t}>
                      <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">{LABELS[t]}</label>
                      <MoneyInput value={val} onChange={v => update(sIdx, key, v)} highlight={isMin} />
                    </div>
                  );
                })}
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                  <Input type="date" value={seg.deadline || ''} onChange={e => update(sIdx, 'deadline', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Descrição</label>
                  <Textarea value={seg.descricao} onChange={e => update(sIdx, 'descricao', e.target.value)} rows={1} className="min-h-[32px]" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
