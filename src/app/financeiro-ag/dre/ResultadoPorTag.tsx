'use client';

import { Info } from 'lucide-react';

import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import type { LinhaPorTag, ResultadoPorTag as Resultado } from '@/lib/resultado-por-dimensao';

/**
 * DRE agrupado por tag (E7, frente C): o que entrou e saiu nos títulos de
 * cada tag, no mesmo período, regime e recorte do demonstrativo.
 */
export function ResultadoPorTag({ resultado, rotuloPeriodo, regime }: {
  resultado: Resultado;
  rotuloPeriodo: string;
  regime: 'competencia' | 'caixa';
}) {
  const colunas: FinColuna<LinhaPorTag>[] = [
    {
      id: 'tag', cabecalho: 'Tag', tipo: 'texto', minWidth: 160,
      render: l => (
        <span className={l.chave === '__sem_tag' ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-text)]'}>{l.rotulo}</span>
      ),
    },
    { id: 'titulos', cabecalho: 'Títulos', tipo: 'texto', minWidth: 80, prioridade: 1, render: l => <span className="tabular-nums">{l.titulos}</span> },
    { id: 'entradas', cabecalho: regime === 'caixa' ? 'Recebido' : 'A receber', tipo: 'dinheiro', minWidth: 120, valor: l => l.entradas },
    { id: 'saidas', cabecalho: regime === 'caixa' ? 'Pago' : 'A pagar', tipo: 'dinheiro', minWidth: 120, valor: l => l.saidas },
    {
      id: 'resultado', cabecalho: 'Resultado', tipo: 'dinheiro', minWidth: 120, valor: l => l.resultado,
      tone: l => (l.resultado < 0 ? 'negativo' : 'neutro'),
    },
  ];
  const { totais } = resultado;
  return (
    <section aria-labelledby="t-dre-por-tag" className="space-y-[var(--fin-s-3)]">
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-dre-por-tag" className="fin-t-subhead text-[var(--fin-text)]">Por tag</h2>
        <p className="max-w-[72ch] fin-t-caption text-[var(--fin-text-3)]">
          Contas a receber e a pagar de {rotuloPeriodo} com cada tag,
          {regime === 'caixa' ? ' pelo que entrou e saiu na data da baixa.' : ' pelo valor e pelo vencimento.'}
          {' '}São os títulos lançados, com os repasses ao fornecedor: o demonstrativo acima continua sendo a receita da agência.
        </p>
      </div>
      <FinTable<LinhaPorTag>
        linhas={resultado.linhas}
        colunas={colunas}
        chave={l => l.chave}
        densidade="compacta"
        estado="ok"
        vazio={{
          motivo: 'sem-resultado',
          titulo: 'Nenhum título com tag neste período',
          oQueE: 'Marque tags nas contas a pagar e a receber para ver o resultado de cada uma aqui.',
        }}
        totais={resultado.linhas.length ? [
          { colunaId: 'entradas', valor: totais.entradas, rotulo: 'Total dos títulos' },
          { colunaId: 'saidas', valor: totais.saidas, rotulo: 'Total dos títulos' },
          { colunaId: 'resultado', valor: totais.resultado, rotulo: 'Total dos títulos' },
        ] : undefined}
      />
      {resultado.com_varias_tags > 0 ? (
        <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[var(--fin-text-3)]" />
          {resultado.com_varias_tags === 1
            ? '1 título tem mais de uma tag e aparece em cada uma delas. O total conta cada título uma vez só.'
            : `${resultado.com_varias_tags} títulos têm mais de uma tag e aparecem em cada uma delas. O total conta cada título uma vez só.`}
        </p>
      ) : null}
    </section>
  );
}
