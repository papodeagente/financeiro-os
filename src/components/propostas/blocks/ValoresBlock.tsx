'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { BlockProps } from './types';

interface Parcela { forma: string; valor_parcela: number; valor_total: number; destaque: boolean }
interface Opcao { titulo: string; valor_total: number; destaque: boolean; parcelas: Parcela[] }

export function ValoresBlock({ conteudo, onChange }: BlockProps) {
  const cont = conteudo as { opcoes?: Opcao[]; observacoes_valores?: string };
  const opcoes = cont.opcoes || [];

  const updateOpcao = (i: number, patch: Partial<Opcao>) => {
    const arr = [...opcoes];
    arr[i] = { ...arr[i], ...patch };
    onChange({ ...conteudo, opcoes: arr });
  };

  return (
    <div className="space-y-3">
      {opcoes.map((opc, i) => (
        <div key={i} className="p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={opc.titulo}
              onChange={e => updateOpcao(i, { titulo: e.target.value })}
              placeholder="Ex: SGL, DBL..."
              className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
            />
            <Input
              type="number"
              value={opc.valor_total || ''}
              onChange={e => updateOpcao(i, { valor_total: Number(e.target.value) })}
              placeholder="Valor total"
              className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
            />
            <Button variant="ghost" size="sm" className="text-red-400"
              onClick={() => onChange({ ...conteudo, opcoes: opcoes.filter((_, j) => j !== i) })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          {opc.parcelas?.map((parc, pi) => (
            <div key={pi} className="grid grid-cols-3 gap-2 ml-4">
              <Input
                value={parc.forma}
                onChange={e => {
                  const parcs = [...opc.parcelas]; parcs[pi] = { ...parcs[pi], forma: e.target.value };
                  updateOpcao(i, { parcelas: parcs });
                }}
                placeholder="Forma (10x Cartao, PIX...)"
                className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
              <Input
                type="number"
                value={parc.valor_parcela || ''}
                onChange={e => {
                  const parcs = [...opc.parcelas]; parcs[pi] = { ...parcs[pi], valor_parcela: Number(e.target.value) };
                  updateOpcao(i, { parcelas: parcs });
                }}
                placeholder="Valor parcela"
                className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
              />
              <Button variant="ghost" size="sm" className="text-red-400 h-9"
                onClick={() => updateOpcao(i, { parcelas: opc.parcelas.filter((_, j) => j !== pi) })}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] ml-4"
            onClick={() => updateOpcao(i, { parcelas: [...(opc.parcelas || []), { forma: '', valor_parcela: 0, valor_total: 0, destaque: false }] })}>
            <Plus className="w-3 h-3 mr-1" /> Forma de pagamento
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
        onClick={() => onChange({ ...conteudo, opcoes: [...opcoes, { titulo: '', valor_total: 0, destaque: false, parcelas: [] }] })}>
        <Plus className="w-3 h-3 mr-1" /> Opcao de valor
      </Button>
      <Input
        value={cont.observacoes_valores || ''}
        onChange={e => onChange({ ...conteudo, observacoes_valores: e.target.value })}
        placeholder="Observacoes (Ex: Criancas ate 2 anos gratis)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
    </div>
  );
}
