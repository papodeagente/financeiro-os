'use client';

import { ChevronRight } from 'lucide-react';

import { Money } from '@/components/fin/Money';
import type { Caderno as CadernoDeCaixa, LinhaDoCaderno } from '@/lib/caderno-caixa';
import { cn, formatBRL } from '@/lib/utils';

export type CadernoProps = {
  caderno: CadernoDeCaixa;
  onAbrir: (linha: LinhaDoCaderno) => void;
};

function quantos(n: number): string {
  if (n === 0) return 'Sem movimento';
  return `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;
}

/** "+R$ 1.200,00", ou um traço quando não houve nada. */
function Valor({ valor, sinal, className }: { valor: number; sinal: '+' | '−'; className?: string }) {
  if (valor <= 0) return <span className={cn('fin-t-body text-[var(--fin-text-3)]', className)}>—</span>;
  return (
    <span
      className={cn(
        'fin-t-body tabular-nums',
        sinal === '+' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]',
        className,
      )}
    >
      {sinal}{formatBRL(valor)}
    </span>
  );
}

const GRADE = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[var(--fin-s-4)] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_1.25rem]';

/**
 * O caderno: saldo anterior, uma linha por dia (ou semana, ou mês) com o que
 * entrou, o que saiu e o saldo corrido, e o saldo final. Cada linha abre o
 * detalhe no centro da tela.
 */
export function Caderno({ caderno, onAbrir }: CadernoProps) {
  const { periodo } = caderno;
  return (
    <div className="flex flex-col">
      {/* Cabeçalho das colunas: só onde há espaço para colunas. */}
      <div
        aria-hidden="true"
        className={cn(GRADE, 'hidden border-b border-[var(--fin-border)] px-[var(--fin-s-4)] pb-[var(--fin-s-2)] sm:grid')}
      >
        <span className="fin-t-overline text-[var(--fin-text-3)]">Data</span>
        <span className="text-right fin-t-overline text-[var(--fin-text-3)]">Entrou</span>
        <span className="text-right fin-t-overline text-[var(--fin-text-3)]">Saiu</span>
        <span className="text-right fin-t-overline text-[var(--fin-text-3)]">Saldo</span>
        <span />
      </div>

      <div className={cn(GRADE, 'px-[var(--fin-s-4)] py-[var(--fin-s-3)]')}>
        <span className="fin-t-body text-[var(--fin-text-2)]">Saldo anterior</span>
        <span className="hidden sm:block" />
        <span className="hidden sm:block" />
        <Money valor={caderno.saldoInicial} estado="ok" size="body" tone={caderno.saldoInicial < 0 ? 'negativo' : 'neutro'} className="text-[var(--fin-text-2)]" />
        <span className="hidden sm:block" />
      </div>

      <ol className="flex flex-col gap-0.5">
        {caderno.linhas.map(l => {
          const vazia = l.lancamentos.length === 0;
          const resumo = `${l.rotulo}: entrou ${formatBRL(l.entradas)}, saiu ${formatBRL(l.saidas)}, saldo ${formatBRL(l.saldo)}`;
          return (
            <li key={l.chave}>
              <button
                type="button"
                disabled={vazia}
                onClick={() => onAbrir(l)}
                aria-label={vazia ? `${l.rotulo}: sem movimento` : `${resumo}. Ver lançamentos`}
                className={cn(
                  GRADE,
                  'w-full rounded-[var(--fin-r-md)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-left',
                  'transition-colors duration-[var(--fin-dur-rapida)]',
                  !vazia && 'hover:bg-[var(--fin-surface-2)]',
                  l.contemHoje && 'bg-[var(--fin-accent-soft)] hover:bg-[var(--fin-accent-soft)]',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-[var(--fin-s-2)]">
                    <span
                      className={cn(
                        'truncate fin-t-body-strong',
                        l.futura ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text)]',
                      )}
                    >
                      {l.rotulo}
                    </span>
                    {l.contemHoje ? (
                      <span className="shrink-0 rounded-full bg-[var(--fin-accent)] px-2 py-px fin-t-caption font-medium text-[var(--fin-text-on-fill)]">
                        Hoje
                      </span>
                    ) : null}
                  </span>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {quantos(l.lancamentos.length)}
                    {l.futura && !vazia ? ' · previsto' : ''}
                  </span>
                </span>

                {/* Celular: saldo em cima, entrou e saiu embaixo. */}
                <span className="flex flex-col items-end sm:hidden">
                  <span
                    className={cn(
                      'fin-t-body-strong tabular-nums',
                      l.saldo < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
                    )}
                  >
                    {formatBRL(l.saldo)}
                  </span>
                  <span className="flex gap-[var(--fin-s-2)] fin-t-caption">
                    {l.entradas > 0 ? <span className="tabular-nums text-[var(--fin-positive)]">+{formatBRL(l.entradas)}</span> : null}
                    {l.saidas > 0 ? <span className="tabular-nums text-[var(--fin-text-2)]">−{formatBRL(l.saidas)}</span> : null}
                  </span>
                </span>

                <Valor valor={l.entradas} sinal="+" className="hidden text-right sm:block" />
                <Valor valor={l.saidas} sinal="−" className="hidden text-right sm:block" />
                <span
                  className={cn(
                    'hidden text-right fin-t-body-strong tabular-nums sm:block',
                    l.saldo < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
                  )}
                >
                  {formatBRL(l.saldo)}
                </span>
                <span className="hidden justify-end sm:flex">
                  {vazia ? null : <ChevronRight aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={cn(GRADE, 'mt-[var(--fin-s-1)] border-t border-[var(--fin-border)] px-[var(--fin-s-4)] pt-[var(--fin-s-3)]')}>
        <span className="flex flex-col">
          <span className="fin-t-body-strong text-[var(--fin-text)]">Saldo final</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {periodo.fim.split('-').reverse().slice(0, 2).join('/')}
          </span>
        </span>
        <Valor valor={caderno.entradas} sinal="+" className="hidden text-right fin-t-body-strong sm:block" />
        <Valor valor={caderno.saidas} sinal="−" className="hidden text-right fin-t-body-strong sm:block" />
        <Money
          valor={caderno.saldoFinal}
          estado="ok"
          size="metricSm"
          tone={caderno.saldoFinal < 0 ? 'negativo' : 'neutro'}
          className="min-w-0"
        />
        <span className="hidden sm:block" />
      </div>
    </div>
  );
}

export default Caderno;
