'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A moldura de todo gráfico do pilar: título, largura medida, estado vazio COM
 * MOTIVO e a tabela alternativa.
 *
 * POR QUE EXISTE. Um bloco que some sem explicação lê como bug; um bloco que
 * desenha zeros lê como fracasso. Nenhum dos dois pode acontecer, e a diferença
 * entre "nunca houve venda", "o filtro não achou", "ainda faltam meses para
 * comparar" e "não consegui carregar" é a diferença entre o usuário confiar e
 * o usuário ligar para o suporte.
 *
 * A moldura também é quem entrega a LARGURA EM PIXEL REAL para o filho. Regra
 * mecânica dos seis gráficos: coordenada em pixel real e viewBox="0 0 W H".
 * preserveAspectRatio="none" é proibido — ele distorce o raio de 4px, o respiro
 * de 2px e a espessura do traço de uma vez só.
 */

export type MotivoDoVazio = 'sem-dado' | 'sem-resultado' | 'insuficiente' | 'erro';

export type TabelaDoGraficoDados = {
  colunas: string[];
  /** Mesmos valores e mesmos rótulos humanos do desenho. Nunca um resumo. */
  linhas: string[][];
};

export type GraficoMolduraProps = {
  titulo: string;
  sublinha?: string;
  estado: 'ok' | MotivoDoVazio;
  vazio?: { frase: string; acao?: { rotulo: string; href?: string; onClick?: () => void } };
  /** A leitura do gráfico em UMA frase. Vira o <desc> do SVG. */
  descricao: string;
  tabela: TabelaDoGraficoDados;
  /** ReactNode, ou função que recebe a largura medida em px. */
  children: React.ReactNode | ((largura: number) => React.ReactNode);
  className?: string;
};

type ContextoDaMoldura = {
  /** Largura do contêiner em px reais. 0 antes da primeira medição. */
  largura: number;
  /** O contêiner posicionado — destino do balão da CamadaDeToque. */
  container: HTMLDivElement | null;
  /** Id da tabela alternativa, para o aria-describedby do <svg>. */
  idDaTabela: string;
  descricao: string;
  titulo: string;
};

const Contexto = React.createContext<ContextoDaMoldura>({
  largura: 0,
  container: null,
  idDaTabela: '',
  descricao: '',
  titulo: '',
});

/** Lido pelos gráficos e pela CamadaDeToque. Nunca calcule escala fora daqui. */
export function useMolduraDoGrafico(): ContextoDaMoldura {
  return React.useContext(Contexto);
}

/**
 * Mede a largura real e publica contêiner + largura no contexto.
 *
 * Todo gráfico do pilar se embrulha nela. Dentro da GraficoMoldura ela herda o
 * id da tabela e a descrição; fora (no slot `marca` da Resposta, por exemplo)
 * ela funciona sozinha — é o que garante que o balão da CamadaDeToque tenha
 * sempre um contêiner posicionado para onde ir.
 */
export function AreaDeGrafico({
  children,
  className,
}: {
  children: React.ReactNode | ((largura: number) => React.ReactNode);
  className?: string;
}) {
  const herdado = React.useContext(Contexto);
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [largura, setLargura] = React.useState(0);

  React.useEffect(() => {
    if (!container) return;
    // ResizeObserver e não window.resize: o gráfico também muda de largura
    // quando uma coluna irmã abre ou o menu lateral recolhe.
    const observador = new ResizeObserver(entradas => {
      setLargura(Math.max(0, Math.round(entradas[0]?.contentRect.width ?? 0)));
    });
    observador.observe(container);
    setLargura(Math.max(0, Math.round(container.getBoundingClientRect().width)));
    return () => observador.disconnect();
  }, [container]);

  const valor = React.useMemo<ContextoDaMoldura>(
    () => ({ ...herdado, largura, container }),
    [herdado, largura, container],
  );

  return (
    <Contexto.Provider value={valor}>
      <div ref={setContainer} className={cn('relative w-full', className)}>
        {largura > 0 ? (
          typeof children === 'function' ? children(largura) : children
        ) : (
          // Antes da primeira medição não há escala: desenhar aqui seria
          // inventar largura e provocar um salto visível a cada montagem.
          <div className="h-[120px]" aria-hidden="true" />
        )}
      </div>
    </Contexto.Provider>
  );
}

const FRASE_PADRAO: Record<MotivoDoVazio, string> = {
  'sem-dado': 'Ainda não há dados para este período.',
  'sem-resultado': 'Nenhum resultado com os filtros atuais.',
  insuficiente: 'Faltam períodos com movimento para esta comparação nascer.',
  erro: 'Não foi possível carregar estes dados.',
};

