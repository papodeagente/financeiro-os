'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, TriangleAlert } from 'lucide-react';
import { cva } from 'class-variance-authority';

import { Button } from '@/components/ui/button';
import { Money } from '@/components/fin/Money';
import { StatusChip, type StatusDominio } from '@/components/fin/StatusChip';
import { EmptyLesson, type EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { cn, formatDate } from '@/lib/utils';

export type FinColunaBase<T> = {
  id: string;
  cabecalho: string;
  sortable?: boolean;
  /** min-width em px. Nunca width fixa: valor longo não pode estourar. */
  minWidth?: number;
  /** Ordem de colapso declarada. 1 some primeiro. Ver seção 8.4. */
  prioridade?: 1 | 2 | 3;
};

export type FinColuna<T> =
  | (FinColunaBase<T> & { tipo: 'texto'; render: (r: T) => React.ReactNode; acessor?: (r: T) => string | number })
  | (FinColunaBase<T> & {
      tipo: 'dinheiro';
      valor: (r: T) => number;
      /** Sublinha em caption logo abaixo do número, NUNCA coluna extra. */
      sub?: (r: T) => React.ReactNode | null;
      tone?: (r: T) => 'neutro' | 'positivo' | 'negativo';
    })
  | (FinColunaBase<T> & { tipo: 'data'; valor: (r: T) => string | null })
  | (FinColunaBase<T> & { tipo: 'status'; valor: (r: T) => string; dominio: StatusDominio })
  | (FinColunaBase<T> & { tipo: 'acoes'; render: (r: T) => React.ReactNode });

export type FinTableProps<T> = {
  linhas: T[];
  colunas: FinColuna<T>[];
  chave: (r: T) => string;
  densidade?: 'confortavel' | 'compacta';
  estado: 'carregando' | 'erro' | 'ok';
  erro?: { mensagem: string; onTentarDeNovo: () => void } | null;
  vazio: EmptyLessonProps;
  /**
   * Totais são SEMPRE calculados fora, sobre o recorte inteiro, e passados prontos.
   * O componente nunca soma o que está na tela.
   */
  totais?: { colunaId: string; valor: number; rotulo: string }[];
  onLinhaClick?: (r: T) => void;
};

const celulaVariants = cva('align-middle px-3 first:pl-4 last:pr-4', {
  variants: {
    densidade: {
      confortavel: 'py-3',
      compacta: 'py-2',
    },
    alinhamento: {
      esquerda: 'text-left',
      direita: 'text-right',
    },
  },
  defaultVariants: { densidade: 'confortavel', alinhamento: 'esquerda' },
});

const PRIORIDADE_CLASSE: Record<1 | 2 | 3, string> = {
  1: 'max-lg:hidden',
  2: 'max-[900px]:hidden',
  3: '',
};

const LARGURA_POR_TIPO: Record<FinColuna<unknown>['tipo'], string> = {
  texto: '',
  dinheiro: 'min-w-[112px]',
  data: 'min-w-[92px]',
  status: 'w-[128px]',
  acoes: 'w-[96px]',
};

function alinhamentoDe<T>(coluna: FinColuna<T>): 'esquerda' | 'direita' {
  return coluna.tipo === 'dinheiro' || coluna.tipo === 'acoes' ? 'direita' : 'esquerda';
}

function acessorDe<T>(coluna: FinColuna<T>): ((r: T) => string | number | null) | null {
  if (!coluna.sortable) return null;
  switch (coluna.tipo) {
    case 'texto':
      return coluna.acessor ? (r: T) => coluna.acessor!(r) : null;
    case 'dinheiro':
      return (r: T) => coluna.valor(r);
    case 'data':
      return (r: T) => coluna.valor(r);
    case 'status':
      return (r: T) => coluna.valor(r);
    default:
      return null;
  }
}

function estiloMinimo(minWidth?: number): React.CSSProperties | undefined {
  if (!minWidth) return undefined;
  return { ['--fin-col-min' as string]: `${minWidth}px` } as React.CSSProperties;
}

function classesColuna<T>(coluna: FinColuna<T>): string {
  return cn(
    LARGURA_POR_TIPO[coluna.tipo],
    coluna.minWidth ? 'min-w-[var(--fin-col-min)]' : null,
    coluna.prioridade ? PRIORIDADE_CLASSE[coluna.prioridade] : null,
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
      {children}
    </div>
  );
}

function Esqueleto<T>({
  colunas,
  densidade,
}: {
  colunas: FinColuna<T>[];
  densidade: 'confortavel' | 'compacta';
}) {
  return (
    <Moldura>
      <div className="overflow-hidden rounded-[var(--fin-r-lg)]">
        <table className="w-full border-collapse" aria-hidden="true">
          <tbody>
            {Array.from({ length: 6 }).map((_, linha) => (
              <tr key={linha} className="border-b border-[var(--fin-border)] last:border-b-0">
                {colunas.map((coluna) => (
                  <td
                    key={coluna.id}
                    style={estiloMinimo(coluna.minWidth)}
                    className={cn(
                      celulaVariants({ densidade, alinhamento: alinhamentoDe(coluna) }),
                      classesColuna(coluna),
                    )}
                  >
                    <span
                      className={cn(
                        'block h-4 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]',
                        alinhamentoDe(coluna) === 'direita' ? 'ml-auto w-[88px]' : 'w-[70%]',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sr-only" role="status">
        Carregando os lançamentos.
      </p>
    </Moldura>
  );
}

function BlocoErro({ mensagem, onTentarDeNovo }: { mensagem: string; onTentarDeNovo?: () => void }) {
  return (
    <Moldura>
      <div className="flex flex-col items-center gap-[var(--fin-s-3)] px-[var(--fin-s-5)] py-[var(--fin-s-6)] text-center">
        <span
          className="flex size-10 items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]"
          aria-hidden="true"
        >
          <TriangleAlert className="size-5" />
        </span>
        <p className="fin-t-body-strong text-[var(--fin-text)]" role="alert">
          Não foi possível carregar os dados
        </p>
        <p className="fin-t-caption max-w-[52ch] text-[var(--fin-text-3)]">{mensagem}</p>
        {onTentarDeNovo ? (
          <Button
            variant="outline"
            onClick={onTentarDeNovo}
            className="h-10 max-lg:h-11 rounded-[var(--fin-r-md)] px-[var(--fin-s-4)]"
          >
            Tentar de novo
          </Button>
        ) : null}
      </div>
    </Moldura>
  );
}

export function FinTable<T>({
  linhas,
  colunas,
  chave,
  densidade = 'confortavel',
  estado,
  erro,
  vazio,
  totais,
  onLinhaClick,
}: FinTableProps<T>) {
  const [ordem, setOrdem] = React.useState<{ colunaId: string; direcao: 'asc' | 'desc' } | null>(null);
  const [rolado, setRolado] = React.useState(false);

  const linhasOrdenadas = React.useMemo(() => {
    if (!ordem) return linhas;
    const coluna = colunas.find((c) => c.id === ordem.colunaId);
    if (!coluna) return linhas;
    const acessor = acessorDe(coluna);
    if (!acessor) return linhas;
    const fator = ordem.direcao === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const va = acessor(a);
      const vb = acessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * fator;
      return String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' }) * fator;
    });
  }, [linhas, colunas, ordem]);

  const alternarOrdem = React.useCallback((colunaId: string) => {
    setOrdem((atual) => {
      if (!atual || atual.colunaId !== colunaId) return { colunaId, direcao: 'asc' };
      if (atual.direcao === 'asc') return { colunaId, direcao: 'desc' };
      return null;
    });
  }, []);

  if (estado === 'carregando') {
    return <Esqueleto colunas={colunas} densidade={densidade} />;
  }

  if (estado === 'erro') {
    return (
      <BlocoErro
        mensagem={erro?.mensagem ?? 'A consulta falhou antes de responder.'}
        onTentarDeNovo={erro?.onTentarDeNovo}
      />
    );
  }

  if (linhas.length === 0) {
    return <EmptyLesson {...vazio} />;
  }

  const primeiraColuna = colunas[0];

  return (
    <Moldura>
      <div
        tabIndex={0}
        role="region"
        aria-label="Tabela de lançamentos, rolagem horizontal disponível"
        onScroll={(evento) => setRolado(evento.currentTarget.scrollTop > 0)}
        data-rolado={rolado ? 'sim' : undefined}
        className="group/tabela w-full overflow-x-auto rounded-[var(--fin-r-lg)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
      >
        <table data-fin-table className="w-full border-collapse">
          <thead>
            <tr>
              {colunas.map((coluna) => {
                const ordenada = ordem?.colunaId === coluna.id;
                const podeOrdenar = acessorDe(coluna) !== null;
                const alinhamento = alinhamentoDe(coluna);
                const Icone = !ordenada ? ChevronsUpDown : ordem?.direcao === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={coluna.id}
                    scope="col"
                    style={estiloMinimo(coluna.minWidth)}
                    aria-sort={
                      podeOrdenar
                        ? ordenada
                          ? ordem?.direcao === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      'sticky top-0 z-10 h-9 max-lg:h-11 whitespace-nowrap border-b border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 first:pl-4 last:pr-4',
                      'fin-t-overline text-[var(--fin-text-3)]',
                      'group-data-[rolado=sim]/tabela:shadow-[var(--fin-e1)]',
                      alinhamento === 'direita' ? 'text-right' : 'text-left',
                      classesColuna(coluna),
                    )}
                  >
                    {podeOrdenar ? (
                      <button
                        type="button"
                        onClick={() => alternarOrdem(coluna.id)}
                        className={cn(
                          'inline-flex h-9 max-lg:h-11 w-full items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-sm)] fin-t-overline text-[var(--fin-text-3)]',
                          'hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                          alinhamento === 'direita' ? 'justify-end' : 'justify-start',
                        )}
                      >
                        {coluna.cabecalho}
                        <Icone className="size-3 opacity-70" aria-hidden="true" />
                      </button>
                    ) : (
                      coluna.cabecalho
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {linhasOrdenadas.map((linha) => (
              <tr
                key={chave(linha)}
                onClick={onLinhaClick ? () => onLinhaClick(linha) : undefined}
                onKeyDown={
                  onLinhaClick
                    ? (evento) => {
                        if (evento.key === 'Enter' || evento.key === ' ') {
                          evento.preventDefault();
                          onLinhaClick(linha);
                        }
                      }
                    : undefined
                }
                role={onLinhaClick ? 'button' : undefined}
                tabIndex={onLinhaClick ? 0 : undefined}
                className={cn(
                  'border-b border-[var(--fin-border)] last:border-b-0 hover:bg-[var(--fin-surface-2)]',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                  onLinhaClick && 'cursor-pointer',
                )}
              >
                {colunas.map((coluna) => {
                  const alinhamento = alinhamentoDe(coluna);
                  const classes = cn(
                    celulaVariants({ densidade, alinhamento }),
                    'fin-t-body text-[var(--fin-text)]',
                    classesColuna(coluna),
                  );

                  if (coluna.tipo === 'dinheiro') {
                    const sublinha = coluna.sub?.(linha) ?? null;
                    return (
                      <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes}>
                        <Money
                          valor={coluna.valor(linha)}
                          size="strong"
                          tone={coluna.tone?.(linha) ?? 'neutro'}
                          estado="ok"
                        />
                        {sublinha ? (
                          <span className="mt-[var(--fin-s-1)] block fin-t-caption text-[var(--fin-text-3)]">
                            {sublinha}
                          </span>
                        ) : null}
                      </td>
                    );
                  }

                  if (coluna.tipo === 'data') {
                    return (
                      <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={cn(classes, 'whitespace-nowrap tabular-nums')}>
                        {formatDate(coluna.valor(linha))}
                      </td>
                    );
                  }

                  if (coluna.tipo === 'status') {
                    return (
                      <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes}>
                        <StatusChip valor={coluna.valor(linha)} dominio={coluna.dominio} dot />
                      </td>
                    );
                  }

                  if (coluna.tipo === 'acoes') {
                    return (
                      <td
                        key={coluna.id}
                        style={estiloMinimo(coluna.minWidth)}
                        className={classes}
                        onClick={(evento) => evento.stopPropagation()}
                      >
                        <span className="inline-flex items-center justify-end gap-[var(--fin-s-1)]">
                          {coluna.render(linha)}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes}>
                      {coluna.render(linha)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {totais && totais.length > 0 ? (
            <tfoot className="bg-[var(--fin-surface-sunken)]">
              {totais.map((total) => (
                <tr key={`${total.colunaId}-${total.rotulo}`} className="border-t-2 border-[var(--fin-border-strong)]">
                  {colunas.map((coluna, indice) => {
                    const alvo = coluna.id === total.colunaId;
                    const rotuloAqui = indice === 0;
                    const alinhamento = alinhamentoDe(coluna);
                    const classes = cn(
                      celulaVariants({ densidade, alinhamento }),
                      'fin-t-body-strong text-[var(--fin-text)]',
                      classesColuna(coluna),
                    );

                    if (alvo && rotuloAqui) {
                      return (
                        <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes}>
                          <span className="flex items-center justify-between gap-[var(--fin-s-3)]">
                            <span className="fin-t-caption text-[var(--fin-text-3)]">{total.rotulo}</span>
                            <Money valor={total.valor} size="strong" estado="ok" />
                          </span>
                        </td>
                      );
                    }

                    if (alvo) {
                      return (
                        <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes}>
                          <Money valor={total.valor} size="strong" estado="ok" />
                        </td>
                      );
                    }

                    if (rotuloAqui) {
                      return (
                        <td
                          key={coluna.id}
                          style={estiloMinimo(coluna.minWidth)}
                          className={cn(classes, 'fin-t-caption text-[var(--fin-text-3)]')}
                        >
                          {total.rotulo}
                        </td>
                      );
                    }

                    return (
                      <td key={coluna.id} style={estiloMinimo(coluna.minWidth)} className={classes} aria-hidden="true" />
                    );
                  })}
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </Moldura>
  );
}

export default FinTable;
