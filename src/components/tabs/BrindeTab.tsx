'use client';

import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcBrindeTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Gift, Trophy } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function BrindeTab({ grupo, onChange }: Props) {
  const totals = calcBrindeTotals(grupo);

  const update = (fIdx: number, field: string, value: number | null | string) => {
    const brinde = { ...grupo.brinde, fornecedores: [...grupo.brinde.fornecedores] };
    brinde.fornecedores[fIdx] = { ...brinde.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, brinde });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
        <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Melhor Preço Unitário</span>
        <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals.melhorPreco)}</div>
      </div>

      <div className="space-y-3">
        {grupo.brinde.fornecedores.map((f, fIdx) => {
          const isMin = f.valor_unidade !== null && f.valor_unidade > 0 && f.valor_unidade === totals.melhorPreco;

          return (
            <div key={fIdx} className={`rounded-xl border p-4 ${isMin ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-surface)]'}`} style={{ boxShadow: 'var(--elevation-1)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--t-green)]/10 flex items-center justify-center">
                  <Gift className="w-4 h-4 text-[var(--t-green)]" />
                </div>
                <Input value={f.nome} onChange={e => update(fIdx, 'nome', e.target.value)} placeholder="Nome do fornecedor" className="h-8 w-48 text-sm font-medium" />
                {isMin && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Valor Unid.</label>
                  <MoneyInput value={f.valor_unidade} onChange={v => update(fIdx, 'valor_unidade', v)} highlight={isMin} />
                </div>
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
                  <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Prazo Entrega</label>
                  <Input value={f.prazo_entrega} onChange={e => update(fIdx, 'prazo_entrega', e.target.value)} className="h-8" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