export function VazioDoGrafico({
  motivo,
  frase,
  acao,
}: {
  motivo: MotivoDoVazio;
  frase?: string;
  acao?: { rotulo: string; href?: string; onClick?: () => void };
}) {
  return (
    <div
      data-fin-vazio={motivo}
      role={motivo === 'erro' ? 'alert' : undefined}
      className="flex min-h-[120px] flex-col items-start justify-center gap-3 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-4 py-5"
    >
      <p className="fin-t-body text-[var(--fin-text-2)]">{frase || FRASE_PADRAO[motivo]}</p>
      {acao ? (
        acao.href ? (
          <a
            href={acao.href}
            className="fin-t-body-strong inline-flex h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]"
          >
            {acao.rotulo}
          </a>
        ) : (
          <button
            type="button"
            onClick={acao.onClick}
            className="fin-t-body-strong inline-flex h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]"
          >
            {acao.rotulo}
          </button>
        )
      ) : null}
    </div>
  );
}

export function TabelaDoGrafico({
  id,
  legenda,
  dados,
  aberta,
}: {
  id: string;
  legenda: string;
  dados: TabelaDoGraficoDados;
  aberta: boolean;
}) {
  return (
    // No papel o gráfico some e esta tabela aparece: a rampa de um matiz só
    // colapsa em cinzas iguais quando a impressão força o fundo branco.
    <div className={cn('fin-grafico-tabela mt-4 overflow-x-auto', !aberta && 'hidden')}>
      <table id={id} data-fin-table className="w-full border-collapse">
        <caption className="fin-t-caption pb-2 text-left text-[var(--fin-text-3)]">{legenda}</caption>
        <thead>
          <tr>
            {dados.colunas.map((coluna, i) => (
              <th
                key={coluna}
                scope="col"
                className={cn(
                  'fin-t-caption border-b border-[var(--fin-border)] py-2 font-semibold text-[var(--fin-text-3)]',
                  i === 0 ? 'text-left' : 'text-right',
                )}
              >
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.linhas.map(linha => (
            <tr key={linha.join('|')}>
              {linha.map((celula, i) => (
                <td
                  key={`${i}-${celula}`}
                  className={cn(
                    'fin-t-body border-b border-[var(--fin-border)] py-2 text-[var(--fin-text)]',
                    i === 0 ? 'text-left' : 'text-right tabular-nums',
                  )}
                >
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GraficoMoldura({
  titulo,
  sublinha,
  estado,
  vazio,
  descricao,
  tabela,
  children,
  className,
}: GraficoMolduraProps) {
  const idDaTabela = React.useId();
  const [tabelaAberta, setTabelaAberta] = React.useState(false);

  const contexto = React.useMemo<ContextoDaMoldura>(
    () => ({ largura: 0, container: null, idDaTabela, descricao, titulo }),
    [idDaTabela, descricao, titulo],
  );

  const desenha = estado === 'ok';

  return (
    <section
      data-fin-grafico={estado}
      className={cn('flex flex-col rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h3>
          {sublinha ? <p className="fin-t-caption text-[var(--fin-text-3)]">{sublinha}</p> : null}
        </div>
        {desenha && tabela.linhas.length > 0 ? (
          <button
            type="button"
            aria-expanded={tabelaAberta}
            aria-controls={idDaTabela}
            onClick={() => setTabelaAberta(v => !v)}
            // Visível de propósito: a alternativa à leitura visual não pode
            // morar num <summary> cinza que ninguém enxerga.
            className="fin-no-print fin-t-body inline-flex h-11 shrink-0 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 text-[var(--fin-text-2)] transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
          >
            {tabelaAberta ? 'Ocultar números' : 'Ver os números'}
          </button>
        ) : null}
      </div>

      <Contexto.Provider value={contexto}>
        {desenha ? (
          <AreaDeGrafico className="fin-no-print mt-3">{children}</AreaDeGrafico>
        ) : (
          <div className="mt-3">
            <VazioDoGrafico motivo={estado} frase={vazio?.frase} acao={vazio?.acao} />
          </div>
        )}
      </Contexto.Provider>

      {desenha && tabela.linhas.length > 0 ? (
        <TabelaDoGrafico id={idDaTabela} legenda={descricao} dados={tabela} aberta={tabelaAberta} />
      ) : null}
    </section>
  );
}

export default GraficoMoldura;
