'use client';

import { GrupoViagem } from '@/lib/types';
import { createRecPasseio } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcRecTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function RecTab({ grupo, onChange }: Props) {
  const totals = calcRecTotals(grupo);

  const updatePasseio = (pIdx: number, field: string, value: string | null) => {
    const rec = { ...grupo.rec, passeios: [...grupo.rec.passeios] };
    rec.passeios[pIdx] = { ...rec.passeios[pIdx], [field]: value };
    onChange({ ...grupo, rec });
  };

  const updateFornecedor = (pIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const rec = { ...grupo.rec, passeios: [...grupo.rec.passeios] };
    rec.passeios[pIdx] = { ...rec.passeios[pIdx], fornecedores: [...rec.passeios[pIdx].fornecedores] };
    rec.passeios[pIdx].fornecedores[fIdx] = { ...rec.passeios[pIdx].fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, rec });
  };

  const addPasseio = () => {
    if (grupo.rec.passeios.length < 10) onChange({ ...grupo, rec: { passeios: [...grupo.rec.passeios, createRecPasseio()] } });
  };

  const removePasseio = (idx: number) => {
    onChange({ ...grupo, rec: { passeios: grupo.rec.passeios.filter((_, i) => i !== idx) } });
  };

  return (
    <div className="space-y-8">
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg flex flex-wrap gap-6">
        <div><span className="text-xs text-[#d4a853]">Total REC ADT</span><div className="text-lg font-bold">{formatBRL(totals.totalAdt)}</div></div>
        <div><span className="text-xs text-[#d4a853]">Total REC CHD</span><div className="text-lg font-bold">{formatBRL(totals.totalChd)}</div></div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addPasseio} disabled={grupo.rec.passeios.length >= 10}><Plus className="w-4 h-4 mr-1" /> Passeio</Button>
      </div>

      {grupo.rec.passeios.map((passeio, pIdx) => {
        const melhorAdt = minPositivo(passeio.fornecedores.map(f => f.valor_adt));
        const melhorChd = minPositivo(passeio.fornecedores.map(f => f.valor_chd));
        return (
          <div key={pIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[#1a1a2e] text-white p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input value={passeio.nome} onChange={e => updatePasseio(pIdx, 'nome', e.target.value)} placeholder={`Passeio ${pIdx + 1}`} className="h-8 w-48 bg-white/10 text-white border-white/20" />
                <Input type="date" value={passeio.data || ''} onChange={e => updatePasseio(pIdx, 'data', e.target.value || null)} className="h-8 w-40 bg-white/10 text-white border-white/20" />
              </div>
              {grupo.rec.passeios.length > 1 && <Button variant="ghost" size="sm" onClick={() => removePasseio(pIdx)} className="text-red-300"><Trash2 className="w-4 h-4" /></Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-gray-100">
                  <th className="p-2 text-left border">Fornecedor</th>
                  <th className="p-2 border w-36">Valor ADT</th>
                  <th className="p-2 border w-36">Valor CHD</th>
                  <th className="p-2 border w-36">Deadline</th>
                  <th className="p-2 border">Info</th>
                </tr></thead>
                <tbody>
                  {passeio.fornecedores.map((f, fIdx) => (
                    <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="p-2 border"><Input value={f.nome} onChange={e => updateFornecedor(pIdx, fIdx, 'nome', e.target.value)} className="h-8" /></td>
                      <td className="p-1 border"><MoneyInput value={f.valor_adt} onChange={v => updateFornecedor(pIdx, fIdx, 'valor_adt', v)} highlight={f.valor_adt !== null && f.valor_adt > 0 && f.valor_adt === melhorAdt} /></td>
                      <td className="p-1 border"><MoneyInput value={f.valor_chd} onChange={v => updateFornecedor(pIdx, fIdx, 'valor_chd', v)} highlight={f.valor_chd !== null && f.valor_chd > 0 && f.valor_chd === melhorChd} /></td>
                      <td className="p-1 border"><Input type="date" value={f.deadline || ''} onChange={e => updateFornecedor(pIdx, fIdx, 'deadline', e.target.value || null)} className="h-8" /></td>
                      <td className="p-1 border"><Textarea value={f.info} onChange={e => updateFornecedor(pIdx, fIdx, 'info', e.target.value)} rows={1} className="min-h-[32px]" /></td>
                    </tr>
                  ))}
                  <tr className="bg-green-100 font-bold">
                    <td className="p-2 border text-green-800">MELHOR R$</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorAdt)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhorChd)}</td>
                    <td className="p-2 border" colSpan={2}></td>
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
