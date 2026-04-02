'use client';

import { Input } from '@/components/ui/input';
import type { BlockProps } from './types';

export function CountdownBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { titulo?: string; data_evento?: string; mensagem?: string };
  return (
    <div className="space-y-2">
      <Input
        value={c.titulo || ''}
        onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
        placeholder="Titulo (ex: Sua viagem comeca em...)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        type="date"
        value={c.data_evento || ''}
        onChange={e => onChange({ ...conteudo, data_evento: e.target.value })}
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.mensagem || ''}
        onChange={e => onChange({ ...conteudo, mensagem: e.target.value })}
        placeholder="Mensagem apos a data (ex: Boa viagem!)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
    </div>
  );
}
