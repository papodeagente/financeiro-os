'use client';

import { Input } from '@/components/ui/input';
import type { BlockProps } from './types';

export function VideoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { url?: string; titulo?: string };
  return (
    <div className="space-y-2">
      <Input
        value={c.titulo || ''}
        onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
        placeholder="Titulo do video (opcional)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.url || ''}
        onChange={e => onChange({ ...conteudo, url: e.target.value })}
        placeholder="URL do YouTube ou Vimeo"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      {c.url && (
        <div className="text-[10px] text-[var(--t-text-muted)]">
          Suporta YouTube e Vimeo. Cole a URL completa do video.
        </div>
      )}
    </div>
  );
}
