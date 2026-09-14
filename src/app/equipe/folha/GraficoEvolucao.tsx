'use client';

import * as React from 'react';
import type { PontoEvolucao } from '@/lib/folha-pagamento';

/**
 * Folha contra faturamento, mês a mês.
 *
 * Duas barras por mês na MESMA escala, porque o que interessa é a relação
 * entre elas. Escalas separadas deixariam a folha visualmente do tamanho
 * do faturamento, que é exatamente a leitura errada.
 *
 * Só converte proporção em altura. Nenhuma aritmética de dinheiro aqui.
 */

export type GraficoEvolucaoProps = {
  pontos: PontoEvolucao[];
  /** Mês em foco, destacado na série. */
  mesAtivo: string;
  onSelecionarMes?: (mes: string) => void;
};

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function rotuloCurto(ym: string): string {
  const [a, m] = ym.split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a.slice(2)}`;
}

export function GraficoEvolucao({ pontos, mesAtivo, onSelecionarMes }: GraficoEvolucaoProps) {
  const maior = React.useMemo(
    () => Math.max(1, ...pontos.flatMap(p => [p.folha, p.faturamento])),
    [pontos],
  );

  if (pontos.length === 0) return null;

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-wrap items-center gap-[var(--fin-s-4)]">
        <span className="inline-flex items-center gap-1.5 fin-t-caption text-[var(--fin-text-2)]">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--fin-accent)]" aria-hidden />
          Folha
        </span>
        <span className="inline-flex items-center gap-1.5 fin-t-caption text-[var(--fin-text-2)]">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--fin-positive)]" aria-hidden />
          Faturamento
        </span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">mesma escala nos dois</span>
      </div>

      <div className="overflow-x-auto">
        <ul className="flex min-w-[34rem] items-end gap-[var(--fin-s-2)]" style={{ height: 180 }}>
          {pontos.map(p => {
            const ativo = p.mes === mesAtivo;
            const hFolha = Math.max(2, Math.round((p.folha / maior) * 140));
            const hFat = Math.max(2, Math.round((p.faturamento / maior) * 140));
            const semBase = p.faturamento <= 0;
            return (
              <li key={p.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span
                  className={`fin-t-caption tabular-nums ${
                    semBase
                      ? 'text-[var(--fin-text-4)]'
                      : p.folha_sobre_faturamento_pct > 40
                        ? 'text-[var(--fin-negative-text)]'
                        : 'text-[var(--fin-text-3)]'
                  }`}
                  title={
                    semBase
                      ? 'Sem faturamento no mês: não há base para comparar'
                      : `Folha representa ${p.folha_sobre_faturamento_pct.toFixed(1)}% do faturamento`
                  }
                >
                  {semBase ? '—' : `${Math.round(p.folha_sobre_faturamento_pct)}%`}
                </span>

                <div className="flex w-full items-end justify-center gap-[3px]" style={{ height: 140 }}>
                  <div
                    className="w-1/2 max-w-[18px] rounded-t-[3px] bg-[var(--fin-accent)]"
                    style={{ height: hFolha, opacity: ativo ? 1 : 0.65 }}
                    title={`Folha de ${rotuloCurto(p.mes)}: ${BRL(p.folha)}`}
                  />
                  <div
                    className="w-1/2 max-w-[18px] rounded-t-[3px] bg-[var(--fin-positive)]"
                    style={{ height: hFat, opacity: ativo ? 1 : 0.65 }}
                    title={`Faturamento de ${rotuloCurto(p.mes)}: ${BRL(p.faturamento)}`}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onSelecionarMes?.(p.mes)}
                  className={`w-full truncate rounded px-0.5 fin-t-caption ${
                    ativo
                      ? 'font-semibold text-[var(--fin-text)]'
                      : 'text-[var(--fin-text-3)] hover:text-[var(--fin-text)]'
                  } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]`}
                  aria-pressed={ativo}
                  aria-label={`Ver a folha de ${rotuloCurto(p.mes)}`}
                >
                  {rotuloCurto(p.mes)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tabela equivalente, para leitor de tela e para quem prefere número.
          O gráfico sozinho não é acessível. */}
      <details className="fin-t-caption text-[var(--fin-text-3)]">
        <summary className="cursor-pointer">Ver os números do gráfico</summary>
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-1 fin-t-overline">Mês</th>
              <th scope="col" className="py-1 text-right fin-t-overline">Folha</th>
              <th scope="col" className="py-1 text-right fin-t-overline">Faturamento</th>
              <th scope="col" className="py-1 text-right fin-t-overline">Folha sobre receita</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map(p => (
              <tr key={p.mes} className="border-t border-[var(--fin-border)]">
                <td className="py-1">{rotuloCurto(p.mes)}</td>
                <td className="py-1 text-right tabular-nums">{BRL(p.folha)}</td>
                <td className="py-1 text-right tabular-nums">{BRL(p.faturamento)}</td>
                <td className="py-1 text-right tabular-nums">
                  {p.faturamento > 0 ? `${p.folha_sobre_faturamento_pct.toFixed(1)}%` : 'sem base'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default GraficoEvolucao;
