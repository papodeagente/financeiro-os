'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL, calcDiarias } from '@/lib/utils';
import { calcNavioTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trophy, Ship, Anchor, MapPin } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

export function NavioTab({ grupo, onChange }: Props) {
  const totals = calcNavioTotals(grupo);
  const ni = grupo.navio_info;

  const updateFornecedor = (fIdx: number, field: string, value: number | null | string) => {
    const navio = { ...grupo.navio, fornecedores: [...grupo.navio.fornecedores] };
    navio.fornecedores[fIdx] = { ...navio.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, navio });
  };

  const updateNavio = (field: string, value: string | null) => {
    onChange({ ...grupo, navio: { ...grupo.navio, [field]: value } });
  };

  return (
    <div className="space-y-6">
      {/* Cruise info card */}
      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4" style={{ boxShadow: 'var(--elevation-1)' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
            <Ship className="w-5 h-5 text-[var(--t-green)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--t-text)]">{ni.nome_cruzeiro || 'Cruzeiro'}</h3>
            <div className="flex items-center gap-3 text-xs text-[var(--t-text-muted)] mt-0.5">
              <span className="flex items-center gap-1"><Anchor className="w-3 h-3" /> {ni.cidade_embarque || '—'}</span>
              <span>→</span>
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {ni.cidade_desembarque || '—'}</span>
              <span>| {calcDiarias(ni.embarque, ni.desembarque) || '—'} diárias</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
          {TIPOS.map(t => (
            <div key={t} className="rounded-lg bg-[var(--t-bg)] p-2.5">
              <span className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase">Melhor {LABELS[t]}</span>
              <div className="text-base font-bold text-[var(--t-text)]">{formatBRL(totals[t])}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Deadline */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-[var(--t-text-secondary)]">Deadline geral</Label>
        <Input type="date" value={grupo.navio.deadline || ''} onChange={e => updateNavio('deadline', e.target.value || null)} className="h-9 w-48" />
      </div>

      {/* Supplier cards */}
      <div className="space-y-3">
        {grupo.navio.fornecedores.map((f, fIdx) => {
          const isBest = TIPOS.some(t => {
            const val = f[`valor_${t}` as keyof typeof f] as number | null;
            return val !== null && val > 0 && val === totals[t];
          });

          return (
            <div key={fIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                <Input value={f.nome} onChange={e => updateFornecedor(fIdx, 'nome', e.target.value)} placeholder="Nome do fornecedor" className="h-8 w-48 text-sm font-medium" />
                {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {TIPOS.map(t => {
                  const key = `valor_${t}` as keyof typeof f;
                  const val = f[key] as number | null;
                  const isMin = val !== null && val > 0 && val === totals[t];
                  return (
                    <div key={t}>
                      <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">{LABELS[t]}</label>
                      <MoneyInput value={val} onChange={v => updateFornecedor(fIdx, key, v)} highlight={isMin} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Additional info */}
      <div>
        <Label className="text-sm text-[var(--t-text-secondary)]">Informações Adicionais / Roteiro</Label>
        <Textarea value={grupo.navio.info_adicional} onChange={e => updateNavio('info_adicional', e.target.value)} rows={6} className="mt-1.5" />
      </div>
    </div>
  );
}
