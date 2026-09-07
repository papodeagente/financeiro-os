'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn, formatBRL } from '@/lib/utils';
import {
  PeriodPicker,
  type PeriodoChave,
  type PeriodoValor,
  type PeriodPickerProps,
} from './PeriodPicker';

export type FilterBarProps = {
  busca?: { valor: string; onChange: (v: string) => void; placeholder: string };
  periodo?: {
    valor: PeriodoValor;
    de?: string;
    ate?: string;
    onChange: PeriodPickerProps['onChange'];
    opcoes?: PeriodoChave[];
  };
  selects?: {
    id: string;
    rotulo: string;
    valor: string;
    opcoes: { valor: string; rotulo: string }[];
    onChange: (v: string) => void;
  }[];
  /**
   * Diz de quanto o filtro cortou. "12 de 340 despesas, R$ 41.320".
   * `soma` vem calculado de fora, sobre o recorte, nunca da página visível.
   */
  resumo: { exibidos: number; total: number; substantivo: string; soma?: number; escopo?: string };
  ativos: number;
  onLimpar?: () => void;
};

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

const CONTROLE = cn(
  'fin-t-body h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10',
  FOCO,
);

function formatarContagem(n: number): string {
  return n.toLocaleString('pt-BR');
}

/**
 * Uma linha de filtros por tela, com a contagem que diz de quanto o filtro
 * cortou. Substitui pílulas soltas e selects no cabeçalho.
 */
export function FilterBar({ busca, periodo, selects, resumo, ativos, onLimpar }: FilterBarProps) {
  const idBusca = React.useId();

  return (
    <section
      data-slot="fin-filter-bar"
      aria-label="Filtros"
      className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)] lg:min-h-12 lg:flex-row lg:flex-wrap lg:items-center lg:gap-[var(--fin-s-2)]"
    >
      {busca ? (
        <div className="relative flex min-w-0 grow items-center lg:max-w-80">
          <label className="sr-only" htmlFor={idBusca}>
            {busca.placeholder}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-4 text-[var(--fin-text-3)]"
          />
          <Input
            id={idBusca}
            type="search"
            value={busca.valor}
            placeholder={busca.placeholder}
            onChange={(e) => busca.onChange(e.target.value)}
            className={cn(CONTROLE, 'pl-9 pr-3')}
          />
        </div>
      ) : null}

      {periodo ? (
        <PeriodPicker
          valor={periodo.valor}
          de={periodo.de}
          ate={periodo.ate}
          onChange={periodo.onChange}
          opcoes={periodo.opcoes}
        />
      ) : null}

      {(selects ?? []).map((s) => {
        const rotuloAtual =
          s.opcoes.find((o) => o.valor === s.valor)?.rotulo ?? s.opcoes[0]?.rotulo ?? '';
        return (
          <Select key={s.id} value={s.valor} onValueChange={(v) => s.onChange(v as string)}>
            <SelectTrigger
              id={s.id}
              aria-label={s.rotulo}
              className={cn(CONTROLE, 'min-w-44 gap-[var(--fin-s-2)] px-3')}
            >
              <span className="fin-t-overline shrink-0 text-[var(--fin-text-3)]">{s.rotulo}</span>
              <SelectValue>{() => rotuloAtual}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {s.opcoes.map((o) => (
                <SelectItem key={o.valor} value={o.valor} className="fin-t-body">
                  {o.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}

      <div className="flex min-w-0 grow flex-wrap items-center justify-start gap-[var(--fin-s-2)] lg:justify-end">
        <p aria-live="polite" className="fin-t-caption text-[var(--fin-text-3)]">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">
            {formatarContagem(resumo.exibidos)}
          </span>{' '}
          de{' '}
          <span className="tabular-nums">{formatarContagem(resumo.total)}</span>{' '}
          {resumo.substantivo}
          {resumo.soma !== undefined ? (
            <>
              {', '}
              <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">
                {formatBRL(resumo.soma)}
              </span>
            </>
          ) : null}
          {resumo.escopo ? <> {resumo.escopo}</> : null}
        </p>

        {ativos > 0 && onLimpar ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onLimpar}
            className={cn(
              'fin-t-body h-11 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 text-[var(--fin-accent)] shadow-none hover:bg-[var(--fin-accent-soft)] hover:text-[var(--fin-accent)] lg:h-10',
              FOCO,
            )}
          >
            <X aria-hidden="true" className="size-4" />
            Limpar filtros ({ativos})
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export default FilterBar;
