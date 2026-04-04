'use client';

import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcSegTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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

  return (
    <div className="space-y-8">
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg flex flex-wrap gap-4">
        {TIPOS.map(t => (
          <div key={t}><span className="text-xs text-[var(--t-accent)]">Melhor {LABELS[t]}</span><div className="text-lg font-bold">{formatBRL(totals[t])}</div></div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)]">Seguradora</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-28">{LABELS[t]}</th>)}
            <th className="p-2 shadow-[var(--t-card-shadow)] w-36">Deadline</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Descrição</th>
          </tr></thead>
          <tbody>
            {grupo.seg.seguradoras.map((seg, sIdx) => {
              const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(grupo.seg.seguradoras.map(s => s[`valor_${t}` as keyof typeof s] as number | null))]));
              return (
                <tr key={sIdx} className={sIdx % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-1 border"><Input value={seg.nome} onChange={e => update(sIdx, 'nome', e.target.value)} className="h-8" /></td>
                  {TIPOS.map(t => {
                    const key = `valor_${t}` as keyof typeof seg;
                    const val = seg[key] as number | null;
                    const isMin = val !== null && val > 0 && val === bests[t];
                    return <td key={t} className="p-1 border"><MoneyInput value={val} onChange={v => update(sIdx, key, v)} highlight={isMin} /></td>;
                  })}
                  <td className="p-1 border"><Input type="date" value={seg.deadline || ''} onChange={e => update(sIdx, 'deadline', e.target.value || null)} className="h-8" /></td>
                  <td className="p-1 border"><Textarea value={seg.descricao} onChange={e => update(sIdx, 'descricao', e.target.value)} rows={1} className="min-h-[32px]" /></td>
                </tr>
              );
            })}
            <tr className="bg-green-100 font-bold">
              <td className="p-2 border text-green-800">MELHOR R$</td>
              {TIPOS.map(t => <td key={t} className="p-2 border text-right text-green-800">{formatBRL(totals[t])}</td>)}
              <td className="p-2 border" colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
