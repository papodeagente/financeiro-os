'use client';

import { Info } from 'lucide-react';

import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { SEM_CENTRO, SEM_TAG, type DimensaoDoFluxo, type FluxoPorDimensao, type LinhaDoFluxoPorDimensao } from '@/lib/resultado-por-dimensao';

/**
 * Fluxo de caixa por centro de custo ou por tag (E7, frente C): o que entrou
 * e saiu (realizado, pela data da baixa) e o que ainda vai entrar e sair
 * (previsto, pelo vencimento) em cada um, no período do caderno.
 */
export function PorDimensao({ fluxo, dimensao, rotuloPeriodo }: {
  fluxo: FluxoPorDimensao;
  dimensao: DimensaoDoFluxo;
  rotuloPeriodo: string;
}) {
  const sem = dimensao === 'centro' ? SEM_CENTRO : SEM_TAG;
  const colunas: FinColuna<LinhaDoFluxoPorDimensao>[] = [
    {
      id: 'nome', cabecalho: dimensao === 'centro' ? 'Centro de custo' : 'Tag', tipo: 'texto', minWidth: 180,
      render: l => (
        <span
          className={l.chave === sem ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-text)]'}
          style={l.nivel ? { paddingLeft: `calc(var(--fin-s-4) * ${l.nivel})` } : undefined}
        >
          {l.rotulo}
        </span>
      ),
    },
    { id: 'entrou', cabecalho: 'Entrou', tipo: 'dinheiro', minWidth: 112, valor: l => l.entrou, tone: l => (l.entrou > 0 ? 'positivo' : 'neutro') },
    { id: 'saiu', cabecalho: 'Saiu', tipo: 'dinheiro', minWidth: 112, valor: l => l.saiu },
    { id: 'a_entrar', cabecalho: 'A entrar', tipo: 'dinheiro', minWidth: 112, prioridade: 2, valor: l => l.a_entrar },
    { id: 'a_sair', cabecalho: 'A sair', tipo: 'dinheiro', minWidth: 112, prioridade: 2, valor: l => l.a_sair },
    {
      id: 'resultado', cabecalho: 'Resultado', tipo: 'dinheiro', minWidth: 120, valor: l => l.resultado,
      tone: l => (l.resultado < 0 ? 'negativo' : 'neutro'),
    },
  ];
  const t = fluxo.totais;
  const rotuloTotal = dimensao === 'tag' ? 'Total (cada conta uma vez)' : 'Total';
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="border-y border-[var(--fin-border)]">
        <FinTable<LinhaDoFluxoPorDimensao>
          linhas={fluxo.linhas}
          colunas={colunas}
          chave={l => l.chave}
          densidade="compacta"
          estado="ok"
          vazio={{
            motivo: 'sem-resultado',
            titulo: `Nada entra nem sai em ${rotuloPeriodo} neste recorte`,
            oQueE: 'Troque o período ou limpe o filtro de centro de custo e tag.',
          }}
          totais={fluxo.linhas.length ? [
            { colunaId: 'entrou', valor: t.entrou, rotulo: rotuloTotal },
            { colunaId: 'saiu', valor: t.saiu, rotulo: rotuloTotal },
            { colunaId: 'a_entrar', valor: t.a_entrar, rotulo: rotuloTotal },
            { colunaId: 'a_sair', valor: t.a_sair, rotulo: rotuloTotal },
            { colunaId: 'resultado', valor: t.resultado, rotulo: rotuloTotal },
          ] : undefined}
        />
      </div>
      <p className="flex items-start gap-[var(--fin-s-2)] px-[var(--fin-s-4)] fin-t-caption text-[var(--fin-text-2)] sm:px-[var(--fin-s-5)]">
        <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[var(--fin-text-3)]" />
        <span>
          {dimensao === 'centro'
            ? 'Conta rateada entra com a parte de cada centro. Cada linha mostra só o que foi lançado no próprio centro; o centro de cima não soma os de baixo.'
            : fluxo.com_varias_tags > 0
              ? `${fluxo.com_varias_tags === 1 ? '1 conta tem' : `${fluxo.com_varias_tags} contas têm`} mais de uma tag e aparece${fluxo.com_varias_tags === 1 ? '' : 'm'} em cada uma. O total conta cada conta uma vez.`
              : 'Conta com mais de uma tag aparece em cada uma; o total conta cada conta uma vez.'}
          {' '}Vencido e em aberto conta como a entrar ou a sair hoje, como no caderno.
        </span>
      </p>
    </div>
  );
}
