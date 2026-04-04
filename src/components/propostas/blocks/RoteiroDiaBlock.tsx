'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

interface Dia {
  numero: number;
  titulo: string;
  descricao: string;
  imagem?: string;
  lat?: number;
  lng?: number;
  atividades: string[];
}

export function RoteiroDiaBlock({ conteudo, onChange }: BlockProps) {
  const dias = (conteudo as { dias?: Dia[] }).dias || [];

  const updateDia = (i: number, patch: Partial<Dia>) => {
    const arr = [...dias];
    arr[i] = { ...arr[i], ...patch };
    onChange({ ...conteudo, dias: arr });
  };

  return (
    <div className="space-y-2">
      {dias.map((dia, i) => (
        <div key={i} className="p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] space-y-2">
          <div className="flex gap-2">
            <Input
              value={dia.titulo}
              onChange={e => updateDia(i, { titulo: e.target.value })}
              placeholder={`Dia ${dia.numero}`}
              className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] flex-1"
            />
            <Button variant="ghost" size="sm" className="text-red-400 shrink-0"
              onClick={() => onChange({ ...conteudo, dias: dias.filter((_, j) => j !== i) })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <textarea
            value={dia.descricao}
            onChange={e => updateDia(i, { descricao: e.target.value })}
            rows={2}
            placeholder="Descricao do dia..."
            className="w-full bg-[var(--t-bg-secondary)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <ImageUpload
              compact
              currentUrl={dia.imagem}
              onUpload={urls => updateDia(i, { imagem: urls[0] })}
              onRemove={() => updateDia(i, { imagem: '' })}
            />
            <Input
              type="number"
              step="any"
              value={dia.lat || ''}
              onChange={e => updateDia(i, { lat: Number(e.target.value) || undefined })}
              placeholder="Lat"
              className="w-20 bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
            />
            <Input
              type="number"
              step="any"
              value={dia.lng || ''}
              onChange={e => updateDia(i, { lng: Number(e.target.value) || undefined })}
              placeholder="Lng"
              className="w-20 bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
            />
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, dias: [...dias, { numero: dias.length + 1, titulo: `Dia ${dias.length + 1}`, descricao: '', atividades: [] }] })}>
        <Plus className="w-3 h-3 mr-1" /> Dia
      </Button>
    </div>
  );
}
