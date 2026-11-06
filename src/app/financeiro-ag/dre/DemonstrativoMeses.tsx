'use client';

import * as React from 'react';

import { Money } from '@/components/fin/Money';
import { cn } from '@/lib/utils';
import type { LinhaMesAMes } from '@/lib/resultado-dre';

/**
 * DRE mês a mês (E7, G3): cada mês do período numa coluna, depois Total e
 * Média. A primeira coluna (o nome da linha) fica presa ao rolar para o lado;
 * as margens vão no rodapé, em percentual. Não soma nada: as linhas chegam
 * prontas de dreMesAMes (src/lib/resultado-dre.ts).
 */

const RECUO: Record<number, string> = { 0: 'pl-4', 1: 'pl-8', 2: 'pl-12' };
const CELULA = 'px-3 py-2 align-middle whitespace-nowrap';
const PESO: Record<LinhaMesAMes['tipo'], string> = {
  header: 'fin-t-body-strong text-[var(--fin-text)]',
  item: 'fin-t-body text-[var(--fin-text-2)]',
  subtotal: 'fin-t-body-strong text-[var(--fin-text)]',
  total: 'fin-t-body-strong text-[var(--fin-text)]',
};
const LINHA: Record<LinhaMesAMes['tipo'], string> = {
  header: 'border-b border-b-[var(--fin-border)]',
  item: 'border-b border-b-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
  subtotal: 'border-b border-b-[var(--fin-border)] border-t border-t-[var(--fin-border-strong)]',
  total: 'border-t-2 border-t-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)]',
};
/** Fundo da coluna presa: o mesmo da linha, para o texto que passa por baixo não aparecer. */
const FUNDO_PRESO: Record<LinhaMesAMes['tipo'], string> = {
  header: 'bg-[var(--fin-surface)]',
  item: 'bg-[var(--fin-surface)] group-hover:bg-[var(--fin-surface-2)]',
  subtotal: 'bg-[var(--fin-surface)]',
  total: 'bg-[var(--fin-surface-sunken)]',
};
const CABECALHO = 'sticky top-0 z-10 h-9 whitespace-nowrap bg-[var(--fin-surface)] px-3 py-2 fin-t-overline border-b border-b-[var(--fin-border)] text-[var(--fin-text-3)]';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function rotuloCurtoDoMes(ym: string): string {
  const [a, m] = ym.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function tomDe(tipo: LinhaMesAMes['tipo'], valor: number): 'neutro' | 'negativo' {
  return (tipo === 'total' || tipo === 'subtotal') && valor < 0 ? 'negativo' : 'neutro';
}

export function DemonstrativoMeses({
  meses, linhas, rotulo, descricao, onAbrirMes,
}: {
  meses: string[];
  linhas: LinhaMesAMes[];
  /** Rótulo visível de cada linha (o nome técnico é a chave). */
  rotulo: (l: LinhaMesAMes) => React.ReactNode;
  descricao: string;
  /** Clique no cabeçalho de um mês: abre aquele mês na visão de um mês só. */
  onAbrirMes?: (ym: string) => void;
}) {
  const corpo = linhas.filter(l => !l.percentual);
  const margens = linhas.filter(l => l.percentual);
  return (
    <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
      <div
        tabIndex={0}
        role="region"
        aria-label={`${descricao}. Rolagem horizontal disponível.`}
        className="w-full overflow-x-auto rounded-[var(--fin-r-lg)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
      >
        <table data-fin-table className="w-full border-collapse">
          <caption className="sr-only">{descricao}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(CABECALHO, 'left-0 z-20 min-w-[240px] pl-4 text-left shadow-[1px_0_0_var(--fin-border)]')}>Conta</th>
              {meses.map(m => (
                <th key={m} scope="col" className={cn(CABECALHO, 'min-w-[112px] text-right')}>
                  {onAbrirMes ? (
                    <button
                      type="button"
                      onClick={() => onAbrirMes(m)}
                      className="rounded-[var(--fin-r-sm)] underline decoration-[var(--fin-border-strong)] decoration-dotted underline-offset-4 hover:text-[var(--fin-accent)] hover:decoration-[var(--fin-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                      aria-label={`Abrir ${rotuloCurtoDoMes(m)} sozinho`}
                    >
                      {rotuloCurtoDoMes(m)}
                    </button>
                  ) : rotuloCurtoDoMes(m)}
                </th>
              ))}
              <th scope="col" className={cn(CABECALHO, 'min-w-[128px] border-l border-l-[var(--fin-border)] text-right')}>Total</th>
              <th scope="col" className={cn(CABECALHO, 'min-w-[112px] pr-4 text-right')}>Média</th>
            </tr>
          </thead>
          <tbody>
            {corpo.map(l => (
              <tr key={l.chave} className={cn('group', LINHA[l.tipo])}>
                <th
                  scope="row"
                  className={cn(CELULA, 'sticky left-0 z-10 max-w-[320px] whitespace-normal text-left shadow-[1px_0_0_var(--fin-border)]', PESO[l.tipo], FUNDO_PRESO[l.tipo], RECUO[l.indent] ?? RECUO[2])}
                >
                  <span className="flex items-baseline gap-[var(--fin-s-2)]">
                    {l.codigo ? <span className="fin-t-code text-[var(--fin-text-3)]">{l.codigo}</span> : null}
                    <span className="min-w-0">{rotulo(l)}</span>
                  </span>
                </th>
                {l.valores.map((v, i) => (
                  <td key={meses[i]} className={cn(CELULA, 'text-right')}>
                    <Money valor={v} estado="ok" size={l.tipo === 'item' ? 'body' : 'strong'} tone={tomDe(l.tipo, v)} />
                  </td>
                ))}
                <td className={cn(CELULA, 'border-l border-l-[var(--fin-border)] text-right')}>
                  <Money valor={l.total} estado="ok" size="strong" tone={tomDe(l.tipo, l.total)} />
                </td>
                <td className={cn(CELULA, 'pr-4 text-right')}>
                  <Money valor={l.media} estado="ok" size="body" tone="suave" />
                </td>
              </tr>
            ))}
          </tbody>
          {margens.length ? (
            <tfoot>
              {margens.map(l => (
                <tr key={l.chave} className="group border-t border-t-[var(--fin-border)]">
                  <th scope="row" className={cn(CELULA, 'sticky left-0 z-10 whitespace-normal bg-[var(--fin-surface)] pl-4 text-left fin-t-caption font-normal text-[var(--fin-text-3)] shadow-[1px_0_0_var(--fin-border)]')}>
                    {rotulo(l)}
                  </th>
                  {l.valores.map((v, i) => (
                    <td key={meses[i]} className={cn(CELULA, 'text-right fin-t-body tabular-nums text-[var(--fin-text-2)]')}>{pct(v)}</td>
                  ))}
                  <td className={cn(CELULA, 'border-l border-l-[var(--fin-border)] text-right fin-t-body-strong tabular-nums text-[var(--fin-text)]')}>{pct(l.total)}</td>
                  <td className={cn(CELULA, 'pr-4 text-right fin-t-body tabular-nums text-[var(--fin-text-2)]')}>{pct(l.media)}</td>
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export default DemonstrativoMeses;
