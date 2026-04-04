'use client';

import { Input } from '@/components/ui/input';
import type { BlockProps } from './types';
import type { TransporteData, TipoTransporte } from '@/lib/crm-types';

const TIPOS: { id: TipoTransporte; label: string; icon: string }[] = [
  { id: 'VOO', label: 'Voo', icon: '✈️' },
  { id: 'TRANSFER', label: 'Transfer', icon: '🚐' },
  { id: 'TREM', label: 'Trem', icon: '🚆' },
  { id: 'ONIBUS', label: 'Onibus', icon: '🚌' },
  { id: 'CARRO', label: 'Carro', icon: '🚗' },
  { id: 'BARCO', label: 'Barco', icon: '⛴️' },
];

export function TransporteBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as Partial<TransporteData>;

  const update = (patch: Partial<TransporteData>) => {
    onChange({ ...conteudo, ...patch } as Record<string, unknown>);
  };

  const isVoo = c.tipo === 'VOO';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Tipo</label>
          <select
            value={c.tipo || 'TRANSFER'}
            onChange={e => update({ tipo: e.target.value as TipoTransporte })}
            className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-2 py-2 text-sm"
          >
            {TIPOS.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Data</label>
          <Input
            type="date"
            value={c.data || ''}
            onChange={e => update({ data: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Origem</label>
          <Input
            value={c.origem || ''}
            onChange={e => update({ origem: e.target.value })}
            placeholder="Ex: GRU / Tel Aviv"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Destino</label>
          <Input
            value={c.destino || ''}
            onChange={e => update({ destino: e.target.value })}
            placeholder="Ex: TLV / Jerusalem"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      {isVoo && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Companhia</label>
            <Input
              value={c.companhia || ''}
              onChange={e => update({ companhia: e.target.value })}
              placeholder="LATAM, GOL..."
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Numero do voo</label>
            <Input
              value={c.numero_voo || ''}
              onChange={e => update({ numero_voo: e.target.value })}
              placeholder="LA8084"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Horario saida</label>
          <Input
            type="time"
            value={c.horario_saida || ''}
            onChange={e => update({ horario_saida: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Horario chegada</label>
          <Input
            type="time"
            value={c.horario_chegada || ''}
            onChange={e => update({ horario_chegada: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      {!isVoo && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Distancia (km)</label>
            <Input
              type="number"
              value={c.distancia_km || ''}
              onChange={e => update({ distancia_km: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="120"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Tempo estimado</label>
            <Input
              value={c.tempo_estimado || ''}
              onChange={e => update({ tempo_estimado: e.target.value })}
              placeholder="1h30"
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-[10px] text-[var(--t-text-muted)]">Detalhes</label>
        <textarea
          value={c.detalhes || ''}
          onChange={e => update({ detalhes: e.target.value })}
          rows={2}
          placeholder="Informacoes adicionais..."
          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
        />
      </div>
    </div>
  );
}
