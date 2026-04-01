'use client';

import { GrupoViagem } from '@/lib/types';
import { createGuiaDestino } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcGuiaTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

export function GuiaTab({ grupo, onChange }: Props) {
  const totals = calcGuiaTotals(grupo);
  const minPax = grupo.params.qtd_min_pax || 1;

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

  return (
    <div className="space-y-8">
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg">
        <span className="text-xs text-[#d4a853]">Total GUIA por PAX</span>
        <div className="text-lg font-bold">{formatBRL(totals.totalPorPax)}</div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addDestino} disabled={grupo.guia.destinos.length >= 4}><Plus className="w-4 h-4 mr-1" /> Destino</Button>
      </div>

      {grupo.guia.destinos.map((dest, dIdx) => {
        const periodo = grupo.periodos[dIdx];
        const melhor = minPositivo(dest.fornecedores.map(f => f.valor_total));
        return (
          <div key={dIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[#1a1a2e] text-white p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-semibold">{periodo?.destino || `Destino ${dIdx + 1}`}</span>
                <span className="text-sm text-gray-300">Mín. PAX: {minPax}</span>
                <Input type="date" value={dest.inicio || ''} onChange={e => updateDestino(dIdx, 'inicio', e.target.value || null)} className="h-8 w-36 bg-white/10 text-white border-white/20" placeholder="Início" />
                <Input type="date" value={dest.termino || ''} onChange={e => updateDestino(dIdx, 'termino', e.target.value || null)} className="h-8 w-36 bg-white/10 text-white border-white/20" placeholder="Término" />
              </div>
              {grupo.guia.destinos.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeDestino(dIdx)} className="text-red-300"><Trash2 className="w-4 h-4" /></Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-gray-100">
                  <th className="p-2 text-left border">Guia</th>
                  <th className="p-2 border w-36">Valor Total</th>
                  <th className="p-2 border w-28">Valor/PAX</th>
                  <th className="p-2 border">Telefone</th>
                  <th className="p-2 border">Email</th>
                  <th className="p-2 border w-36">Deadline</th>
                  <th className="p-2 border">Anotações</th>
                </tr></thead>
                <tbody>
                  {dest.fornecedores.map((f, fIdx) => {
                    const valPax = f.valor_total ? f.valor_total / minPax : 0;
                    const isMin = f.valor_total !== null && f.valor_total > 0 && f.valor_total === melhor;
                    return (
                      <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="p-1 border"><Input value={f.nome} onChange={e => updateFornecedor(dIdx, fIdx, 'nome', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><MoneyInput value={f.valor_total} onChange={v => updateFornecedor(dIdx, fIdx, 'valor_total', v)} highlight={isMin} /></td>
                        <td className="p-2 border text-right">{formatBRL(valPax)}</td>
                        <td className="p-1 border"><Input value={f.telefone} onChange={e => updateFornecedor(dIdx, fIdx, 'telefone', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><Input value={f.email} onChange={e => updateFornecedor(dIdx, fIdx, 'email', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><Input type="date" value={f.deadline || ''} onChange={e => updateFornecedor(dIdx, fIdx, 'deadline', e.target.value || null)} className="h-8" /></td>
                        <td className="p-1 border"><Textarea value={f.anotacoes} onChange={e => updateFornecedor(dIdx, fIdx, 'anotacoes', e.target.value)} rows={1} className="min-h-[32px]" /></td>
                      </tr>
                    );
                  })}
                  <tr className="bg-green-100 font-bold">
                    <td className="p-2 border text-green-800">MELHOR R$</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhor)}</td>
                    <td className="p-2 border text-right text-green-800">{formatBRL(melhor / minPax)}</td>
                    <td className="p-2 border" colSpan={4}></td>
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
