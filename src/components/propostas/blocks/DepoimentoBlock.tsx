'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

interface Dep { texto: string; autor: string; destino: string }

export function DepoimentoBlock({ conteudo, onChange }: BlockProps) {
  const deps = (conteudo as { depoimentos?: Dep[] }).depoimentos || [];

  return (
    <div className="space-y-2">
      {deps.map((d, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex-1 space-y-1">
            <textarea
              value={d.texto}
              onChange={e => {
                const arr = [...deps]; arr[i] = { ...arr[i], texto: e.target.value };
                onChange({ ...conteudo, depoimentos: arr });
              }}
              rows={2}
              placeholder="Depoimento..."
              className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
            />
            <div className="grid grid-cols-2 gap-1">
              <Input
                value={d.autor}
                onChange={e => {
                  const arr = [...deps]; arr[i] = { ...arr[i], autor: e.target.value };
                  onChange({ ...conteudo, depoimentos: arr });
                }}
                placeholder="Autor"
                className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
              <Input
                value={d.destino}
                onChange={e => {
                  const arr = [...deps]; arr[i] = { ...arr[i], destino: e.target.value };
                  onChange({ ...conteudo, depoimentos: arr });
                }}
                placeholder="Viajou para..."
                className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-red-400 shrink-0 self-start"
            onClick={() => onChange({ ...conteudo, depoimentos: deps.filter((_, j) => j !== i) })}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, depoimentos: [...deps, { texto: '', autor: '', destino: '' }] })}>
        <Plus className="w-3 h-3 mr-1" /> Depoimento
      </Button>
    </div>
  );
}
