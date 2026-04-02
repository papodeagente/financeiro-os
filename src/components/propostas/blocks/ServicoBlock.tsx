'use client';

import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

export function ServicoBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { icone?: string; titulo?: string; descricao?: string; valor?: number; imagem?: string };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-2">
        <Input
          value={c.icone || ''}
          onChange={e => onChange({ ...conteudo, icone: e.target.value })}
          placeholder="Icone"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-1"
        />
        <Input
          value={c.titulo || ''}
          onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
          placeholder="Ex: Voo Sao Paulo → Lisboa"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-5"
        />
      </div>
      <textarea
        value={c.descricao || ''}
        onChange={e => onChange({ ...conteudo, descricao: e.target.value })}
        rows={2}
        placeholder="Descricao do servico..."
        className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
      />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={c.valor || ''}
          onChange={e => onChange({ ...conteudo, valor: Number(e.target.value) })}
          placeholder="Valor (R$)"
          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
        />
        <ImageUpload
          compact
          currentUrl={c.imagem}
          onUpload={urls => onChange({ ...conteudo, imagem: urls[0] })}
          onRemove={() => onChange({ ...conteudo, imagem: '' })}
        />
      </div>
    </div>
  );
}
