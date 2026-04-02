'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

interface FAQ { pergunta: string; resposta: string }

export function FAQBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { titulo?: string; perguntas?: FAQ[] };
  const perguntas = c.perguntas || [];

  return (
    <div className="space-y-2">
      <Input
        value={c.titulo || ''}
        onChange={e => onChange({ ...conteudo, titulo: e.target.value })}
        placeholder="Titulo (ex: Perguntas Frequentes)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      {perguntas.map((faq, i) => (
        <div key={i} className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] space-y-2">
          <div className="flex gap-2">
            <Input
              value={faq.pergunta}
              onChange={e => {
                const arr = [...perguntas]; arr[i] = { ...arr[i], pergunta: e.target.value };
                onChange({ ...conteudo, perguntas: arr });
              }}
              placeholder="Pergunta"
              className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] flex-1"
            />
            <Button variant="ghost" size="sm" className="text-red-400 shrink-0"
              onClick={() => onChange({ ...conteudo, perguntas: perguntas.filter((_, j) => j !== i) })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <textarea
            value={faq.resposta}
            onChange={e => {
              const arr = [...perguntas]; arr[i] = { ...arr[i], resposta: e.target.value };
              onChange({ ...conteudo, perguntas: arr });
            }}
            rows={2}
            placeholder="Resposta..."
            className="w-full bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, perguntas: [...perguntas, { pergunta: '', resposta: '' }] })}>
        <Plus className="w-3 h-3 mr-1" /> Pergunta
      </Button>
    </div>
  );
}
