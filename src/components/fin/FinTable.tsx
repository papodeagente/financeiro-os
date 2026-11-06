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
      /** 'indisponivel' não pinta número (ex.: conta em moeda sem cotação). Ausente = 'ok'. */
      estado?: (r: T) => 'ok' | 'indisponivel';
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

  // Tudo abaixo é opcional (05/11/2026). Sem estas propriedades a tabela
  // desenha exatamente o mesmo HTML de antes (scripts/test-fintable.mjs).

  /** Caixa de seleção por linha e no cabeçalho (marca as visíveis). */
  selecao?: {
    selecionadas: ReadonlySet<string>;
    /** Chaves alteradas e se ficaram marcadas. */
    onAlterar: (chaves: string[], marcar: boolean) => void;
    /** Rótulo da caixa da linha, para leitor de tela. */
    rotulo?: (r: T) => string;
  };
  /** Ids das colunas mostradas. A ordem é sempre a de `colunas`. */
  colunasVisiveis?: readonly string[];
  /**
   * Ordem decidida fora (lista paginada no servidor): o cabeçalho só avisa
   * o clique e mostra a ordem atual; as linhas ficam na ordem em que chegam.
   */
  ordemControlada?: {
    colunaId: string | null;
    direcao: 'asc' | 'desc';
    onOrdenar: (colunaId: string) => void;
  };
  /** Duplo clique (ou Enter, sem onLinhaClick) abre o registro. */
  onLinhaDuploClique?: (r: T) => void;
  /** Clique direito (ou Shift+F10 / tecla de menu) na linha. */
  onLinhaMenu?: (r: T, posicao: { x: number; y: number }) => void;
  /** Conteúdo dentro da moldura, abaixo da tabela (páginas, somas). */
  rodape?: React.ReactNode;
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
    <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
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
  selecao,
  colunasVisiveis,
  ordemControlada,
  onLinhaDuploClique,
  onLinhaMenu,
  rodape,
}: FinTableProps<T>) {
  const [ordemLocal, setOrdem] = React.useState<{ colunaId: string; direcao: 'asc' | 'desc' } | null>(null);
  const [rolado, setRolado] = React.useState(false);
  const colunasTodas = colunas;
  colunas = React.useMemo(
    () => (colunasVisiveis ? colunasTodas.filter((c) => colunasVisiveis.includes(c.id)) : colunasTodas),
    [colunasTodas, colunasVisiveis],
  );
  const foraColuna = ordemControlada?.colunaId ?? null;
  const foraDirecao = ordemControlada?.direcao ?? 'asc';
  const controlada = Boolean(ordemControlada);
  const ordem = React.useMemo(
    () => (controlada ? (foraColuna ? { colunaId: foraColuna, direcao: foraDirecao } : null) : ordemLocal),
    [controlada, foraColuna, foraDirecao, ordemLocal],
  );

  const linhasOrdenadas = React.useMemo(() => {
    if (controlada) return linhas;
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
  }, [linhas, colunas, ordem, controlada]);

  const onOrdenarFora = ordemControlada?.onOrdenar;
  const alternarOrdem = React.useCallback((colunaId: string) => {
    if (onOrdenarFora) { onOrdenarFora(colunaId); return; }
    setOrdem((atual) => {
      if (!atual || atual.colunaId !== colunaId) return { colunaId, direcao: 'asc' };
      if (atual.direcao === 'asc') return { colunaId, direcao: 'desc' };
      return null;
    });
  }, [onOrdenarFora]);

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
              {selecao ? (
                <th
                  scope="col"
                  className="sticky top-0 z-10 h-9 max-lg:h-11 w-10 border-b border-[var(--fin-border)] bg-[var(--fin-surface)] pl-4 pr-1 group-data-[rolado=sim]/tabela:shadow-[var(--fin-e1)]"
                >
                  <CaixaDoCabecalho linhas={linhasOrdenadas} chave={chave} selecao={selecao} />
                </th>
              ) : null}
              {colunas.map((coluna) => {
                const ordenada = ordem?.colunaId === coluna.id;
                const podeOrdenar = ordemControlada ? Boolean(coluna.sortable) && coluna.tipo !== 'acoes' : acessorDe(coluna) !== null;
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
            {linhasOrdenadas.map((linha) => {
              const k = chave(linha);
              const marcada = selecao ? selecao.selecionadas.has(k) : false;
              const interativa = Boolean(onLinhaClick || onLinhaDuploClique || onLinhaMenu || selecao);
              return (
              <tr
                key={k}
                onClick={onLinhaClick ? () => onLinhaClick(linha) : undefined}
                onDoubleClick={onLinhaDuploClique ? () => onLinhaDuploClique(linha) : undefined}
                onContextMenu={
                  onLinhaMenu
                    ? (evento) => {
                        evento.preventDefault();
                        onLinhaMenu(linha, { x: evento.clientX, y: evento.clientY });
                      }
                    : undefined
                }
                onKeyDown={
                  interativa
                    ? (evento) => {
                        // Só quando o foco está na linha (não num botão ou caixa dentro dela).
                        if (evento.target !== evento.currentTarget) return;
                        if (onLinhaMenu && (evento.key === 'ContextMenu' || (evento.key === 'F10' && evento.shiftKey))) {
                          evento.preventDefault();
                          const caixa = evento.currentTarget.getBoundingClientRect();
                          onLinhaMenu(linha, { x: caixa.left + 24, y: caixa.bottom });
                          return;
                        }
                        if (onLinhaClick && (evento.key === 'Enter' || evento.key === ' ')) {
                          evento.preventDefault();
                          onLinhaClick(linha);
                          return;
                        }
                        if (selecao && evento.key === ' ') {
                          evento.preventDefault();
                          selecao.onAlterar([k], !marcada);
                          return;
                        }
                        if (onLinhaDuploClique && evento.key === 'Enter') {
                          evento.preventDefault();
                          onLinhaDuploClique(linha);
                        }
                      }
                    : undefined
                }
                role={onLinhaClick ? 'button' : undefined}
                tabIndex={interativa ? 0 : undefined}
                aria-selected={selecao ? marcada : undefined}
                className={cn(
                  'border-b border-[var(--fin-border)] last:border-b-0 hover:bg-[var(--fin-surface-2)]',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                  onLinhaClick && 'cursor-pointer',
                  marcada && 'bg-[var(--fin-accent-soft)] hover:bg-[var(--fin-accent-soft)]',
                  (onLinhaDuploClique || onLinhaMenu) && !onLinhaClick && 'cursor-default select-none',
                )}
              >
                {selecao ? (
                  <td
                    className={cn(celulaVariants({ densidade }), 'w-10 pr-1')}
                    onClick={(evento) => evento.stopPropagation()}
                    onDoubleClick={(evento) => evento.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={(evento) => selecao.onAlterar([k], evento.target.checked)}
                      aria-label={selecao.rotulo ? selecao.rotulo(linha) : 'Selecionar linha'}
                      className="size-4 cursor-pointer align-middle accent-[var(--fin-accent)]"
                    />
                  </td>
                ) : null}
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
                          estado={coluna.estado?.(linha) ?? 'ok'}
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
              );
            })}
          </tbody>

          {totais && totais.length > 0 ? (
            <tfoot className="bg-[var(--fin-surface-sunken)]">
              {totais.map((total) => (
                <tr key={`${total.colunaId}-${total.rotulo}`} className="border-t-2 border-[var(--fin-border-strong)]">
                  {selecao ? <td aria-hidden="true" className={celulaVariants({ densidade })} /> : null}
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
      {rodape ?? null}
    </Moldura>
  );
}

/** Marca ou desmarca todas as linhas visíveis; meio-marcada quando só algumas. */
function CaixaDoCabecalho<T>({
  linhas,
  chave,
  selecao,
}: {
  linhas: T[];
  chave: (r: T) => string;
  selecao: NonNullable<FinTableProps<T>['selecao']>;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const chaves = linhas.map(chave);
  const marcadas = chaves.filter((k) => selecao.selecionadas.has(k)).length;
  const todas = chaves.length > 0 && marcadas === chaves.length;
  const algumas = marcadas > 0 && !todas;
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = algumas;
  }, [algumas]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todas}
      onChange={() => selecao.onAlterar(chaves, !todas)}
      aria-label={todas ? 'Desmarcar as linhas desta página' : 'Marcar as linhas desta página'}
      className="size-4 cursor-pointer align-middle accent-[var(--fin-accent)]"
    />
  );
}

export default FinTable;
