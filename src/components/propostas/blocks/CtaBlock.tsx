'use client';

import { Input } from '@/components/ui/input';
import type { BlockProps } from './types';

export function CtaBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { texto_botao?: string; numero_whatsapp?: string; mensagem_predefinida?: string };
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
    </div>
  );
}
