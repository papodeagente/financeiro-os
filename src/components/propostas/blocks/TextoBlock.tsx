'use client';

import { Input } from '@/components/ui/input';
import type { BlockProps } from './types';

export function TextoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { titulo?: string; corpo?: string };
  return (
    <div className="space-y-2">
      <Input
        value={c.titulo || ''}
        onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
        placeholder="Titulo do bloco"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <textarea
        value={c.corpo || ''}
        onChange={e => onChange({ ...conteudo, corpo: e.target.value })}
        rows={3}
        placeholder="Texto..."
        className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
      />
    </div>
  );
}
