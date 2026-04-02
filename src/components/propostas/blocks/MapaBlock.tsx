'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

interface Ponto { lat: number; lng: number; label: string }

export function MapaBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { titulo?: string; pontos?: Ponto[]; zoom?: number };
  const pontos = c.pontos || [];

  return (
    <div className="space-y-2">
      <Input
        value={c.titulo || ''}
        onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
        placeholder="Titulo do mapa (opcional)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      {pontos.map((p, i) => (
        <div key={i} className="grid grid-cols-5 gap-2">
          <Input
            value={p.label}
            onChange={e => {
              const arr = [...pontos]; arr[i] = { ...arr[i], label: e.target.value };
              onChange({ ...conteudo, pontos: arr });
            }}
            placeholder="Local"
            className="col-span-2 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
          />
          <Input
            type="number" step="any"
            value={p.lat || ''}
            onChange={e => {
              const arr = [...pontos]; arr[i] = { ...arr[i], lat: Number(e.target.value) };
              onChange({ ...conteudo, pontos: arr });
            }}
            placeholder="Lat"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
          />
          <Input
            type="number" step="any"
            value={p.lng || ''}
            onChange={e => {
              const arr = [...pontos]; arr[i] = { ...arr[i], lng: Number(e.target.value) };
              onChange({ ...conteudo, pontos: arr });
            }}
            placeholder="Lng"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
          />
          <Button variant="ghost" size="sm" className="text-red-400"
            onClick={() => onChange({ ...conteudo, pontos: pontos.filter((_, j) => j !== i) })}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, pontos: [...pontos, { lat: 0, lng: 0, label: '' }] })}>
        <Plus className="w-3 h-3 mr-1" /> Ponto
      </Button>
    </div>
  );
}
