'use client';

import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcBrindeTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function BrindeTab({ grupo, onChange }: Props) {
  const totals = calcBrindeTotals(grupo);

  const update = (fIdx: number, field: string, value: number | null | string) => {
    const brinde = { ...grupo.brinde, fornecedores: [...grupo.brinde.fornecedores] };
    brinde.fornecedores[fIdx] = { ...brinde.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, brinde });
  };

  return (
    <div className="space-y-8">
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg">
        <span className="text-xs text-[var(--t-accent)]">Melhor Preço Unitário</span>
        <div className="text-lg font-bold">{formatBRL(totals.melhorPreco)}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)]">Fornecedor</th>
            <th className="p-2 border border-[var(--t-border)] w-32">Valor Unid.</th>
            <th className="p-2 border border-[var(--t-border)]">Descrição</th>
            <th className="p-2 border border-[var(--t-border)]">Contato</th>
            <th className="p-2 border border-[var(--t-border)] w-36">Deadline</th>
            <th className="p-2 border border-[var(--t-border)]">Prazo Entrega</th>
          </tr></thead>
          <tbody>
            {grupo.brinde.fornecedores.map((f, fIdx) => {
              const isMin = f.valor_unidade !== null && f.valor_unidade > 0 && f.valor_unidade === totals.melhorPreco;
              return (
                <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-1 border"><Input value={f.nome} onChange={e => update(fIdx, 'nome', e.target.value)} className="h-8" /></td>
                  <td className="p-1 border"><MoneyInput value={f.valor_unidade} onChange={v => update(fIdx, 'valor_unidade', v)} highlight={isMin} /></td>
                  <td className="p-1 border"><Input value={f.descricao} onChange={e => update(fIdx, 'descricao', e.target.value)} className="h-8" /></td>
                  <td className="p-1 border"><Input value={f.contato} onChange={e => update(fIdx, 'contato', e.target.value)} className="h-8" /></td>
                  <td className="p-1 border"><Input type="date" value={f.deadline || ''} onChange={e => update(fIdx, 'deadline', e.target.value || null)} className="h-8" /></td>
                  <td className="p-1 border"><Input value={f.prazo_entrega} onChange={e => update(fIdx, 'prazo_entrega', e.target.value)} className="h-8" /></td>
                </tr>
              );
            })}
            <tr className="bg-green-100 font-bold">
              <td className="p-2 border text-green-800">MELHOR R$</td>
              <td className="p-2 border text-right text-green-800">{formatBRL(totals.melhorPreco)}</td>
              <td className="p-2 border" colSpan={4}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
