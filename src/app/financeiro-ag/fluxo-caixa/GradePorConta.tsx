'use client';

import * as React from 'react';

import { cn, formatBRL } from '@/lib/utils';
import { rotuloDoDia } from '@/lib/caderno-caixa';
import type { GradeContaDia, LinhaDaGrade } from '@/lib/fluxo-comparativo';

/**
 * Fluxo de caixa por conta e dia (E7, G3): cada conta bancária numa linha,
 * cada dia do período numa coluna, com o saldo no fim do dia ou o movimento
 * do dia. A coluna das contas fica presa ao rolar; hoje ganha destaque e os
 * dias depois dele são previsão. Os números chegam prontos de
 * gradeContaPorDia (src/lib/fluxo-comparativo.ts).
 */

export type MedidaDaGrade = 'saldo' | 'movimento';

const CELULA = 'h-10 whitespace-nowrap px-3 text-right align-middle fin-t-body tabular-nums';
const PRESA = 'sticky left-0 z-10 min-w-[200px] max-w-[260px] whitespace-normal px-4 text-left shadow-[1px_0_0_var(--fin-border)]';

function valorDa(l: Pick<LinhaDaGrade, 'saldos' | 'movimentos'>, medida: MedidaDaGrade, i: number): number {
  return medida === 'saldo' ? l.saldos[i] : l.movimentos[i];
}

function Celula({
  valor, medida, futuro, hoje, onAbrir, rotulo,
}: {
  valor: number;
  medida: MedidaDaGrade;
  futuro: boolean;
  hoje: boolean;
  onAbrir?: () => void;
  rotulo: string;
}) {
  const vazio = medida === 'movimento' && valor === 0;
  const texto = vazio ? '—' : medida === 'movimento' && valor > 0 ? `+${formatBRL(valor)}` : formatBRL(valor);
  const cor = vazio ? 'text-[var(--fin-text-3)]'
    : valor < 0 ? 'text-[var(--fin-negative-text)]'
      : medida === 'movimento' ? 'text-[var(--fin-positive)]'
        : futuro ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text)]';
  return (
    <td className={cn(CELULA, hoje && 'bg-[var(--fin-accent-soft)]', futuro && !hoje && 'bg-[var(--fin-surface-2)]')}>
      {onAbrir ? (
        <button
          type="button"
          onClick={onAbrir}
          aria-label={rotulo}
          className={cn(
            'rounded-[var(--fin-r-sm)] underline decoration-[var(--fin-border-strong)] decoration-dotted underline-offset-4',
            'hover:decoration-[var(--fin-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
            cor,
          )}
        >
          {texto}
        </button>
      ) : <span className={cor}>{texto}</span>}
    </td>
  );
}

export function GradePorConta({
  grade, medida, hoje, onAbrir,
}: {
  grade: GradeContaDia;
  medida: MedidaDaGrade;
  hoje: string;
  /** Clique num dia com lançamentos de uma conta. */
  onAbrir: (linha: LinhaDaGrade, dia: string, indice: number) => void;
}) {
  const refHoje = React.useRef<HTMLTableCellElement>(null);
  const rolagem = React.useRef<HTMLDivElement>(null);
  // Abre com hoje à vista (sem roubar o foco).
  React.useEffect(() => {
    const caixa = rolagem.current;
    const th = refHoje.current;
    if (!caixa || !th) return;
    caixa.scrollLeft = Math.max(0, th.offsetLeft - caixa.clientWidth / 2);
  }, [grade.dias.length]);

  return (
    <div
      ref={rolagem}
      tabIndex={0}
      role="region"
      aria-label="Fluxo de caixa por conta e dia. Rolagem horizontal disponível."
      className="w-full overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
    >
      <table data-fin-table className="w-full border-collapse">
        <caption className="sr-only">
          {medida === 'saldo' ? 'Saldo no fim de cada dia, por conta' : 'Movimento de cada dia, por conta'}
        </caption>
        <thead>
          <tr className="border-b border-b-[var(--fin-border)]">
            <th scope="col" className={cn(PRESA, 'z-20 h-12 bg-[var(--fin-surface)] fin-t-overline text-[var(--fin-text-3)]')}>Conta</th>
            {medida === 'saldo' ? (
              <th scope="col" className="h-12 whitespace-nowrap px-3 text-right fin-t-overline text-[var(--fin-text-3)]">Saldo anterior</th>
            ) : null}
            {grade.dias.map(d => {
              const [semana, resto] = rotuloDoDia(d).split(', ');
              const ehHoje = d === hoje;
              return (
                <th
                  key={d}
                  ref={ehHoje ? refHoje : undefined}
                  scope="col"
                  className={cn(
                    'h-12 min-w-[104px] whitespace-nowrap px-3 text-right align-bottom',
                    ehHoje ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]' : d > hoje ? 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]' : 'text-[var(--fin-text-2)]',
                  )}
                >
                  <span className="flex flex-col items-end leading-tight">
                    <span className="fin-t-caption">{ehHoje ? 'hoje' : semana}</span>
                    <span className="fin-t-body-strong">{resto}</span>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grade.linhas.map(l => (
            <tr key={l.id} className="group border-b border-b-[var(--fin-border)]">
              <th scope="row" className={cn(PRESA, 'bg-[var(--fin-surface)] py-2 fin-t-body', l.tipo === 'conta' ? 'text-[var(--fin-text)]' : 'italic text-[var(--fin-text-2)]')}>
                {l.nome}
              </th>
              {medida === 'saldo' ? (
                <td className={cn(CELULA, l.saldoInicial < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-2)]')}>{formatBRL(l.saldoInicial)}</td>
              ) : null}
              {grade.dias.map((d, i) => (
                <Celula
                  key={d}
                  valor={valorDa(l, medida, i)}
                  medida={medida}
                  futuro={d > hoje}
                  hoje={d === hoje}
                  rotulo={`Ver os lançamentos de ${l.nome} em ${rotuloDoDia(d)}`}
                  onAbrir={l.lancamentosPorDia[d] ? () => onAbrir(l, d, i) : undefined}
                />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-t-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)]">
            <th scope="row" className={cn(PRESA, 'bg-[var(--fin-surface-sunken)] py-2 fin-t-body-strong text-[var(--fin-text)]')}>Total</th>
            {medida === 'saldo' ? (
              <td className={cn(CELULA, 'fin-t-body-strong', grade.total.saldoInicial < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>{formatBRL(grade.total.saldoInicial)}</td>
            ) : null}
            {grade.dias.map((d, i) => {
              const v = valorDa(grade.total, medida, i);
              const vazio = medida === 'movimento' && v === 0;
              return (
                <td key={d} className={cn(CELULA, 'fin-t-body-strong', d === hoje && 'bg-[var(--fin-accent-soft)]', vazio ? 'text-[var(--fin-text-3)]' : v < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                  {vazio ? '—' : medida === 'movimento' && v > 0 ? `+${formatBRL(v)}` : formatBRL(v)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default GradePorConta;
