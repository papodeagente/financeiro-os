'use client';

import { useState } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createHtlHotel } from '@/lib/defaults';
import { minPositivo, formatBRL, calcDiarias } from '@/lib/utils';
import { calcHtlTotals } from '@/lib/calculations';
import { MoneyInput } from '@/components/MoneyInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Hotel } from 'lucide-react';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatHotelForHtlInfo } from '@/lib/hotel-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const TIPO_LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

export function HtlTab({ grupo, onChange }: Props) {
  const totals = calcHtlTotals(grupo);
  const [hotelModalOpen, setHotelModalOpen] = useState<number | null>(null);

  const updateFonte = (hotelIdx: number, fonteIdx: number, field: string, value: number | null) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], fontes: [...htl.hoteis[hotelIdx].fontes] };
    htl.hoteis[hotelIdx].fontes[fonteIdx] = { ...htl.hoteis[hotelIdx].fontes[fonteIdx], [field]: value };
    onChange({ ...grupo, htl });
  };

  const updateInfo = (hotelIdx: number, field: string, value: string | null) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], info: { ...htl.hoteis[hotelIdx].info, [field]: value } };
    onChange({ ...grupo, htl });
  };

  const addHotel = () => {
    if (grupo.htl.hoteis.length < 10) {
      onChange({ ...grupo, htl: { hoteis: [...grupo.htl.hoteis, createHtlHotel()] } });
    }
  };

  const removeHotel = (idx: number) => {
    onChange({ ...grupo, htl: { hoteis: grupo.htl.hoteis.filter((_, i) => i !== idx) } });
  };

  const handleHotelSelect = (hotelIdx: number, place: GooglePlace) => {
    const htl = { ...grupo.htl, hoteis: [...grupo.htl.hoteis] };
    htl.hoteis[hotelIdx] = { ...htl.hoteis[hotelIdx], info: { ...htl.hoteis[hotelIdx].info } };
    const info = htl.hoteis[hotelIdx].info;
    const mapped = formatHotelForHtlInfo(place);

    // Fill empty fields only
    if (!info.estacionamento && mapped.estacionamento) info.estacionamento = mapped.estacionamento;

    // Always append API data to info_adicional
    if (mapped.info_adicional) {
      info.info_adicional = info.info_adicional
        ? `${info.info_adicional}\n\n${mapped.info_adicional}`
        : mapped.info_adicional;
    }

    onChange({ ...grupo, htl });
  };

  return (
    <div className="space-y-8">
      {/* Totals */}
      <div className="bg-[#1a1a2e] text-white p-4 rounded-lg flex flex-wrap gap-4">
        {TIPOS.map(t => (
          <div key={t}><span className="text-xs text-[#d4a853]">Total {TIPO_LABELS[t]}</span><div className="text-lg font-bold">{formatBRL(totals.totals[t])}</div></div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addHotel} disabled={grupo.htl.hoteis.length >= 10}>
          <Plus className="w-4 h-4 mr-1" /> Hotel
        </Button>
      </div>

      {grupo.htl.hoteis.map((hotel, hIdx) => {
        const periodo = grupo.periodos[hIdx];
        const bests = Object.fromEntries(TIPOS.map(t => [t, minPositivo(hotel.fontes.map(f => f[`valor_${t}` as keyof typeof f] as number | null))]));

        return (
          <div key={hIdx} className="border rounded-lg overflow-hidden">
            <div className="bg-[#1a1a2e] text-white p-3 flex items-center justify-between">
              <div>
                <span className="font-semibold">{periodo?.hotel || `Hotel ${hIdx + 1}`}</span>
                {periodo && (
                  <span className="text-sm text-gray-300 ml-3">
                    {periodo.destino} | {calcDiarias(periodo.check_in, periodo.check_out)} diárias
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setHotelModalOpen(hIdx)} className="text-emerald-300 border-emerald-300/30 hover:bg-emerald-500/10 hover:text-emerald-200">
                  <Hotel className="w-4 h-4 mr-1" /> Buscar hotel via API
                </Button>
                {grupo.htl.hoteis.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeHotel(hIdx)} className="text-red-300">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 text-left border">Fonte</th>
                    {TIPOS.map(t => <th key={t} className="p-2 border w-28">{TIPO_LABELS[t]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hotel.fontes.map((fonte, fIdx) => (
                    <tr key={fIdx} className={fIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="p-2 border font-medium text-xs">{fonte.nome}</td>
                      {TIPOS.map(t => {
                        const key = `valor_${t}` as keyof typeof fonte;
                        const val = fonte[key] as number | null;
                        const isMin = val !== null && val > 0 && val === bests[t];
                        return (
                          <td key={t} className="p-1 border">
                            <MoneyInput value={val} onChange={v => updateFonte(hIdx, fIdx, key, v)} highlight={isMin} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-green-100 font-bold">
                    <td className="p-2 border text-green-800">MELHOR R$</td>
                    {TIPOS.map(t => <td key={t} className="p-2 border text-right text-green-800">{formatBRL(bests[t])}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Info panel */}
            <div className="p-4 bg-gray-50 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><Label className="text-xs">Deadline</Label><Input type="date" value={hotel.info.deadline || ''} onChange={e => updateInfo(hIdx, 'deadline', e.target.value || null)} className="h-8" /></div>
              <div><Label className="text-xs">Check-in Hora</Label><Input value={hotel.info.check_in_hora} onChange={e => updateInfo(hIdx, 'check_in_hora', e.target.value)} className="h-8" placeholder="14:00" /></div>
              <div><Label className="text-xs">Check-out Hora</Label><Input value={hotel.info.check_out_hora} onChange={e => updateInfo(hIdx, 'check_out_hora', e.target.value)} className="h-8" placeholder="12:00" /></div>
              <div><Label className="text-xs">Pensão</Label><Input value={hotel.info.pensao} onChange={e => updateInfo(hIdx, 'pensao', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Estacionamento</Label><Input value={hotel.info.estacionamento} onChange={e => updateInfo(hIdx, 'estacionamento', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Política CHD</Label><Input value={hotel.info.politica_chd} onChange={e => updateInfo(hIdx, 'politica_chd', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Política Free</Label><Input value={hotel.info.politica_free} onChange={e => updateInfo(hIdx, 'politica_free', e.target.value)} className="h-8" /></div>
              <div className="col-span-2 md:col-span-4"><Label className="text-xs">Info Adicional</Label><Textarea value={hotel.info.info_adicional} onChange={e => updateInfo(hIdx, 'info_adicional', e.target.value)} rows={2} /></div>
            </div>
          </div>
        );
      })}

      {/* Hotel Search Modal */}
      <HotelSearchModal
        open={hotelModalOpen !== null}
        onClose={() => setHotelModalOpen(null)}
        onSelect={(place) => {
          if (hotelModalOpen !== null) handleHotelSelect(hotelModalOpen, place);
        }}
        defaultDestino={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.destino || '' : ''}
        defaultHotelName={hotelModalOpen !== null ? grupo.periodos[hotelModalOpen]?.hotel || '' : ''}
      />
    </div>
  );
}
