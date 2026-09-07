'use client';

import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

/** Altura de alvo: 44px abaixo de 1024px, 40px no desktop. */
export const CONTROLE = cn(
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)]',
  'px-3 text-[var(--fin-text)] lg:h-10',
  FOCO,
);

export type OpcaoDeSelecao = { valor: string; rotulo: string };

export type CampoSelecaoProps = {
  rotulo: string;
  valor: string;
  opcoes: OpcaoDeSelecao[];
  onChange: (valor: string) => void;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
};

/**
 * Select do design system dentro do Field, que gera o par rótulo/campo.
 * Substitui os campos de seleção nativos da tela.
 */
export function CampoSelecao({
  rotulo,
  valor,
  opcoes,
  onChange,
  obrigatorio,
  ajuda,
  erro,
}: CampoSelecaoProps) {
  return (
    <Field rotulo={rotulo} obrigatorio={obrigatorio} ajuda={ajuda} erro={erro}>
      {(a) => (
        <Select value={valor} onValueChange={(v) => onChange(String(v))}>
          <SelectTrigger
            id={a.id}
            aria-label={rotulo}
            aria-invalid={a['aria-invalid'] || undefined}
            aria-describedby={a['aria-describedby']}
            className={cn(CONTROLE, 'justify-between gap-2')}
          >
            <SelectValue>
              {() => opcoes.find((o) => o.valor === valor)?.rotulo ?? opcoes[0]?.rotulo ?? ''}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((o) => (
              <SelectItem key={o.valor} value={o.valor} className="fin-t-body">
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export type InterruptorProps = {
  rotulo: string;
  descricao?: string;
  ligado: boolean;
  onChange: (ligado: boolean) => void;
};

/** Chave liga e desliga com semântica de switch e alvo de toque de 44px. */
export function Interruptor({ rotulo, descricao, ligado, onChange }: InterruptorProps) {
  const base = React.useId();
  const idRotulo = `${base}-rotulo`;
  const idDescricao = `${base}-descricao`;

  return (
    <div className="flex items-start gap-3">
      <Button
        type="button"
        variant="ghost"
        role="switch"
        aria-checked={ligado}
        aria-labelledby={idRotulo}
        aria-describedby={descricao ? idDescricao : undefined}
        onClick={() => onChange(!ligado)}
        className={cn('size-11 rounded-[var(--fin-r-md)] shadow-none lg:size-10', FOCO)}
      >
        <span
          aria-hidden="true"
          className={cn(
            'relative block h-5 w-9 rounded-[var(--fin-r-dot)] transition-colors',
            ligado ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-text-3)]',
          )}
        >
          <span
            className={cn(
              'absolute top-[2px] left-[2px] block size-4 rounded-[var(--fin-r-dot)] bg-[var(--fin-surface)] transition-transform motion-reduce:transition-none',
              ligado && 'translate-x-4',
            )}
          />
        </span>
      </Button>
      <div className="flex min-w-0 flex-col gap-1">
        <span id={idRotulo} className="fin-t-body-strong text-[var(--fin-text)]">
          {rotulo}
        </span>
        {descricao ? (
          <span id={idDescricao} className="fin-t-caption text-[var(--fin-text-3)]">
            {descricao}
          </span>
        ) : null}
      </div>
    </div>
  );
}
