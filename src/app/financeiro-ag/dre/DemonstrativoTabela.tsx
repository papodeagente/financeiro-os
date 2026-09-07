'use client';

import * as React from 'react';

import { Money } from '@/components/fin/Money';
import { cn } from '@/lib/utils';

export type TipoLinhaDemonstrativo = 'header' | 'item' | 'subtotal' | 'total';

/** Linha já pronta para exibição. O componente nunca soma nem arredonda nada. */
export type LinhaDemonstrativo = {
  chave: string;
  rotulo: React.ReactNode;
  codigo: string;
  tipo: TipoLinhaDemonstrativo;
  indent: number;
  valor: number;
  /** null quando o mês comparado não tem a linha correspondente. */
  comparativo: number | null;
  variacao: number | null;
};

/** Rodapé de percentuais. Valor já formatado fora. */
export type NotaDemonstrativo = { chave: string; rotulo: string; valor: string };

export type DemonstrativoTabelaProps = {
  linhas: LinhaDemonstrativo[];
  notas: NotaDemonstrativo[];
  rotuloPeriodo: string;
  rotuloComparativo: string | null;
  /** Vai para o <caption> e para o aria-label da região rolável. */
  descricao: string;
};

/** Hierarquia por indentação de 16px por nível. */
const RECUO: Record<number, string> = {
  0: 'pl-4',
  1: 'pl-8',
  2: 'pl-12',
};

/** Densidade compacta: 20px de texto mais 8px em cima e embaixo, 36px de linha. */
const CELULA = 'px-3 py-2 align-middle';

const PESO: Record<TipoLinhaDemonstrativo, string> = {
  header: 'fin-t-body-strong text-[var(--fin-text)]',
  item: 'fin-t-body text-[var(--fin-text-2)]',
  subtotal: 'fin-t-body-strong text-[var(--fin-text)]',
  total: 'fin-t-body-strong text-[var(--fin-text)]',
};

const LINHA: Record<TipoLinhaDemonstrativo, string> = {
  header: 'border-b border-b-[var(--fin-border)]',
  item: 'border-b border-b-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
  subtotal:
    'border-b border-b-[var(--fin-border)] border-t border-t-[var(--fin-border-strong)]',
  total: 'border-t-2 border-t-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)]',
};

const CABECALHO = cn(
  'sticky top-0 z-10 h-9 whitespace-nowrap bg-[var(--fin-surface)] px-3 py-2',
  'fin-t-overline border-b border-b-[var(--fin-border)] text-[var(--fin-text-3)]',
);

/**
 * Só o resultado, positivo ou negativo, carrega cor. Linha de dedução mostra o
 * sinal no próprio número, sem pintar a tabela inteira de vermelho.
 */
function tomDe(tipo: TipoLinhaDemonstrativo, valor: number | null): 'neutro' | 'negativo' {
  if (valor === null) return 'neutro';
  const ehResultado = tipo === 'total' || tipo === 'subtotal';
  return ehResultado && valor < 0 ? 'negativo' : 'neutro';
}

/**
 * Demonstrativo impresso, não lista de registros: cada linha tem papel fixo
 * (grupo, conta, subtotal, total) e a ordem é a da conta, nunca ordenável.
 * Por isso não usa a FinTable, que ordena e trata toda linha como igual.
 */
export function DemonstrativoTabela({
  linhas,
  notas,
  rotuloPeriodo,
  rotuloComparativo,
  descricao,
}: DemonstrativoTabelaProps) {
  const comComparativo = rotuloComparativo !== null;
  const totalColunas = comComparativo ? 4 : 2;

  return (
    <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
      <div
        tabIndex={0}
        role="region"
        aria-label={`${descricao}. Rolagem horizontal disponível.`}
        className={cn(
          'w-full overflow-x-auto rounded-[var(--fin-r-lg)] outline-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
        )}
      >
        <table data-fin-table className="w-full border-collapse">
          <caption className="sr-only">{descricao}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(CABECALHO, 'pl-4 text-left')}>
                Conta
              </th>
              <th scope="col" className={cn(CABECALHO, 'min-w-[128px] text-right', !comComparativo && 'pr-4')}>
                {rotuloPeriodo}
              </th>
              {comComparativo ? (
                <>
                  <th scope="col" className={cn(CABECALHO, 'min-w-[128px] text-right')}>
                    {rotuloComparativo}
                  </th>
                  <th scope="col" className={cn(CABECALHO, 'min-w-[72px] pr-4 text-right')}>
                    Variação
                  </th>
                </>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.chave} className={LINHA[linha.tipo]}>
                <th
                  scope="row"
                  className={cn(
                    CELULA,
                    'text-left',
                    PESO[linha.tipo],
                    RECUO[linha.indent] ?? RECUO[2],
                  )}
                >
                  <span className="flex items-baseline gap-[var(--fin-s-2)]">
                    {linha.codigo ? (
                      <span className="fin-t-code text-[var(--fin-text-3)]">{linha.codigo}</span>
                    ) : null}
                    <span className="min-w-0">{linha.rotulo}</span>
                  </span>
                </th>

                <td className={cn(CELULA, 'text-right', !comComparativo && 'pr-4')}>
                  <Money
                    valor={linha.valor}
                    estado="ok"
                    size="strong"
                    tone={tomDe(linha.tipo, linha.valor)}
                  />
                </td>

                {comComparativo ? (
                  <>
                    <td className={cn(CELULA, 'text-right')}>
                      <Money
                        valor={linha.comparativo}
                        estado={linha.comparativo === null ? 'indisponivel' : 'ok'}
                        size="strong"
                        tone={tomDe(linha.tipo, linha.comparativo)}
                      />
                    </td>
                    <td className={cn(CELULA, 'pr-4 text-right')}>
                      <Money
                        valor={linha.variacao}
                        estado={linha.variacao === null ? 'indisponivel' : 'ok'}
                        size="caption"
                        tone="suave"
                        sinal="sempre"
                      />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>

          {notas.length > 0 ? (
            <tfoot>
              {notas.map((nota) => (
                <tr key={nota.chave} className="border-t border-t-[var(--fin-border)]">
                  <td colSpan={totalColunas} className={cn(CELULA, 'pr-4 pl-4')}>
                    <span className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{nota.rotulo}</span>
                      <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">
                        {nota.valor}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export default DemonstrativoTabela;
