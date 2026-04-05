'use client';

import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

export function CtaBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { texto_botao?: string; numero_whatsapp?: string; mensagem_predefinida?: string; imagem_fundo?: string };
  return (
    <div className="space-y-2">
      <Input
        value={c.texto_botao || ''}
        onChange={e => onChange({ ...conteudo, texto_botao: e.target.value })}
        placeholder="Texto do botao"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.numero_whatsapp || ''}
        onChange={e => onChange({ ...conteudo, numero_whatsapp: e.target.value })}
        placeholder="Numero WhatsApp"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.mensagem_predefinida || ''}
        onChange={e => onChange({ ...conteudo, mensagem_predefinida: e.target.value })}
        placeholder="Mensagem predefinida"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1 block">Imagem de fundo (opcional)</label>
        <ImageUpload
          compact
          currentUrl={c.imagem_fundo}
          onUpload={urls => onChange({ ...conteudo, imagem_fundo: urls[0] })}
          onRemove={() => onChange({ ...conteudo, imagem_fundo: '' })}
        />
      </div>
    </div>
  );
}
