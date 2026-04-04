'use client';

import { Input } from '@/components/ui/input';
import { ImageUpload } from '../ImageUpload';
import type { BlockProps } from './types';
import type { AlojamentoData, RegimeRefeicao } from '@/lib/crm-types';

const REGIMES: { id: RegimeRefeicao; label: string }[] = [
  { id: 'RO', label: 'Room Only' },
  { id: 'BB', label: 'Bed & Breakfast' },
  { id: 'HB', label: 'Half Board' },
  { id: 'FB', label: 'Full Board' },
  { id: 'AI', label: 'All Inclusive' },
];

function calcNoites(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const d1 = new Date(checkIn + 'T12:00:00');
  const d2 = new Date(checkOut + 'T12:00:00');
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
}

export function AlojamentoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as Partial<AlojamentoData>;

  const update = (patch: Partial<AlojamentoData>) => {
    const merged = { ...conteudo, ...patch };
    // Auto-calc noites
    if ('check_in' in patch || 'check_out' in patch) {
      merged.noites = calcNoites(
        (patch.check_in ?? c.check_in) || '',
        (patch.check_out ?? c.check_out) || ''
      );
    }
    onChange(merged as Record<string, unknown>);
  };

  return (
    <div className="space-y-3">
      {/* Viagem noturna toggle */}
      <label className="flex items-center gap-2 text-xs text-[var(--t-text-secondary)]">
        <input
          type="checkbox"
          checked={!!c.viagem_noturna}
          onChange={e => update({ viagem_noturna: e.target.checked })}
          className="rounded"
        />
        Viagem noturna (transito aereo, sem hotel)
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Destino</label>
          <Input
            value={c.destino_nome || ''}
            onChange={e => update({ destino_nome: e.target.value })}
            placeholder="Ex: Jerusalem"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Hotel</label>
          <Input
            value={c.hotel_nome || ''}
            onChange={e => update({ hotel_nome: e.target.value })}
            placeholder="Nome do hotel"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Estrelas</label>
          <select
            value={c.hotel_estrelas || 0}
            onChange={e => update({ hotel_estrelas: Number(e.target.value) })}
            className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-2 py-2 text-sm"
          >
            <option value={0}>—</option>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Regime</label>
          <select
            value={c.regime || 'BB'}
            onChange={e => update({ regime: e.target.value as RegimeRefeicao })}
            className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-2 py-2 text-sm"
          >
            {REGIMES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Tipo quarto</label>
          <Input
            value={c.quarto_tipo || ''}
            onChange={e => update({ quarto_tipo: e.target.value })}
            placeholder="DBL, SGL..."
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Check-in</label>
          <Input
            type="date"
            value={c.check_in || ''}
            onChange={e => update({ check_in: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Check-out</label>
          <Input
            type="date"
            value={c.check_out || ''}
            onChange={e => update({ check_out: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Noites</label>
          <Input
            type="number"
            value={c.noites || 0}
            readOnly
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm opacity-60"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-[var(--t-text-muted)]">Descricao do hotel</label>
        <textarea
          value={c.hotel_descricao || ''}
          onChange={e => update({ hotel_descricao: e.target.value })}
          rows={2}
          placeholder="Descricao, comodidades..."
          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Bebidas</label>
          <Input
            value={c.bebidas || ''}
            onChange={e => update({ bebidas: e.target.value })}
            placeholder="Incluso, nao incluso..."
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Link do hotel</label>
          <Input
            value={c.hotel_link || ''}
            onChange={e => update({ hotel_link: e.target.value })}
            placeholder="https://..."
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-[var(--t-text-muted)]">Imagem principal</label>
        <ImageUpload
          compact
          currentUrl={c.hotel_imagem || ''}
          onUpload={urls => update({ hotel_imagem: urls[0] })}
          onRemove={() => update({ hotel_imagem: '' })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Latitude</label>
          <Input
            type="number"
            step="any"
            value={c.lat || ''}
            onChange={e => update({ lat: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="31.7683"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Longitude</label>
          <Input
            type="number"
            step="any"
            value={c.lng || ''}
            onChange={e => update({ lng: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="35.2137"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
      </div>
    </div>
  );
}
