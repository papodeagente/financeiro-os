'use client';

import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { addDias, addMeses, dataSegura, hojeISO } from '@/lib/money';

export type PeriodoChave =
  | 'MES_ATUAL' | 'PROX_30' | 'PROX_90' | 'VENCIDOS'
  | 'MES_PASSADO' | 'TUDO' | 'PERSONALIZADO';

/** Apelido usado pela FilterBar. Mesmo tipo, nome alternativo da spec. */
export type PeriodoValor = PeriodoChave;

/**
 * ATENÇÃO: somenteVencidos NÃO é data. É o que faz o filtro "Vencidos"
 * funcionar (pagar/page.tsx:445,454,467). Normalizar este tipo para
 * { de, ate } silencia o filtro sem erro de compilação.
 */
export type PeriodoRange = { de: string; ate: string; somenteVencidos?: boolean };

export type PeriodPickerProps = {
  valor: PeriodoChave;
  de?: string;
  ate?: string;
  onChange: (chave: PeriodoChave, range: PeriodoRange) => void;
  opcoes?: PeriodoChave[];
};

export const ROTULO_PERIODO: Record<PeriodoChave, string> = {
  MES_ATUAL: 'Este mês',
  PROX_30: 'Próximos 30 dias',
  PROX_90: 'Próximos 90 dias',
  VENCIDOS: 'Vencidos',
  MES_PASSADO: 'Mês passado',
  TUDO: 'Todo o período',
  PERSONALIZADO: 'Período personalizado',
};

export const OPCOES_PERIODO_PADRAO: PeriodoChave[] = [
  'MES_ATUAL', 'PROX_30', 'PROX_90', 'VENCIDOS', 'MES_PASSADO', 'TUDO', 'PERSONALIZADO',
];

/**
 * Resolve a chave num intervalo de datas civis. Mesma aritmética que já
 * roda hoje em Contas a pagar, com os helpers de data de lib/money.
 * Nunca usa new Date sobre string de data.
 */
export function resolverPeriodo(
  chave: PeriodoChave,
  de?: string,
  ate?: string,
): PeriodoRange {
  const hoje = hojeISO();
  const [ano, mes] = hoje.split('-').map(Number);

  if (chave === 'MES_ATUAL') {
    return { de: dataSegura(ano, mes, 1), ate: dataSegura(ano, mes, 31) };
  }
  if (chave === 'PROX_30') {
    return { de: hoje, ate: addDias(hoje, 30) };
  }
  if (chave === 'PROX_90') {
    return { de: hoje, ate: addDias(hoje, 90) };
  }
  if (chave === 'VENCIDOS') {
    // Vencido é DATA (vencimento < hoje) em conta aberta, não o status literal.
    return { de: '', ate: '', somenteVencidos: true };
  }
  if (chave === 'MES_PASSADO') {
    const ini = addMeses(dataSegura(ano, mes, 1), -1);
    const [anoP, mesP] = ini.split('-').map(Number);
    return { de: ini, ate: dataSegura(anoP, mesP, 31) };
  }
  if (chave === 'PERSONALIZADO') {
    return { de: de ?? '', ate: ate ?? '' };
  }
  return { de: '', ate: '' };
}

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

const CONTROLE = cn(
  'fin-t-body h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10',
  FOCO,
);

/**
 * Um controle de período para as 10 telas. O contrato de retorno é
 * preservado literalmente, inclusive somenteVencidos.
 */
export function PeriodPicker({ valor, de, ate, onChange, opcoes }: PeriodPickerProps) {
  const idBase = React.useId();
  const lista = opcoes && opcoes.length > 0 ? opcoes : OPCOES_PERIODO_PADRAO;
  const mostraDatas = valor === 'PERSONALIZADO' && lista.includes('PERSONALIZADO');

  function trocarChave(chave: PeriodoChave) {
    onChange(chave, resolverPeriodo(chave, de, ate));
  }

  function trocarDe(novoDe: string) {
    onChange('PERSONALIZADO', { de: novoDe, ate: ate ?? '' });
  }

  function trocarAte(novoAte: string) {
    onChange('PERSONALIZADO', { de: de ?? '', ate: novoAte });
  }

  return (
    <div
      data-slot="fin-period-picker"
      className="flex flex-wrap items-center gap-[var(--fin-s-2)]"
    >
      <Select
        value={valor}
        onValueChange={(v) => trocarChave(v as PeriodoChave)}
      >
        <SelectTrigger
          id={`${idBase}-periodo`}
          aria-label="Período"
          className={cn(CONTROLE, 'min-w-48 gap-[var(--fin-s-2)] px-3')}
        >
          <span className="fin-t-overline text-[var(--fin-text-3)]">Período</span>
          <SelectValue>
            {(v) => ROTULO_PERIODO[(v as PeriodoChave) ?? 'TUDO'] ?? ROTULO_PERIODO.TUDO}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {lista.map((chave) => (
            <SelectItem key={chave} value={chave} className="fin-t-body">
              {ROTULO_PERIODO[chave]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {mostraDatas ? (
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <div className="flex items-center gap-[var(--fin-s-1)]">
            <label
              className="fin-t-caption text-[var(--fin-text-3)]"
              htmlFor={`${idBase}-de`}
            >
              De
            </label>
            <Input
              id={`${idBase}-de`}
              type="date"
              value={de ?? ''}
              onChange={(e) => trocarDe(e.target.value)}
              className={cn(CONTROLE, 'w-40 px-3')}
            />
          </div>
          <div className="flex items-center gap-[var(--fin-s-1)]">
            <label
              className="fin-t-caption text-[var(--fin-text-3)]"
              htmlFor={`${idBase}-ate`}
            >
              Até
            </label>
            <Input
              id={`${idBase}-ate`}
              type="date"
              value={ate ?? ''}
              onChange={(e) => trocarAte(e.target.value)}
              className={cn(CONTROLE, 'w-40 px-3')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PeriodPicker;
