'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

interface Img { url: string; legenda: string }

export function GaleriaBlock({ conteudo, onChange }: BlockProps) {
  const imgs = (conteudo as { imagens?: Img[] }).imagens || [];

  return (
    <div className="space-y-2">
      {imgs.map((img, i) => (
        <div key={i} className="grid grid-cols-5 gap-2">
          <Input
            value={img.url}
            onChange={e => {
              const arr = [...imgs]; arr[i] = { ...arr[i], url: e.target.value };
              onChange({ ...conteudo, imagens: arr });
            }}
            placeholder="URL da imagem"
            className="col-span-3 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
          />
          <Input
            value={img.legenda}
            onChange={e => {
              const arr = [...imgs]; arr[i] = { ...arr[i], legenda: e.target.value };
              onChange({ ...conteudo, imagens: arr });
            }}
            placeholder="Legenda"
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
          />
          <Button variant="ghost" size="sm" className="text-red-400"
            onClick={() => onChange({ ...conteudo, imagens: imgs.filter((_, j) => j !== i) })}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, imagens: [...imgs, { url: '', legenda: '' }] })}>
        <Plus className="w-3 h-3 mr-1" /> Imagem
      </Button>
    </div>
  );
}
