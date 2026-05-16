'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Hotel, Search } from 'lucide-react';
import { ImageUpload } from '../ImageUpload';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatHotelForAlojamento } from '@/lib/hotel-data-mapper';
import type { SearchAPIHotelProperty } from '@/lib/searchapi-hotels';
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

function proxiedImg(url: string): string {
  if (!url) return '';
  if (url.startsWith('/') || url.includes('/api/img-proxy')) return url;
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

export function AlojamentoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as Partial<AlojamentoData>;
  const [hotelModalOpen, setHotelModalOpen] = useState(false);

  const update = (patch: Partial<AlojamentoData>) => {
    const merged = { ...conteudo, ...patch };
    if ('check_in' in patch || 'check_out' in patch) {
      merged.noites = calcNoites(
        (patch.check_in ?? c.check_in) || '',
        (patch.check_out ?? c.check_out) || ''
      );
    }
    onChange(merged as Record<string, unknown>);
  };

  // Aplica os dados do hotel selecionado na API direto no bloco atual.
  // Preserva configuracoes do usuario que NAO vem da API: check_in,
  // check_out, noites, regime, quarto_tipo, bebidas — pra que datas/
  // base ja preenchidas nao sejam sobrescritas.
  const handleHotelSelect = (hotel: SearchAPIHotelProperty) => {
    const mapped = formatHotelForAlojamento(hotel);
    onChange({
      ...conteudo,
      ...mapped,
      // Preserva o id do bloco existente (NAO substituir pelo id gerado
      // pelo mapper — quebraria refs).
      id: c.id || (mapped.id as string),
      // Preserva datas/regime que o usuario ja configurou
      check_in: c.check_in || '',
      check_out: c.check_out || '',
      noites: c.noites || 0,
      regime: c.regime || 'BB',
      quarto_tipo: c.quarto_tipo || '',
      bebidas: c.bebidas || '',
    });
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

      {/* Buscar Hotel na API — abre modal in-place e ATUALIZA este bloco
          com o hotel selecionado (preserva datas/regime ja preenchidos). */}
      <button
        onClick={() => setHotelModalOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-400 text-emerald-600 text-xs font-medium transition-all"
      >
        <Hotel className="w-4 h-4" />
        <Search className="w-3.5 h-3.5" />
        {c.hotel_nome ? 'Trocar hotel via API' : 'Buscar Hotel na API'}
      </button>
      <HotelSearchModal
        open={hotelModalOpen}
        onClose={() => setHotelModalOpen(false)}
        onSelect={handleHotelSelect}
        defaultDestino={c.destino_nome || ''}
        defaultHotelName={c.hotel_nome || ''}
        defaultCheckIn={c.check_in || ''}
        defaultCheckOut={c.check_out || ''}
      />

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
            onChange={e => {
              const v = e.target.value;
              const patch: Partial<AlojamentoData> = { check_in: v };
              // Se check-out for antes do novo check-in, limpa
              if (c.check_out && v && c.check_out <= v) patch.check_out = '';
              update(patch);
            }}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Check-out</label>
          <Input
            type="date"
            value={c.check_out || ''}
            min={c.check_in ? new Date(new Date(c.check_in).getTime() + 86400000).toISOString().split('T')[0] : ''}
            disabled={!c.check_in}
            title={!c.check_in ? 'Defina primeiro o check-in' : ''}
            onChange={e => update({ check_out: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm disabled:opacity-50"
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

      {/* Gallery preview */}
      {c.hotel_galeria && c.hotel_galeria.length > 0 && (
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Galeria ({c.hotel_galeria.length} fotos)</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1 mt-1">
            {c.hotel_galeria.map((url, i) => (
              <img key={i} src={proxiedImg(url as string)} alt={`Foto ${i + 1}`}
                referrerPolicy="no-referrer"
                className="w-20 h-14 object-cover rounded shrink-0 cursor-pointer hover:opacity-80"
                onClick={() => window.open(url as string, '_blank')} loading="lazy" />
            ))}
          </div>
        </div>
      )}

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

      {/* Toggles de visibilidade na proposta pro cliente — só aparecem
          quando o hotel tem dados ricos importados da API */}
      {(c.rating || c.reviews_count || (c.amenities && c.amenities.length > 0) || (c.hotel_galeria && c.hotel_galeria.length > 1)) && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-2">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
            Detalhes do Google na proposta
          </div>
          {(c.rating !== undefined && c.rating !== null) && (
            <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={c.mostrar_avaliacao_google !== false}
                onChange={e => update({ mostrar_avaliacao_google: e.target.checked })}
                className="rounded"
              />
              <span>Mostrar avaliação Google ({c.rating}/5{c.reviews_count ? ` · ${c.reviews_count.toLocaleString('pt-BR')} avaliações` : ''})</span>
            </label>
          )}
          {c.amenities && c.amenities.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={c.mostrar_amenities !== false}
                onChange={e => update({ mostrar_amenities: e.target.checked })}
                className="rounded"
              />
              <span>Mostrar comodidades ({c.amenities.length})</span>
            </label>
          )}
          {c.hotel_galeria && c.hotel_galeria.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={c.mostrar_galeria !== false}
                onChange={e => update({ mostrar_galeria: e.target.checked })}
                className="rounded"
              />
              <span>Mostrar galeria de fotos ({c.hotel_galeria.length} imagens)</span>
            </label>
          )}
        </div>
      )}

    </div>
  );
}
