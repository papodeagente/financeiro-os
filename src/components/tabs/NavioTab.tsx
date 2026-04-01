'use client';

import { GrupoViagem } from '@/lib/types';
import { minPositivo, formatBRL, calcDiarias } from '@/lib/utils';
import { calcNavioTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface Props { grupo: GrupoViagem; onChange: (g: GrupoViagem) => void; }

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

export function NavioTab({ grupo, onChange }: Props) {
  const totals = calcNavioTotals(grupo);
  const ni = grupo.navio_info;

  const updateFornecedor = (fIdx: number, field: string, value: number | null | string) => {
    const navio = { ...grupo.navio, fornecedores: [...grupo.navio.fornecedores] };
    navio.fornecedores[fIdx] = { ...navio.fornecedores[fIdx], [field]: value };
    onChange({ ...grupo, navio });
  };

  const updateNavio = (field: string, value: string | null) => {
    onChange({ ...grupo, navio: { ...grupo.navio, [field]: value } });
  };

  return (
    <div className="space-y-8">
      {/* Header info from INF */}
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg space-y-2">
        <div className="flex flex-wrap gap-6 text-sm">
          <div><span className="text-[#d4a853]">Cruzeiro:</span> {ni.nome_cruzeiro || '—'}</div>
          <div><span className="text-[#d4a853]">Embarque:</span> {ni.cidade_embarque || '—'}</div>
          <div><span className="text-[#d4a853]">Desembarque:</span> {ni.cidade_desembarque || '—'}</div>
          <div><span className="text-[#d4a853]">Diárias:</span> {calcDiarias(ni.embarque, ni.desembarque) || '—'}</div>
        </div>
        <div className="flex flex-wrap gap-4 mt-2">
          {TIPOS.map(t => (
            <div key={t}><span className="text-xs text-[#d4a853]">Melhor {LABELS[t]}</span><div className="text-lg font-bold">{formatBRL(totals[t])}</div></div>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <div><Label>Deadline</Label><Input type="date" value={grupo.navio.deadline || ''} onChange={e => updateNavio('deadline', e.target.value || null)} /></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[#1a1a2e] text-white">
            <th className="p-2 text-left border border-gray-600">Fornecedor</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-gray-600 w-28">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            {grupo.navio.fornecedores.map((f, fIdx) => (
              <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="p-1 border"><Input value={f.nome} onChange={e => updateFornecedor(fIdx, 'nome', e.target.value)} className="h-8" /></td>
                {TIPOS.map(t => {
                  const key = `valor_${t}` as keyof typeof f;
                  const val = f[key] as number | null;
                  const isMin = val !== null && val > 0 && val === totals[t];
                  return <td key={t} className="p-1 border"><MoneyInput value={val} onChange={v => updateFornecedor(fIdx, key, v)} highlight={isMin} /></td>;
                })}
              </tr>
            ))}
            <tr className="bg-green-100 font-bold">
              <td className="p-2 border text-green-800">MELHOR R$</td>
              {TIPOS.map(t => <td key={t} className="p-2 border text-right text-green-800">{formatBRL(totals[t])}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <Label>Informações Adicionais / Roteiro</Label>
        <Textarea value={grupo.navio.info_adicional} onChange={e => updateNavio('info_adicional', e.target.value)} rows={6} />
      </div>
    </div>
  );
}
