'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

export function InclusosBlock({ conteudo, onChange }: BlockProps) {
  const inclusos = (conteudo as { inclusos?: string[] }).inclusos || [''];
  const naoInclusos = (conteudo as { nao_inclusos?: string[] }).nao_inclusos || [''];

  const updateList = (field: 'inclusos' | 'nao_inclusos', list: string[], idx: number, value: string) => {
    const arr = [...list];
    arr[idx] = value;
    onChange({ ...conteudo, [field]: arr });
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <span className="text-xs text-emerald-400 font-medium">Incluso</span>
        {inclusos.map((item, i) => (
          <div key={i} className="flex gap-1 mt-1">
            <Input
              value={item}
              onChange={e => updateList('inclusos', inclusos, i, e.target.value)}
              placeholder="Item incluso..."
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
            {inclusos.length > 1 && (
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400 shrink-0"
                onClick={() => onChange({ ...conteudo, inclusos: inclusos.filter((_, j) => j !== i) })}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] mt-1"
          onClick={() => onChange({ ...conteudo, inclusos: [...inclusos, ''] })}>
          <Plus className="w-3 h-3 mr-1" /> Adicionar
        </Button>
      </div>
      <div>
        <span className="text-xs text-red-400 font-medium">Nao incluso</span>
        {naoInclusos.map((item, i) => (
          <div key={i} className="flex gap-1 mt-1">
            <Input
              value={item}
              onChange={e => updateList('nao_inclusos', naoInclusos, i, e.target.value)}
              placeholder="Item nao incluso..."
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
            {naoInclusos.length > 1 && (
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400 shrink-0"
                onClick={() => onChange({ ...conteudo, nao_inclusos: naoInclusos.filter((_, j) => j !== i) })}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] mt-1"
          onClick={() => onChange({ ...conteudo, nao_inclusos: [...naoInclusos, ''] })}>
          <Plus className="w-3 h-3 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
