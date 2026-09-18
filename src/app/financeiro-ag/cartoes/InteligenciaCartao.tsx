'use client';

import * as React from 'react';
import { TrendingUp } from 'lucide-react';
import type { ContaPagar } from '@/lib/crm-types';
import { gastosPorEstabelecimento, comprometidoFuturo } from '@/lib/cartao-lancamentos';
import { hojeISO, mesDe, num, round2, soma } from '@/lib/money';
import { Money } from '@/components/fin/Money';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  const n = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${n[Number(m) - 1]}/${a.slice(2)}`;
}

export type InteligenciaCartaoProps = {
  /** Lançamentos de cartão, já filtrados pelo cartão escolhido ou todos. */
  lancamentos: ContaPagar[];
};

/**
 * Onde o dinheiro do cartão está indo, e quanto já está comprometido.
 *
 * As duas perguntas que a fatura sozinha não responde: em que se gasta
 * mais, e quanto das próximas faturas já está vendido por parcela que
 * ainda vai cair.
 */
export function InteligenciaCartao({ lancamentos }: InteligenciaCartaoProps) {
  const dados = React.useMemo(() => {
    const vivos = lancamentos.filter(l => l.status !== 'CANCELADO');

    const porEstabelecimento = gastosPorEstabelecimento(
      vivos.map(l => ({ descricao: l.descricao || '', valor: num(l.valor_final) })),
      8,
    );

    const parcelas = vivos.map(l => ({
      competencia: mesDe(l.data_vencimento || ''),
      valor: num(l.valor_final),
      pago: l.status === 'PAGO',
    }));
    const futuro = comprometidoFuturo(parcelas, mesDe(hojeISO()), 6);

    // Só o que é parcelado e ainda não foi pago: é a conta que ninguém faz
    // e que estoura o limite no mês seguinte.
    const emParcelas = vivos.filter(l => num(l.total_parcelas) > 1 && l.status !== 'PAGO');
    const comprometidoTotal = soma(emParcelas.map(l => num(l.valor_final)));

    return { porEstabelecimento, futuro, comprometidoTotal, parceladasAbertas: emParcelas.length };
  }, [lancamentos]);

  if (lancamentos.length === 0) return null;

  const maiorMes = Math.max(1, ...dados.futuro.map(f => f.total));

  return (
    <section className={`${CARTAO} p-[var(--fin-s-4)]`}>
      <header className="mb-[var(--fin-s-3)]">
        <h2 className="flex items-center gap-2 fin-t-subhead text-[var(--fin-text)]">
          <TrendingUp className="h-4 w-4 text-[var(--fin-text-3)]" aria-hidden />
          Inteligência do cartão
        </h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Onde o dinheiro está indo e quanto das próximas faturas já está comprometido
        </p>
      </header>

      <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-2">
        <div>
          <p className="fin-t-overline text-[var(--fin-text-3)]">Onde se gasta mais</p>
          {dados.porEstabelecimento.length === 0 ? (
            <p className="mt-2 fin-t-body text-[var(--fin-text-3)]">Sem lançamentos para agrupar.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {dados.porEstabelecimento.map(g => (
                <li key={g.chave} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate fin-t-body text-[var(--fin-text)]">
                    {g.rotulo}
                  </span>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {g.quantidade}x
                  </span>
                  <div className="h-1.5 w-20 overflow-hidden rounded-[var(--fin-r-dot)] bg-[var(--fin-surface-2)]">
                    <div
                      className="h-full rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)]"
                      style={{ width: `${Math.min(100, g.share_pct)}%` }}
                      aria-hidden
                    />
                  </div>
                  <span className="w-10 text-right fin-t-caption tabular-nums text-[var(--fin-text-3)]">
                    {g.share_pct.toFixed(0)}%
                  </span>
                  <span className="w-24 text-right">
                    <Money valor={g.total} size="body" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="fin-t-overline text-[var(--fin-text-3)]">Já comprometido nas próximas faturas</p>
          <div className="mt-2 flex items-baseline gap-2">
            <Money valor={dados.comprometidoTotal} size="metricSm" />
            <span className="fin-t-caption text-[var(--fin-text-3)]">
              em {dados.parceladasAbertas} parcela{dados.parceladasAbertas === 1 ? '' : 's'} que ainda vão cair
            </span>
          </div>
          <ul className="mt-3 flex items-end gap-2" style={{ height: 96 }}>
            {dados.futuro.map(f => (
              <li key={f.competencia} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
                  {f.total > 0 ? BRL(round2(f.total)).replace('R$', '').trim() : ''}
                </span>
                <div
                  className="w-full max-w-[28px] rounded-t-[3px] bg-[var(--fin-warning)]"
                  style={{ height: Math.max(2, Math.round((f.total / maiorMes) * 56)) }}
                  title={`${rotuloMes(f.competencia)}: ${BRL(f.total)}`}
                />
                <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
                  {rotuloMes(f.competencia)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 fin-t-caption text-[var(--fin-text-3)]">
            Parcela já paga não aparece aqui: o que está no gráfico ainda vai sair do caixa.
          </p>
        </div>
      </div>
    </section>
  );
}

export default InteligenciaCartao;
