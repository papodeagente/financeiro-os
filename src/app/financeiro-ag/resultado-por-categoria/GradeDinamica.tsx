'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Money } from '@/components/fin/Money';
import { ROTULO_DO_CAMPO, rotuloDoValor, type CampoDemonstrativo } from '@/lib/resultado-por-categoria';
import { COLUNA_TOTAL, linhasVisiveis, type TabelaDinamica } from '@/lib/tabela-dinamica';
import { cn } from '@/lib/utils';

const CABECALHO = cn(
  'h-9 whitespace-nowrap border-b border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2',
  'fin-t-overline text-[var(--fin-text-3)]',
);
const CELULA = 'px-3 py-1.5 text-right align-middle';
const PRIMEIRA = 'sticky left-0 z-10 bg-[var(--fin-surface)]';
const RECUO = ['pl-3', 'pl-7', 'pl-11', 'pl-[3.75rem]', 'pl-[4.75rem]', 'pl-[5.75rem]', 'pl-[6.75rem]', 'pl-[7.75rem]'];

const rotuloCampo = (c: string) => ROTULO_DO_CAMPO[c as CampoDemonstrativo] ?? c;

/**
 * A grade da tabela dinâmica (05/11/2026). Não usa a FinTable: aqui a linha
 * é hierárquica (pai é subtotal dos filhos), as colunas vêm do cruzamento e a
 * ordem é a da árvore, não ordenável. Valores chegam prontos em centavos; o
 * componente só divide por 100 para mostrar.
 */
