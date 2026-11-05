'use client';

import type { ComparativoDoPeriodo, LinhaComparativa, Tripla } from '@/lib/fluxo-comparativo';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Previsto × Realizado × Desvio, lado a lado (05/11/2026).
 *
 * Previsto é o combinado pelo vencimento; Realizado, o que se moveu na data
 * da baixa; Desvio, a diferença. Linha inteira no futuro ainda não tem
 * realizado: mostra traço em vez de um zero que pareceria fato.
 */

type Lado = 'entradas' | 'saidas' | 'saldo';

const GRUPOS: ReadonlyArray<{ lado: Lado; rotulo: string }> = [
  { lado: 'entradas', rotulo: 'Entradas' },
  { lado: 'saidas', rotulo: 'Saídas' },
  { lado: 'saldo', rotulo: 'Saldo' },
];

const CELULA = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

function Traco() {
  return <span className="text-[var(--fin-text-3)]">—</span>;
}

function Valor({ valor, negativoQuando = false }: { valor: number; negativoQuando?: boolean }) {
  if (valor === 0) return <Traco />;
  return (
    <span className={cn(negativoQuando && valor < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
      {valor < 0 ? '−' : ''}{formatBRL(Math.abs(valor))}
    </span>
  );
}

/**
 * Desvio com sinal e tom pelo que ele significa: entrar a mais e sair a
 * menos é bom; o contrário é atenção.
 */
function Desvio({ valor, lado }: { valor: number; lado: Lado }) {
  if (valor === 0) return <Traco />;
  const bom = lado === 'saidas' ? valor < 0 : valor > 0;
  return (
    <span className={cn('font-medium', bom ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative-text)]')}>
      {valor > 0 ? '+' : '−'}{formatBRL(Math.abs(valor))}
    </span>
  );
}

function Celulas({ t, lado, futura }: { t: Tripla; lado: Lado; futura: boolean }) {
  return (
    <>
      <td className={cn(CELULA, 'border-l border-[var(--fin-border)]')}>
        <Valor valor={t.previsto} negativoQuando={lado === 'saldo'} />
      </td>
      <td className={CELULA}>{futura ? <Traco /> : <Valor valor={t.realizado} negativoQuando={lado === 'saldo'} />}</td>
      <td className={CELULA}>{futura ? <Traco /> : <Desvio valor={t.desvio} lado={lado} />}</td>
    </>
  );
}

function Linha({ l }: { l: LinhaComparativa }) {
  return (
    <tr
      className={cn(
        'border-b border-[var(--fin-border)] last:border-b-0',
        l.contemHoje ? 'bg-[var(--fin-accent-soft)]' : 'bg-[var(--fin-surface)]',
      )}
    >
      <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-inherit px-3 py-2 text-left font-normal">
        <span className="flex items-center gap-[var(--fin-s-2)]">
          <span className="text-[var(--fin-text)]">{l.rotulo}</span>
          {l.contemHoje ? (
            <span className="rounded-[var(--fin-r-sm)] bg-[var(--fin-surface)] px-1.5 py-px fin-t-caption font-medium text-[var(--fin-accent)]">
              hoje
            </span>
          ) : null}
        </span>
      </th>
      {GRUPOS.map(g => <Celulas key={g.lado} t={l[g.lado]} lado={g.lado} futura={l.futura} />)}
    </tr>
  );
}

export type PrevistoRealizadoProps = {
  comparativo: ComparativoDoPeriodo;
  rotuloPeriodo: string;
};

export function PrevistoRealizado({ comparativo, rotuloPeriodo }: PrevistoRealizadoProps) {
  const { linhas, totais } = comparativo;
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`Previsto × Realizado de ${rotuloPeriodo}, rolagem horizontal disponível`}
      className="w-full overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
    >
      <table className="w-full min-w-[56rem] border-collapse fin-t-body">
        <caption className="sr-only">
          Previsto pelo vencimento, realizado pela data da baixa e desvio, em entradas, saídas e saldo, de {rotuloPeriodo}.
        </caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="sticky left-0 z-[1] bg-[var(--fin-surface)] px-3 pb-1 text-left align-bottom fin-t-overline text-[var(--fin-text-3)]">
              Período
            </th>
            {GRUPOS.map(g => (
              <th
                key={g.lado}
                scope="colgroup"
                colSpan={3}
                className="border-l border-[var(--fin-border)] px-3 pb-1 text-center fin-t-overline text-[var(--fin-text-2)]"
              >
                {g.rotulo}
              </th>
            ))}
          </tr>
          <tr className="border-b border-[var(--fin-border)]">
            {GRUPOS.map(g => (
              ['Previsto', 'Realizado', 'Desvio'].map((c, i) => (
                <th
                  key={`${g.lado}-${c}`}
                  scope="col"
                  className={cn('px-3 pb-2 text-right fin-t-caption font-medium text-[var(--fin-text-3)]', i === 0 && 'border-l border-[var(--fin-border)]')}
                >
                  {c}
                </th>
              ))
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => <Linha key={l.chave} l={l} />)}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)] fin-t-body-strong">
            <th scope="row" className="sticky left-0 z-[1] bg-[var(--fin-surface-sunken)] px-3 py-2.5 text-left">Total</th>
            {GRUPOS.map(g => <Celulas key={g.lado} t={totais[g.lado]} lado={g.lado} futura={false} />)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default PrevistoRealizado;
