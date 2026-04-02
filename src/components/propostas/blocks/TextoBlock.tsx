'use client';

import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/propostas/RichTextEditor';
import type { BlockProps } from './types';

// Convert plain text to basic HTML paragraphs (backward compat)
function ensureHTML(text: string): string {
  if (!text) return '';
  if (text.includes('<')) return text; // already HTML
  return text.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');
}

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
      <RichTextEditor
        content={ensureHTML(c.corpo || '')}
        onChange={html => onChange({ ...conteudo, corpo: html })}
        placeholder="Escreva o conteudo aqui..."
      />
    </div>
  );
}
