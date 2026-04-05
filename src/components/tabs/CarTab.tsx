'use client';

import { GrupoViagem } from '@/lib/types';
import { createCarTransporte } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcCarTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Bus, Trophy, ArrowRight } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function CarTab({ grupo, onChange }: Props) {
  const totals = calcCarTotals(grupo);
  const minPax = grupo.params.qtd_min_pax || 1;

  const updateTransporte = (tIdx: number, field: string, value: string) => {
    const car = { ...grupo.car, transportes: [...grupo.car.transportes] };
    car.transportes[tIdx] = { ...car.transportes[tIdx], [field]: value };
    onChange({ ...grupo, car });
  };

  const updateEmpresa = (tIdx: number, eIdx: number, field: string, value: number | null | string) => {
    const car = { ...grupo.car, transportes: [...grupo.car.transportes] };
    car.transportes[tIdx] = { ...car.transportes[tIdx], empresas: [...car.transportes[tIdx].empresas] };
    car.transportes[tIdx].empresas[eIdx] = { ...car.transportes[tIdx].empresas[eIdx], [field]: value };
    onChange({ ...grupo, car });
  };

  const addTransporte = () => {
    if (grupo.car.transportes.length < 3) onChange({ ...grupo, car: { transportes: [...grupo.car.transportes, createCarTransporte()] } });
  };

  const removeTransporte = (idx: number) => {
    onChange({ ...grupo, car: { transportes: grupo.car.transportes.filter((_, i) => i !== idx) } });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
        <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total CAR por PAX</span>
        <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.totalPorPax)}</div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addTransporte} disabled={grupo.car.transportes.length >= 3}><Plus className="w-4 h-4 mr-1" /> Transporte</Button>
      </div>

      {grupo.car.transportes.map((transp, tIdx) => {
        const melhor = minPositivo(transp.empresas.map(e => e.valor_veiculo));
        const filledCount = transp.empresas.filter(e => e.valor_veiculo !== null && e.valor_veiculo > 0).length;

        return (
          <div key={tIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Bus className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div className="flex items-center gap-2">
                  <Input value={transp.origem} onChange={e => updateTransporte(tIdx, 'origem', e.target.value)} placeholder="Origem" className="h-9 w-40 font-medium" />
                  <ArrowRight className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
                  <Input value={transp.destino} onChange={e => updateTransporte(tIdx, 'destino', e.target.value)} placeholder="Destino" className="h-9 w-40 font-medium" />
                </div>
              </div>
              {grupo.car.transportes.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeTransporte(tIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="p-4 space-y-4">
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex gap-6">
                    <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">Veículo</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhor)}</div></div>
                    <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">Por PAX</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhor / minPax)}</div></div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {transp.empresas.map((emp, eIdx) => {
                  const valPax = emp.valor_veiculo ? emp.valor_veiculo / minPax : 0;
                  const isMin = emp.valor_veiculo !== null && emp.valor_veiculo > 0 && emp.valor_veiculo === melhor;

                  return (
                    <div key={eIdx} className={`rounded-xl border p-4 ${isMin ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-bold text-[var(--t-text-muted)] w-6">{eIdx + 1}.</span>
                        <Input value={emp.nome} onChange={e => updateEmpresa(tIdx, eIdx, 'nome', e.target.value)} placeholder="Nome da empresa" className="h-8 w-48 text-sm font-medium" />
                        {isMin && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor Veículo</label>
                          <MoneyInput value={emp.valor_veiculo} onChange={v => updateEmpresa(tIdx, eIdx, 'valor_veiculo', v)} highlight={isMin} />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor/PAX</label>
                          <div className="h-8 flex items-center text-sm font-medium text-[var(--t-text)]">{formatBRL(valPax)}</div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Telefone</label>
                          <Input value={emp.telefone} onChange={e => updateEmpresa(tIdx, eIdx, 'telefone', e.target.value)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Email</label>
                          <Input value={emp.email} onChange={e => updateEmpresa(tIdx, eIdx, 'email', e.target.value)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Contato</label>
                          <Input value={emp.contato} onChange={e => updateEmpresa(tIdx, eIdx, 'contato', e.target.value)} className="h-8" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Deadline</label>
                          <Input type="date" value={emp.deadline || ''} onChange={e => updateEmpresa(tIdx, eIdx, 'deadline', e.target.value || null)} className="h-8" />
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
