'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL, calcDiarias } from '@/lib/utils';
import { calcNavioTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Trophy, Ship, Anchor, MapPin } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

const ALL_TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

function fornecedorHasData(f: Record<string, unknown>) {
  return ALL_TIPOS.some(t => { const v = f[`valor_${t}`] as number | null; return v !== null && v > 0; });
}

export function NavioTab({ grupo, onChange }: Props) {
  const TIPOS = [...(grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp']).filter(t => ALL_TIPOS.includes(t as typeof ALL_TIPOS[number])), 'chd'] as typeof ALL_TIPOS[number][];
  const totals = calcNavioTotals(grupo);
  const ni = grupo.navio_info;
  const [addedSources, setAddedSources] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateFornecedor = (fIdx: number, field: string, value: number | null | string) => {
    const navio = { ...grupo.navio, fornecedores: [...grupo.navio.fornecedores] };
    navio.fornecedores[fIdx] = { ...navio.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, navio });
  };

  const updateNavio = (field: string, value: string | null) => {
    onChange({ ...grupo, navio: { ...grupo.navio, [field]: value } });
  };

  const isVisible = (idx: number) =>
    fornecedorHasData(grupo.navio.fornecedores[idx] as unknown as Record<string, unknown>) || addedSources.has(idx);

  const addSource = (idx: number) => {
    setAddedSources(prev => new Set([...prev, idx]));
    setPickerOpen(false);
  };

  const clearSource = (idx: number) => {
    const navio = { ...grupo.navio, fornecedores: [...grupo.navio.fornecedores] };
    navio.fornecedores[idx] = { ...navio.fornecedores[idx], valor_sgl: null, valor_dbl: null, valor_tpl: null, valor_qdp: null, valor_chd: null };
    onChange({ ...grupo, navio });
    setAddedSources(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const visibleIndices = grupo.navio.fornecedores.map((_, i) => i).filter(i => isVisible(i));
  const hiddenSources = grupo.navio.fornecedores.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(i));

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
        {visibleIndices.map(fIdx => {
          const f = grupo.navio.fornecedores[fIdx];
          const isBest = TIPOS.some(t => {
            const val = f[`valor_${t}` as keyof typeof f] as number | null;
            return val !== null && val > 0 && val === totals[t];
          });

          return (
            <div key={fIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                  <Input value={f.nome} onChange={e => updateFornecedor(fIdx, 'nome', e.target.value)} placeholder="Nome do fornecedor" className="h-8 w-48 text-sm font-medium" />
                  {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                </div>
                <button onClick={() => clearSource(fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
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

      {hiddenSources.length > 0 && (
        <div className="relative" ref={pickerOpen ? pickerRef : undefined}>
          <button onClick={() => setPickerOpen(!pickerOpen)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
          {pickerOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione o fornecedor</div>
              {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
            </div>
          )}
        </div>
      )}
      {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}

      {/* Additional info */}
      <div>
        <Label className="text-sm text-[var(--t-text-secondary)]">Informações Adicionais / Roteiro</Label>
        <Textarea value={grupo.navio.info_adicional} onChange={e => updateNavio('info_adicional', e.target.value)} rows={6} className="mt-1.5" />
      </div>
    </div>
  );
}
