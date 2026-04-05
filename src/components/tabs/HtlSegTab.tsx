'use client';

import { GrupoViagem } from '@/lib/types';
import { calcHtlTotals, calcSegTotals } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';

interface Props { grupo: GrupoViagem; }

const ALL_TIPOS_ROOM = [
  { tipo: 'sgl', label: 'SGL', ocup: 1 },
  { tipo: 'dbl', label: 'DBL', ocup: 2 },
  { tipo: 'tpl', label: 'TPL', ocup: 3 },
  { tipo: 'qdp', label: 'QDP', ocup: 4 },
] as const;

export function HtlSegTab({ grupo }: Props) {
  const tarifas = grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp'];
  const TIPOS_ROOM = ALL_TIPOS_ROOM.filter(t => tarifas.includes(t.tipo as 'sgl' | 'dbl' | 'tpl' | 'qdp'));
  const htl = calcHtlTotals(grupo);
  const seg = calcSegTotals(grupo);
  const parcelas = grupo.params.parcelas || 1;
  const percEntrada = 0.10; // 10% default

  const rows = TIPOS_ROOM.map(({ tipo, label, ocup }) => {
    const totalHtl = htl.totals[tipo] || 0;
    // TPL: seguro = seg_dbl * 1.5, QDP: seg_dbl * 2.0
    let seguro: number;
    if (tipo === 'tpl') seguro = (seg['dbl'] || 0) * 1.5;
    else if (tipo === 'qdp') seguro = (seg['dbl'] || 0) * 2.0;
    else seguro = seg[tipo] || 0;

    const totalAptoSeg = totalHtl + seguro;
    const totalPorAdt = totalAptoSeg / ocup;
    const entrada = (seguro / ocup) + ((totalHtl / ocup) * percEntrada);
    const parcelaPorAdt = parcelas > 0 ? (totalPorAdt - entrada) / parcelas : 0;
    const provaDo9 = ((entrada + parcelas * parcelaPorAdt) * ocup) - totalAptoSeg;

    return { tipo, label, ocup, totalHtl, seguro, totalAptoSeg, totalPorAdt, entrada, parcelaPorAdt, provaDo9 };
  });

  return (
    <div className="space-y-8">
      <div className="bg-amber-50 border border-amber-400 text-amber-800 p-3 rounded-lg text-sm font-medium">
        Tabela auxiliar HTL + SEG (somente leitura)
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 shadow-[var(--t-card-shadow)]">Tipo</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Ocup.</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Total Apto (HTL)</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Seguro</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Total (HTL+SEG)</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Total p/ ADT</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Entrada (10%)</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">{parcelas}x Parcela</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Parcela p/ ADT</th>
            <th className="p-2 shadow-[var(--t-card-shadow)]">Prova do 9</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.tipo} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                <td className="p-2 border font-bold">{r.label}</td>
                <td className="p-2 border text-center">{r.ocup}</td>
                <td className="p-2 border text-right">{formatBRL(r.totalHtl)}</td>
                <td className="p-2 border text-right">{formatBRL(r.seguro)}</td>
                <td className="p-2 border text-right font-bold">{formatBRL(r.totalAptoSeg)}</td>
                <td className="p-2 border text-right">{formatBRL(r.totalPorAdt)}</td>
                <td className="p-2 border text-right">{formatBRL(r.entrada)}</td>
                <td className="p-2 border text-center">{parcelas}</td>
                <td className="p-2 border text-right">{formatBRL(r.parcelaPorAdt)}</td>
                <td className={`p-2 border text-right font-bold ${Math.abs(r.provaDo9) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                  {r.provaDo9.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
