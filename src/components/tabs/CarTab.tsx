'use client';

import { GrupoViagem } from '@/lib/types';
import { createCarTransporte } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcCarTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

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
    <div className="space-y-8">
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg">
        <span className="text-xs text-[#d4a853]">Total CAR por PAX</span>
        <div className="text-lg font-bold">{formatBRL(totals.totalPorPax)}</div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addTransporte} disabled={grupo.car.transportes.length >= 3}><Plus className="w-4 h-4 mr-1" /> Transporte</Button>
      </div>

      {grupo.car.transportes.map((transp, tIdx) => {
        const melhor = minPositivo(transp.empresas.map(e => e.valor_veiculo));
        return (
          <div key={tIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[#1a1a2e] text-white p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input value={transp.origem} onChange={e => updateTransporte(tIdx, 'origem', e.target.value)} placeholder="Origem" className="h-8 w-40 bg-white/10 text-white border-white/20" />
                <span>→</span>
                <Input value={transp.destino} onChange={e => updateTransporte(tIdx, 'destino', e.target.value)} placeholder="Destino" className="h-8 w-40 bg-white/10 text-white border-white/20" />
              </div>
              {grupo.car.transportes.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeTransporte(tIdx)} className="text-red-300"><Trash2 className="w-4 h-4" /></Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-gray-100">
                  <th className="p-2 text-left border">Empresa</th>
                  <th className="p-2 border w-36">Valor Veículo</th>
                  <th className="p-2 border w-28">Valor/PAX</th>
                  <th className="p-2 border">Telefone</th>
                  <th className="p-2 border">Email</th>
                  <th className="p-2 border">Contato</th>
                  <th className="p-2 border w-36">Deadline</th>
                </tr></thead>
                <tbody>
                  {transp.empresas.map((emp, eIdx) => {
                    const valPax = emp.valor_veiculo ? emp.valor_veiculo / minPax : 0;
                    const isMin = emp.valor_veiculo !== null && emp.valor_veiculo > 0 && emp.valor_veiculo === melhor;
                    return (
                      <tr key={eIdx} className={eIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="p-1 border"><Input value={emp.nome} onChange={e => updateEmpresa(tIdx, eIdx, 'nome', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><MoneyInput value={emp.valor_veiculo} onChange={v => updateEmpresa(tIdx, eIdx, 'valor_veiculo', v)} highlight={isMin} /></td>
                        <td className="p-2 border text-right text-sm">{formatBRL(valPax)}</td>
                        <td className="p-1 border"><Input value={emp.telefone} onChange={e => updateEmpresa(tIdx, eIdx, 'telefone', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><Input value={emp.email} onChange={e => updateEmpresa(tIdx, eIdx, 'email', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><Input value={emp.contato} onChange={e => updateEmpresa(tIdx, eIdx, 'contato', e.target.value)} className="h-8" /></td>
                        <td className="p-1 border"><Input type="date" value={emp.deadline || ''} onChange={e => updateEmpresa(tIdx, eIdx, 'deadline', e.target.value || null)} className="h-8" /></td>
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
