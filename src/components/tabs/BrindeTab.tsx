'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcBrindeTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Gift } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

function fornecedorHasData(f: { valor_unidade: number | null }) {
  return f.valor_unidade !== null && f.valor_unidade > 0;
}

export function BrindeTab({ grupo, onChange }: Props) {
  const totals = calcBrindeTotals(grupo);
  const [addedSources, setAddedSources] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const update = (fIdx: number, field: string, value: number | null | string) => {
    const brinde = { ...grupo.brinde, fornecedores: [...grupo.brinde.fornecedores] };
    brinde.fornecedores[fIdx] = { ...brinde.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, brinde });
  };

  const isVisible = (idx: number) =>
    fornecedorHasData(grupo.brinde.fornecedores[idx]) || addedSources.has(idx);

  const addSource = (idx: number) => {
    setAddedSources(prev => new Set([...prev, idx]));
    setPickerOpen(false);
  };

  const clearSource = (idx: number) => {
    const brinde = { ...grupo.brinde, fornecedores: [...grupo.brinde.fornecedores] };
    brinde.fornecedores[idx] = { ...brinde.fornecedores[idx], valor_unidade: null };
    onChange({ ...grupo, brinde });
    setAddedSources(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const visibleIndices = grupo.brinde.fornecedores.map((_, i) => i).filter(i => isVisible(i));
  const hiddenSources = grupo.brinde.fornecedores.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(i));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
        <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Melhor Preço Unitário</span>
        <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.melhorPreco)}</div>
      </div>

      <div className="space-y-3">
        {visibleIndices.map(fIdx => {
          const f = grupo.brinde.fornecedores[fIdx];
          const isMin = f.valor_unidade !== null && f.valor_unidade > 0 && f.valor_unidade === totals.melhorPreco;

          return (
            <div key={fIdx} className={`rounded-xl border p-4 ${isMin ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--t-green)]/10 flex items-center justify-center">
                    <Gift className="w-4 h-4 text-[var(--t-green)]" />
                  </div>
                  <Input value={f.nome} onChange={e => update(fIdx, 'nome', e.target.value)} placeholder="Nome do fornecedor" className="h-8 w-48 text-sm font-medium" />
                  {isMin && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                </div>
                <button onClick={() => clearSource(fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <MoneyCustoVenda
                  label="Valor Unidade"
                  custo={f.valor_unidade}
                  venda={f.valor_venda_unidade}
                  onCustoChange={v => update(fIdx, 'valor_unidade', v)}
                  onVendaChange={v => update(fIdx, 'valor_venda_unidade', v)}
                  highlightCusto={isMin}
                />
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Descrição</label>
                  <Input value={f.descricao} onChange={e => update(fIdx, 'descricao', e.target.value)} className="h-8" />
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Contato</label>
                  <Input value={f.contato} onChange={e => update(fIdx, 'contato', e.target.value)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                  <Input type="date" value={f.deadline || ''} onChange={e => update(fIdx, 'deadline', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Prazo Entrega</label>
                  <Input value={f.prazo_entrega} onChange={e => update(fIdx, 'prazo_entrega', e.target.value)} className="h-8" />
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione o fornecedor</div>
              {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
            </div>
          )}
        </div>
      )}
      {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}
    </div>
  );
}
