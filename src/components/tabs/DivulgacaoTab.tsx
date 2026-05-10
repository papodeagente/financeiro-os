'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { calcDivulgacaoTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Megaphone } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

function fornecedorHasData(f: { valor_total: number | null }) {
  return f.valor_total !== null && f.valor_total > 0;
}

export function DivulgacaoTab({ grupo, onChange }: Props) {
  const totals = calcDivulgacaoTotals(grupo);
  const minPax = grupo.params.qtd_min_pax || 1;
  const [addedSources, setAddedSources] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const update = (fIdx: number, field: string, value: number | null | string) => {
    const divulgacao = { ...grupo.divulgacao, fornecedores: [...grupo.divulgacao.fornecedores] };
    divulgacao.fornecedores[fIdx] = { ...divulgacao.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, divulgacao });
  };

  const isVisible = (idx: number) =>
    fornecedorHasData(grupo.divulgacao.fornecedores[idx]) || addedSources.has(idx);

  const addSource = (idx: number) => {
    setAddedSources(prev => new Set([...prev, idx]));
    setPickerOpen(false);
  };

  const clearSource = (idx: number) => {
    const divulgacao = { ...grupo.divulgacao, fornecedores: [...grupo.divulgacao.fornecedores] };
    divulgacao.fornecedores[idx] = { ...divulgacao.fornecedores[idx], valor_total: null };
    onChange({ ...grupo, divulgacao });
    setAddedSources(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const addCustom = () => {
    const divulgacao = { ...grupo.divulgacao, fornecedores: [...grupo.divulgacao.fornecedores] };
    const newIdx = divulgacao.fornecedores.length;
    divulgacao.fornecedores.push({
      nome: `Canal ${newIdx + 1}`,
      valor_total: null,
      canal: '',
      descricao: '',
      contato: '',
      deadline: null,
      periodo: '',
    });
    onChange({ ...grupo, divulgacao });
    setAddedSources(prev => new Set([...prev, newIdx]));
  };

  const visibleIndices = grupo.divulgacao.fornecedores.map((_, i) => i).filter(i => isVisible(i));
  const hiddenSources = grupo.divulgacao.fornecedores.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(i));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
          <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Investimento Total em Divulgação</span>
          <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalGeral)}</div>
        </div>
        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
          <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Custo por Pax (rateado em {minPax})</span>
          <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalPorPax)}</div>
        </div>
      </div>

      <div className="space-y-3">
        {visibleIndices.map(fIdx => {
          const f = grupo.divulgacao.fornecedores[fIdx];

          return (
            <div key={fIdx} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4" style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--t-green)]/10 flex items-center justify-center">
                    <Megaphone className="w-4 h-4 text-[var(--t-green)]" />
                  </div>
                  <Input value={f.nome} onChange={e => update(fIdx, 'nome', e.target.value)} placeholder="Nome do canal / fornecedor" className="h-8 w-56 text-sm font-medium" />
                </div>
                <button onClick={() => clearSource(fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <MoneyCustoVenda
                  label="Valor Total"
                  custo={f.valor_total}
                  venda={f.valor_venda_total}
                  onCustoChange={v => update(fIdx, 'valor_total', v)}
                  onVendaChange={v => update(fIdx, 'valor_venda_total', v)}
                />
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Canal / Mídia</label>
                  <Input value={f.canal} onChange={e => update(fIdx, 'canal', e.target.value)} placeholder="Ex: Instagram Ads" className="h-8" />
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Descrição</label>
                  <Input value={f.descricao} onChange={e => update(fIdx, 'descricao', e.target.value)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Contato</label>
                  <Input value={f.contato} onChange={e => update(fIdx, 'contato', e.target.value)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                  <Input type="date" value={f.deadline || ''} onChange={e => update(fIdx, 'deadline', e.target.value || null)} className="h-8" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Período</label>
                  <Input value={f.periodo} onChange={e => update(fIdx, 'periodo', e.target.value)} placeholder="Ex: 30 dias" className="h-8" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {hiddenSources.length > 0 && (
          <div className="relative flex-1" ref={pickerOpen ? pickerRef : undefined}>
            <button onClick={() => setPickerOpen(!pickerOpen)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar canal sugerido</button>
            {pickerOpen && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-64 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione o canal</div>
                {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
              </div>
            )}
          </div>
        )}
        <button onClick={addCustom} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Novo canal personalizado</button>
      </div>

      {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhum canal de divulgação adicionado.</div>}
    </div>
  );
}
