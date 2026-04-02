'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

interface Img { url: string; legenda: string }

export function GaleriaBlock({ conteudo, onChange }: BlockProps) {
  const imgs = (conteudo as { imagens?: Img[] }).imagens || [];

  const handleUpload = (urls: string[]) => {
    const novas = urls.map(url => ({ url, legenda: '' }));
    onChange({ ...conteudo, imagens: [...imgs, ...novas] });
  };

  return (
    <div className="space-y-3">
      {/* Existing images */}
      {imgs.length > 0 && (
        <div className="space-y-2">
          {imgs.map((img, i) => (
            <div key={i} className="flex items-center gap-2">
              {img.url && (
                <div className="w-16 h-12 rounded overflow-hidden border border-[var(--t-border)] shrink-0">
                  <img src={img.url} alt={img.legenda} className="w-full h-full object-cover" />
                </div>
              )}
              <Input
                value={img.url}
                onChange={e => {
                  const arr = [...imgs]; arr[i] = { ...arr[i], url: e.target.value };
                  onChange({ ...conteudo, imagens: arr });
                }}
                placeholder="URL da imagem"
                className="flex-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
              <Input
                value={img.legenda}
                onChange={e => {
                  const arr = [...imgs]; arr[i] = { ...arr[i], legenda: e.target.value };
                  onChange({ ...conteudo, imagens: arr });
                }}
                placeholder="Legenda"
                className="w-32 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
              <Button variant="ghost" size="sm" className="text-red-400 shrink-0 h-8 w-8 p-0"
                onClick={() => onChange({ ...conteudo, imagens: imgs.filter((_, j) => j !== i) })}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      <ImageUpload onUpload={handleUpload} multiple />

      {/* Manual add */}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-text-muted)]"
        onClick={() => onChange({ ...conteudo, imagens: [...imgs, { url: '', legenda: '' }] })}>
        <Plus className="w-3 h-3 mr-1" /> Adicionar por URL
      </Button>
    </div>
  );
}
