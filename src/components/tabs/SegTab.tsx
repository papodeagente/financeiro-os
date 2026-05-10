'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcSegTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Trophy, Shield, CalendarDays } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

function formatDateBR(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

const ALL_TIPOS = ['sgl', 'dbl', 'tpl', 'qdp'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP' };

function segHasData(s: Record<string, unknown>) {
  return ALL_TIPOS.some(t => { const v = s[`valor_${t}`] as number | null; return v !== null && v > 0; });
}

export function SegTab({ grupo, onChange }: Props) {
  const TIPOS = (grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp']).filter(t => ALL_TIPOS.includes(t as typeof ALL_TIPOS[number])) as typeof ALL_TIPOS[number][];
  const totals = calcSegTotals(grupo);
  const [addedSources, setAddedSources] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const update = (sIdx: number, field: string, value: number | null | string) => {
    const seg = { ...grupo.seg, seguradoras: [...grupo.seg.seguradoras] };
    seg.seguradoras[sIdx] = { ...seg.seguradoras[sIdx], [field]: value };
    onChange({ ...grupo, seg });
  };

  const isVisible = (idx: number) =>
    segHasData(grupo.seg.seguradoras[idx] as unknown as Record<string, unknown>) || addedSources.has(idx);

  const addSource = (idx: number) => {
    setAddedSources(prev => new Set([...prev, idx]));
    setPickerOpen(false);
  };

  const clearSource = (idx: number) => {
    const seg = { ...grupo.seg, seguradoras: [...grupo.seg.seguradoras] };
    seg.seguradoras[idx] = { ...seg.seguradoras[idx], valor_sgl: null, valor_dbl: null, valor_tpl: null, valor_qdp: null };
    onChange({ ...grupo, seg });
    setAddedSources(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const visibleIndices = grupo.seg.seguradoras.map((_, i) => i).filter(i => isVisible(i));
  const hiddenSources = grupo.seg.seguradoras.map((s, i) => ({ nome: s.nome, idx: i })).filter((_, i) => !isVisible(i));

  // Compute travel period from periodos
  const periodos = grupo.periodos || [];
  const primeiraData = periodos[0]?.check_in || '';
  const ultimaData = periodos[periodos.length - 1]?.check_out || '';

  return (
    <div className="space-y-6">
      {/* Travel period reference */}
      {primeiraData && ultimaData && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
          <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
          <div>
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Periodo da viagem: </span>
            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">{formatDateBR(primeiraData)} a {formatDateBR(ultimaData)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIPOS.map(t => (
          <div key={t} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Melhor {LABELS[t]}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals[t])}</div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {visibleIndices.map(sIdx => {
          const seg = grupo.seg.seguradoras[sIdx];
          const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(grupo.seg.seguradoras.map(s => s[`valor_${t}` as keyof typeof s] as number | null))]));
          const isBest = TIPOS.some(t => {
            const val = seg[`valor_${t}` as keyof typeof seg] as number | null;
            return val !== null && val > 0 && val === bests[t];
          });

          return (
            <div key={sIdx} className={`rounded-xl border p-4 ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--t-green)]/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-[var(--t-green)]" />
                  </div>
                  <Input value={seg.nome} onChange={e => update(sIdx, 'nome', e.target.value)} placeholder="Nome da seguradora" className="h-8 w-48 text-sm font-medium" />
                  {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                </div>
                <button onClick={() => clearSource(sIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {TIPOS.map(t => {
                  const key = `valor_${t}` as keyof typeof seg;
                  const vendaKey = `valor_venda_${t}` as keyof typeof seg;
                  const val = seg[key] as number | null;
                  const vendaVal = seg[vendaKey] as number | null | undefined;
                  const isMin = val !== null && val > 0 && val === bests[t];
                  return (
                    <MoneyCustoVenda
                      key={t}
                      label={LABELS[t]}
                      custo={val}
                      venda={vendaVal}
                      onCustoChange={v => update(sIdx, key, v)}
                      onVendaChange={v => update(sIdx, vendaKey, v)}
                      highlightCusto={isMin}
                    />
                  );
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Data Inicio</label>
                  <Input type="date" value={seg.data_inicio || primeiraData || ''} onChange={e => update(sIdx, 'data_inicio', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Data Fim</label>
                  <Input type="date" value={seg.data_fim || ultimaData || ''} onChange={e => update(sIdx, 'data_fim', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                  <Input type="date" value={seg.deadline || ''} onChange={e => update(sIdx, 'deadline', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Descricao</label>
                  <Textarea value={seg.descricao} onChange={e => update(sIdx, 'descricao', e.target.value)} rows={1} className="min-h-[32px]" />
                </div>
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione a seguradora</div>
              {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
            </div>
          )}
        </div>
      )}
      {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}
    </div>
  );
}