export function GradeDinamica({
  tabela, onAbrirCelula,
}: {
  tabela: TabelaDinamica;
  onAbrirCelula: (caminhoLinha: string[] | null, chaveColuna: string | null, titulo: string) => void;
}) {
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  const visiveis = useMemo(() => linhasVisiveis(tabela.linhas, recolhidas), [tabela.linhas, recolhidas]);
  const comColunas = tabela.camposColuna.length > 0;
  const colunas = comColunas ? tabela.colunas : [];
  const niveisDeCabecalho = Math.max(1, tabela.cabecalho.length);
  const temPais = tabela.linhas.some(l => !l.folha);

  function alternar(chave: string) {
    setRecolhidas(atual => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave); else nova.add(chave);
      return nova;
    });
  }

  const nomeDaColuna = (chave: string) => {
    const col = tabela.colunas.find(c => c.chave === chave);
    return col && col.chave !== COLUNA_TOTAL
      ? col.caminho.map((v, i) => rotuloDoValor(tabela.camposColuna[i], v)).join(' › ')
      : 'Total';
  };

  // Despesa já aparece com o sinal; só o resultado (total geral) leva cor,
  // como no DRE.
  function valor(
    centavos: number | undefined, caminho: string[] | null, coluna: string | null, rotuloLinha: string,
    forte = false, resultado = false,
  ) {
    if (centavos === undefined) return <span className="fin-t-caption text-[var(--fin-text-3)]" aria-label="sem lançamento">·</span>;
    const titulo = `${rotuloLinha} · ${coluna ? nomeDaColuna(coluna) : 'Total'}`;
    return (
      <button
        type="button"
        onClick={() => onAbrirCelula(caminho, coluna, titulo)}
        aria-label={`Ver os lançamentos de ${titulo}`}
        className="inline-flex rounded-[var(--fin-r-sm)] hover:underline hover:decoration-[var(--fin-accent)] hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
      >
        <Money
          valor={centavos / 100}
          estado="ok"
          size={forte ? 'strong' : 'body'}
          tone={resultado && centavos < 0 ? 'negativo' : 'neutro'}
        />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      {temPais ? (
        <div className="flex flex-wrap gap-[var(--fin-s-2)]">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRecolhidas(new Set())}>Abrir todos os níveis</Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRecolhidas(new Set(tabela.linhas.filter(l => l.nivel === 0 && !l.folha).map(l => l.chave)))}
          >
            Só o primeiro nível
          </Button>
        </div>
      ) : null}
      <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
        <div
          tabIndex={0}
          role="region"
          aria-label="Resultado por categoria. Rolagem horizontal disponível."
          className="w-full overflow-x-auto rounded-[var(--fin-r-lg)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
        >
          <table data-fin-table className="w-full border-collapse">
            <caption className="sr-only">
              Linhas: {tabela.camposLinha.map(rotuloCampo).join(', ') || 'nenhuma'}. Colunas: {tabela.camposColuna.map(rotuloCampo).join(', ') || 'só o total'}.
            </caption>
            <thead>
              {Array.from({ length: niveisDeCabecalho }).map((_, nivel) => (
                <tr key={nivel}>
                  {nivel === 0 ? (
                    <th scope="col" rowSpan={niveisDeCabecalho} className={cn(CABECALHO, PRIMEIRA, 'z-20 min-w-[260px] pl-4 text-left align-bottom')}>
                      {tabela.camposLinha.map(rotuloCampo).join(' › ') || 'Lançamentos'}
                    </th>
                  ) : null}
                  {comColunas
                    ? tabela.cabecalho[nivel].map(g => (
                      <th
                        key={g.caminho.join('/')}
                        scope="colgroup"
                        colSpan={g.span}
                        className={cn(CABECALHO, 'text-right', nivel < niveisDeCabecalho - 1 && 'border-l border-[var(--fin-border)] text-center')}
                      >
                        {rotuloDoValor(g.campo, g.valor)}
                      </th>
                    ))
                    : null}
                  {nivel === 0 ? (
                    <th scope="col" rowSpan={niveisDeCabecalho} className={cn(CABECALHO, 'min-w-[128px] border-l border-[var(--fin-border)] pr-4 text-right align-bottom')}>
                      Total
                    </th>
                  ) : null}
                </tr>
              ))}
            </thead>
            <tbody>
              {visiveis.map(l => {
                const recolhida = recolhidas.has(l.chave);
                const rotulo = rotuloDoValor(l.campo, l.valor);
                const pai = !l.folha;
                return (
                  <tr
                    key={l.chave}
                    className={cn(
                      'border-b border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
                      pai && l.nivel === 0 && 'bg-[var(--fin-surface-sunken)]',
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        PRIMEIRA, 'py-1.5 pr-3 text-left',
                        RECUO[Math.min(l.nivel, RECUO.length - 1)],
                        pai ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text-2)]',
                        pai && l.nivel === 0 && 'bg-[var(--fin-surface-sunken)]',
                      )}
                    >
                      <span className="flex items-center gap-1">
                        {pai ? (
                          <button
                            type="button"
                            onClick={() => alternar(l.chave)}
                            aria-expanded={!recolhida}
                            aria-label={`${recolhida ? 'Abrir' : 'Recolher'} ${rotulo}`}
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] max-lg:size-9"
                          >
                            {recolhida ? <ChevronRight aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
                          </button>
                        ) : <span aria-hidden="true" className="inline-block size-6 shrink-0" />}
                        <span className="min-w-0 truncate" title={rotulo}>{rotulo}</span>
                        <span className="ml-1 shrink-0 fin-t-caption font-normal text-[var(--fin-text-3)]">{l.quantidade}</span>
                      </span>
                    </th>
                    {colunas.map(c => (
                      <td key={c.chave} className={CELULA}>
                        {valor(l.celulas[c.chave], l.caminho, c.chave, rotulo, pai)}
                      </td>
                    ))}
                    <td className={cn(CELULA, 'border-l border-[var(--fin-border)] pr-4')}>
                      {valor(l.total, l.caminho, null, rotulo, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)]">
                <th scope="row" className={cn(PRIMEIRA, 'bg-[var(--fin-surface-sunken)] py-2 pl-4 pr-3 text-left fin-t-body-strong text-[var(--fin-text)]')}>
                  Total geral
                </th>
                {colunas.map(c => (
                  <td key={c.chave} className={CELULA}>
                    {valor(tabela.totaisPorColuna[c.chave] ?? 0, null, c.chave, 'Total geral', true, true)}
                  </td>
                ))}
                <td className={cn(CELULA, 'border-l border-[var(--fin-border)] pr-4')}>
                  {valor(tabela.totalGeral, null, null, 'Total geral', true, true)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

export default GradeDinamica;
