'use client';

import * as React from 'react';

import { Money } from '@/components/fin/Money';
import { StatusChip } from '@/components/fin/StatusChip';
import { divSegura } from '@/lib/money';

export type BarraFluxo = {
  periodo: string;
  label: string;
  entradas: number;
  saidas: number;
};

export type ProjecaoFunis = {
  count: number;
  receita: number;
  investimento: number;
};

export type GraficoFluxoProps = {
  barras: BarraFluxo[];
  /** Escala compartilhada com a tabela. Vem calculada de fora. */
  maxVal: number;
  /** Quando presente, a projeção do CRM aparece como faixa própria e escrita. */
  projecao?: ProjecaoFunis | null;
};

/** Só converte proporção em altura de barra. Nenhuma aritmética de dinheiro. */
function altura(valor: number, maxVal: number): React.CSSProperties {
  const bruto = divSegura(valor, maxVal) * 100;
  const limitado = Math.min(100, Math.max(0, bruto));
  return { ['--fin-bar' as string]: `${limitado}%` } as React.CSSProperties;
}

function ItemLegenda({ amostra, texto }: { amostra: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-[var(--fin-s-1)] fin-t-caption text-[var(--fin-text-2)]">
      <span aria-hidden="true" className={amostra} />
      {texto}
    </span>
  );
}

export function GraficoFluxo({ barras, maxVal, projecao }: GraficoFluxoProps) {
  const primeiro = barras[0]?.label ?? '';
  const ultimo = barras[barras.length - 1]?.label ?? '';
  const descricao = [
    `Gráfico de barras com entradas e saídas de ${barras.length} períodos, de ${primeiro} a ${ultimo}.`,
    projecao ? 'Inclui a barra tracejada da projeção do CRM, que é estimativa e não entra nos totais.' : null,
    'Os mesmos valores estão na tabela logo abaixo.',
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <div className="flex flex-wrap items-center gap-[var(--fin-s-4)]">
        <ItemLegenda
          amostra="size-3 shrink-0 rounded-[var(--fin-r-sm)] bg-[var(--fin-accent)]"
          texto="Entradas"
        />
        <ItemLegenda
          amostra="size-3 shrink-0 rounded-[var(--fin-r-sm)] bg-[var(--fin-text-3)]"
          texto="Saídas"
        />
        {projecao ? (
          <ItemLegenda
            amostra="size-3 shrink-0 rounded-[var(--fin-r-sm)] border border-dashed border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]"
            texto="Projeção do CRM"
          />
        ) : null}
      </div>

      <div
        tabIndex={0}
        role="img"
        aria-label={descricao}
        className="w-full overflow-x-auto rounded-[var(--fin-r-md)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
      >
        <div className="flex min-w-full items-end gap-[var(--fin-s-2)]">
          {barras.map((b) => (
            <div
              key={b.periodo}
              className="flex min-w-16 flex-1 flex-col items-center gap-[var(--fin-s-2)]"
            >
              <div className="flex h-32 w-full items-end justify-center gap-[var(--fin-s-1)]">
                <div className="flex h-full w-3 flex-col justify-end">
                  {projecao && projecao.receita > 0 ? (
                    <span
                      style={altura(projecao.receita, maxVal)}
                      className="h-[var(--fin-bar)] w-full rounded-t-[var(--fin-r-sm)] border border-dashed border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]"
                    />
                  ) : null}
                  <span
                    style={altura(b.entradas, maxVal)}
                    className="h-[var(--fin-bar)] w-full bg-[var(--fin-accent)]"
                  />
                </div>
                <div className="flex h-full w-3 flex-col justify-end">
                  {projecao && projecao.investimento > 0 ? (
                    <span
                      style={altura(projecao.investimento, maxVal)}
                      className="h-[var(--fin-bar)] w-full rounded-t-[var(--fin-r-sm)] border border-dashed border-[var(--fin-text-3)] bg-[var(--fin-surface-2)]"
                    />
                  ) : null}
                  <span
                    style={altura(b.saidas, maxVal)}
                    className="h-[var(--fin-bar)] w-full bg-[var(--fin-text-3)]"
                  />
                </div>
              </div>
              <span className="w-full truncate text-center fin-t-caption text-[var(--fin-text-3)]">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {projecao ? (
        <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-info)]/24 bg-[var(--fin-info-soft)] p-[var(--fin-s-3)]">
          <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
            <StatusChip valor="CRM" dominio="origem" dot />
            <span className="fin-t-body-strong text-[var(--fin-text)]">
              {projecao.count === 1
                ? 'Projeção de 1 funil em execução'
                : `Projeção de ${projecao.count} funis em execução`}
            </span>
          </div>
          <p className="fin-t-caption text-[var(--fin-text-2)]">
            Estimativa do CRM aplicada a cada período do gráfico. Não é dinheiro contratado e não
            entra nos valores da tabela nem no saldo previsto.
          </p>
          <div className="flex flex-wrap items-center gap-[var(--fin-s-4)]">
            <span className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
              Entradas estimadas por período
              <Money valor={projecao.receita} estado="ok" size="strong" align="esquerda" />
            </span>
            <span className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
              Saídas estimadas por período
              <Money valor={projecao.investimento} estado="ok" size="strong" align="esquerda" />
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default GraficoFluxo;
