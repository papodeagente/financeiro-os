'use client';

import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/propostas/RichTextEditor';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

// Convert plain text to basic HTML paragraphs (backward compat)
function ensureHTML(text: string): string {
  if (!text) return '';
  if (text.includes('<')) return text; // already HTML
  return text.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');
}

export function TextoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { titulo?: string; corpo?: string; imagem_url?: string };
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
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1 block">Imagem destaque (opcional)</label>
        <ImageUpload
          compact
          currentUrl={c.imagem_url}
          onUpload={urls => onChange({ ...conteudo, imagem_url: urls[0] })}
          onRemove={() => onChange({ ...conteudo, imagem_url: '' })}
        />
      </div>
    </div>
  );
}
