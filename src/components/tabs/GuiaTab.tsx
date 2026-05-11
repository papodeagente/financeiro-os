'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createGuiaDestino } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcGuiaTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { FornecedorPicker } from '@/components/FornecedorPicker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, User, Trophy, Calendar } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

function fornecedorHasData(f: { valor_total: number | null }) {
  return f.valor_total !== null && f.valor_total > 0;
}

export function GuiaTab({ grupo, onChange }: Props) {
  const totals = calcGuiaTotals(grupo);
  const minPax = grupo.params.qtd_min_pax || 1;
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateFornecedor = (dIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const guia = { ...grupo.guia, destinos: [...grupo.guia.destinos] };
    guia.destinos[dIdx] = { ...guia.destinos[dIdx], fornecedores: [...guia.destinos[dIdx].fornecedores] };
    guia.destinos[dIdx].fornecedores[fIdx] = { ...guia.destinos[dIdx].fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, guia });
  };

  const updateDestino = (dIdx: number, field: string, value: string | null) => {
    const guia = { ...grupo.guia, destinos: [...grupo.guia.destinos] };
    guia.destinos[dIdx] = { ...guia.destinos[dIdx], [field]: value };
    onChange({ ...grupo, guia });
  };

  const addDestino = () => {
    if (grupo.guia.destinos.length < 4) onChange({ ...grupo, guia: { destinos: [...grupo.guia.destinos, createGuiaDestino()] } });
  };

  const removeDestino = (idx: number) => {
    onChange({ ...grupo, guia: { destinos: grupo.guia.destinos.filter((_, i) => i !== idx) } });
  };

  const isVisible = (dIdx: number, fIdx: number) =>
    fornecedorHasData(grupo.guia.destinos[dIdx].fornecedores[fIdx]) || addedSources[dIdx]?.has(fIdx) || false;

  const addSource = (dIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [dIdx]: new Set([...(prev[dIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (dIdx: number, fIdx: number) => {
    const guia = { ...grupo.guia, destinos: [...grupo.guia.destinos] };
    guia.destinos[dIdx] = { ...guia.destinos[dIdx], fornecedores: [...guia.destinos[dIdx].fornecedores] };
    guia.destinos[dIdx].fornecedores[fIdx] = { ...guia.destinos[dIdx].fornecedores[fIdx], valor_total: null };
    onChange({ ...grupo, guia });
    setAddedSources(prev => { const s = new Set(prev[dIdx] || []); s.delete(fIdx); return { ...prev, [dIdx]: s }; });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
        <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total GUIA por PAX</span>
        <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalPorPax)}</div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addDestino} disabled={grupo.guia.destinos.length >= 4}><Plus className="w-4 h-4 mr-1" /> Destino</Button>
      </div>

      {grupo.guia.destinos.map((dest, dIdx) => {
        const periodo = grupo.periodos[dIdx];
        const melhor = minPositivo(dest.fornecedores.map(f => f.valor_total));
        const visibleIndices = dest.fornecedores.map((_, i) => i).filter(i => isVisible(dIdx, i));
        const hiddenSources = dest.fornecedores.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(dIdx, i));
        const filledCount = dest.fornecedores.filter(fornecedorHasData).length;

        return (
          <div key={dIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--t-text)]">{periodo?.destino || `Destino ${dIdx + 1}`}</h3>
                    <span className="text-xs text-[var(--t-text-muted)]">Min. PAX: {minPax}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Calendar className="w-3 h-3 text-[var(--t-text-muted)]" />
                    <Input type="date" value={dest.inicio || ''} onChange={e => updateDestino(dIdx, 'inicio', e.target.value || null)} className="h-7 w-36 text-xs" placeholder="Início" />
                    <span className="text-[var(--t-text-muted)]">→</span>
                    <Input type="date" value={dest.termino || ''} onChange={e => updateDestino(dIdx, 'termino', e.target.value || null)} className="h-7 w-36 text-xs" placeholder="Término" />
                  </div>
                </div>
              </div>
              {grupo.guia.destinos.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeDestino(dIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="p-4 space-y-4">
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex gap-6">
                    <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">Total</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhor)}</div></div>
                    <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">Por PAX</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhor / minPax)}</div></div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {visibleIndices.map(fIdx => {
                  const f = dest.fornecedores[fIdx];
                  const valPax = f.valor_total ? f.valor_total / minPax : 0;
                  const isMin = f.valor_total !== null && f.valor_total > 0 && f.valor_total === melhor;

                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 ${isMin ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{fIdx + 1}.</span>
                          <div className="w-64">
                            <FornecedorPicker
                              value={f.fornecedor_id}
                              nome={f.nome}
                              tipoSugerido="OUTROS"
                              placeholder="Selecionar fornecedor"
                              onChange={sel => {
                                updateFornecedor(dIdx, fIdx, 'fornecedor_id', sel?.id || '');
                                updateFornecedor(dIdx, fIdx, 'nome', sel?.nome || '');
                              }}
                            />
                          </div>
                          {isMin && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                        </div>
                        <button onClick={() => clearSource(dIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <MoneyCustoVenda
                          label="Valor Total"
                          custo={f.valor_total}
                          venda={f.valor_venda_total}
                          onCustoChange={v => updateFornecedor(dIdx, fIdx, 'valor_total', v)}
                          onVendaChange={v => updateFornecedor(dIdx, fIdx, 'valor_venda_total', v)}
                          highlightCusto={isMin}
                        />
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor/PAX (rateio)</label>
                          <div className="h-8 flex items-center text-sm font-medium text-[var(--t-text)]">{formatBRL(valPax)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Telefone</label>
                          <Input value={f.telefone} onChange={e => updateFornecedor(dIdx, fIdx, 'telefone', e.target.value)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Email</label>
                          <Input value={f.email} onChange={e => updateFornecedor(dIdx, fIdx, 'email', e.target.value)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                          <Input type="date" value={f.deadline || ''} onChange={e => updateFornecedor(dIdx, fIdx, 'deadline', e.target.value || null)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Anotações</label>
                          <Textarea value={f.anotacoes} onChange={e => updateFornecedor(dIdx, fIdx, 'anotacoes', e.target.value)} rows={1} className="min-h-[32px]" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === dIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === dIdx ? null : dIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
                  {pickerOpen === dIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione o guia</div>
                      {hiddenSources.map(s => (<button key={s.idx} onClick={() => addSource(dIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>))}
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
