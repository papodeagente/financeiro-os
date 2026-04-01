'use client';

import { GrupoViagem } from '@/lib/types';
import { createIngAtrativo } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcIngTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function IngTab({ grupo, onChange }: Props) {
  const totals = calcIngTotals(grupo);

  const updateAtrativo = (aIdx: number, field: string, value: string | null) => {
    const ing = { ...grupo.ing, atrativos: [...grupo.ing.atrativos] };
    ing.atrativos[aIdx] = { ...ing.atrativos[aIdx], [field]: value };
    onChange({ ...grupo, ing });
  };

  const updateFonte = (aIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const ing = { ...grupo.ing, atrativos: [...grupo.ing.atrativos] };
    ing.atrativos[aIdx] = { ...ing.atrativos[aIdx], fontes: [...ing.atrativos[aIdx].fontes] };
    ing.atrativos[aIdx].fontes[fIdx] = { ...ing.atrativos[aIdx].fontes[fIdx], [field]: value };
    onChange({ ...grupo, ing });
  };

  const addAtrativo = () => {
    if (grupo.ing.atrativos.length < 10) onChange({ ...grupo, ing: { atrativos: [...grupo.ing.atrativos, createIngAtrativo()] } });
  };

  const removeAtrativo = (idx: number) => {
    onChange({ ...grupo, ing: { atrativos: grupo.ing.atrativos.filter((_, i) => i !== idx) } });
  };

  return (
    <div className="space-y-8">
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg flex flex-wrap gap-6">
        <div><span className="text-xs text-[#d4a853]">Total ADT</span><div className="text-lg font-bold">{formatBRL(totals.totalAdt)}</div></div>
        <div><span className="text-xs text-[#d4a853]">Total CHD</span><div className="text-lg font-bold">{formatBRL(totals.totalChd)}</div></div>
        <div><span className="text-xs text-[#d4a853]">Total INF</span><div className="text-lg font-bold">{formatBRL(totals.totalInf)}</div></div>
        <div><span className="text-xs text-[#d4a853]">Total Meia</span><div className="text-lg font-bold">{formatBRL(totals.totalMeia)}</div></div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addAtrativo} disabled={grupo.ing.atrativos.length >= 10}><Plus className="w-4 h-4 mr-1" /> Atrativo</Button>
      </div>

      {grupo.ing.atrativos.map((atr, aIdx) => {
        const melhorAdt = minPositivo(atr.fontes.map(f => f.valor_adt));
        const melhorChd = minPositivo(atr.fontes.map(f => f.valor_chd));
        const melhorInf = minPositivo(atr.fontes.map(f => f.valor_inf));
        const melhorMeia = minPositivo(atr.fontes.map(f => f.valor_meia));
        return (
          <div key={aIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[#1a1a2e] text-white p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input value={atr.nome} onChange={e => updateAtrativo(aIdx, 'nome', e.target.value)} placeholder={`Atrativo ${aIdx + 1}`} className="h-8 w-48 bg-white/10 text-white border-white/20" />
                <Input type="date" value={atr.data || ''} onChange={e => updateAtrativo(aIdx, 'data', e.target.value || null)} className="h-8 w-40 bg-white/10 text-white border-white/20" />
              </div>
              {grupo.ing.atrativos.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeAtrativo(aIdx)} className="text-red-300"><Trash2 className="w-4 h-4" /></Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-gray-100">
                  <th className="p-2 text-left border">Fonte</th>
                  <th className="p-2 border w-28">ADT</th>
                  <th className="p-2 border w-28">CHD</th>
                  <th className="p-2 border w-28">INF</th>
                  <th className="p-2 border w-28">Meia</th>
                  <th className="p-2 border">Info</th>
                </tr></thead>
                <tbody>
                  {atr.fontes.map((f, fIdx) => (
                    <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="p-2 border font-medium text-xs">{f.nome}</td>
                      <td className="p-1 border"><MoneyInput value={f.valor_adt} onChange={v => updateFonte(aIdx, fIdx, 'valor_adt', v)} highlight={f.valor_adt !== null && f.valor_adt > 0 && f.valor_adt === melhorAdt} /></td>
                      <td className="p-1 border"><MoneyInput value={f.valor_chd} onChange={v => updateFonte(aIdx, fIdx, 'valor_chd', v)} highlight={f.valor_chd !== null && f.valor_chd > 0 && f.valor_chd === melhorChd} /></td>
                      <td className="p-1 border"><MoneyInput value={f.valor_inf} onChange={v => updateFonte(aIdx, fIdx, 'valor_inf', v)} highlight={f.valor_inf !== null && f.valor_inf > 0 && f.valor_inf === melhorInf} /></td>
                      <td className="p-1 border"><MoneyInput value={f.valor_meia} onChange={v => updateFonte(aIdx, fIdx, 'valor_meia', v)} highlight={f.valor_meia !== null && f.valor_meia > 0 && f.valor_meia === melhorMeia} /></td>
                      <td className="p-1 border"><Textarea value={f.info} onChange={e => updateFonte(aIdx, fIdx, 'info', e.target.value)} rows={1} className="min-h-[32px]" /></td>
                    </tr>
                  ))}
                  <tr className="bg-green-100 font-bold">
                    <td className="p-2 border text-green-800">MELHOR R$</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorAdt)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorChd)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorInf)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorMeia)}</td>
                    <td className="p-2 border"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
