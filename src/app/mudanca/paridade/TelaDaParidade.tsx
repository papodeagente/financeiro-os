'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Clock, LayoutList, ListChecks, Milestone } from 'lucide-react';

import { FilterBar } from '@/components/fin/FilterBar';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { StatusChip } from '@/components/fin/StatusChip';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import {
  ENTREGA_NO_AR, montarChecklist, rotuloDaEntrega, type BlocoMontado, type SituacaoDoBloco,
} from '@/lib/migracao/telas/paridade';
import { cn } from '@/lib/utils';

const TODOS = 'todos';

/**
 * Checklist de paridade (E4, 05/11/2026): tudo o que a agência fazia no
 * sistema anterior, nos 15 blocos do plano. O que já existe leva à tela;
 * o que ainda vem diz em qual entrega. Montado por `montarChecklist`, não
 * escrito à mão: quando uma entrega publica, a lista se refaz sozinha.
 */
export function TelaDaParidade() {
  const checklist = React.useMemo(() => montarChecklist(), []);
  const [situacao, setSituacao] = React.useState<SituacaoDoBloco | typeof TODOS>(TODOS);
  const [busca, setBusca] = React.useState('');

  const q = busca.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const casa = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q);
  const blocos = checklist.blocos.filter(b =>
    (situacao === TODOS || b.situacao === situacao) && (!q || casa(b.titulo) || b.itens.some(i => casa(i.rotulo))));
  const proxima = checklist.porEntrega[0];
  const limpar = () => { setSituacao(TODOS); setBusca(''); };

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={ListChecks}
        titulo="Checklist de paridade"
        subtitulo="Tudo o que a agência fazia no sistema anterior, bloco a bloco: o que já existe aqui e onde fica, e o que ainda vem e quando."
        acoesSecundarias={[
          { rotulo: 'Glossário', href: '/mudanca/glossario' },
          { rotulo: 'Mudar para o EnturOS', href: '/mudanca' },
        ]}
      />

      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
        <MetricCard
          rotulo="Já existe aqui" icone={Check} valor={checklist.itensProntos} formato="contagem" estado="ok" tomDoIcone="positivo"
          contexto={`de ${checklist.itensTotal} itens, até a ${ENTREGA_NO_AR}.`}
        />
        <MetricCard
          rotulo="Blocos completos" icone={LayoutList} valor={checklist.blocosProntos} formato="contagem" estado="ok"
          contexto={`de ${checklist.blocos.length} blocos; os outros já têm parte pronta ou chegam depois.`}
        />
        <MetricCard
          rotulo="Na próxima entrega" icone={Milestone} valor={proxima?.itens ?? 0} formato="contagem" estado="ok" tomDoIcone="aviso"
          contexto={proxima ? `itens chegam na ${rotuloDaEntrega(proxima.entrega)}.` : 'Nada mais a chegar.'}
        />
      </div>

      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: 'Pesquisar o que a agência faz…' }}
        selects={[{
          id: 'paridade-situacao', rotulo: 'Situação', valor: situacao, onChange: v => setSituacao(v as SituacaoDoBloco | typeof TODOS),
          opcoes: [
            { valor: TODOS, rotulo: 'Todos os blocos' }, { valor: 'pronto', rotulo: 'Completos' },
            { valor: 'parcial', rotulo: 'Em parte' }, { valor: 'vem', rotulo: 'Ainda vêm' },
          ],
        }]}
        resumo={{ exibidos: blocos.length, total: checklist.blocos.length, substantivo: 'blocos' }}
        ativos={(situacao !== TODOS ? 1 : 0) + (q ? 1 : 0)}
        onLimpar={limpar}
      />

      {blocos.length ? (
        <ol className="grid grid-cols-1 gap-[var(--fin-s-4)] xl:grid-cols-2">
          {blocos.map(b => <BlocoDoChecklist key={b.numero} bloco={b} />)}
        </ol>
      ) : (
        <EmptyLesson
          motivo="sem-resultado"
          titulo="Nenhum bloco neste filtro"
          oQueE="O checklist continua inteiro; o recorte é que não achou nada."
          acaoSecundaria={{ rotulo: 'Limpar filtros', onClick: limpar }}
        />
      )}
    </MolduraDaPagina>
  );
}

function BlocoDoChecklist({ bloco }: { bloco: BlocoMontado }) {
  const id = `bloco-${bloco.numero}`;
  return (
    <li aria-labelledby={id} className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] shadow-[var(--fin-e-card)]">
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="flex items-baseline gap-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">
            {/* O número é o do mapa do plano: é por ele que o bloco é citado. */}
            <span className="fin-t-body tabular-nums text-[var(--fin-text-3)]">{bloco.numero}.</span>
            {bloco.titulo}
          </h2>
          <p className="fin-t-caption text-[var(--fin-text-2)]">{bloco.resumo}</p>
        </div>
        <StatusChip valor={bloco.situacao} dominio="mudanca" dot />
      </div>

      <ul className="flex flex-col">
        {bloco.itens.map(i => (
          <li key={i.rotulo} className="flex items-start gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] py-[var(--fin-s-2)] first:border-0">
            {i.pronto
              ? <Check aria-label="Já existe" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />
              : <Clock aria-label="Ainda vem" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-[var(--fin-s-3)]">
              <span className={cn('fin-t-body', i.pronto ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-2)]')}>{i.rotulo}</span>
              {i.pronto && i.href ? (
                <Link
                  href={i.href}
                  className="inline-flex shrink-0 items-center gap-0.5 fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline max-lg:min-h-11 max-lg:items-center"
                >
                  Abrir <ArrowUpRight aria-hidden="true" className="size-3" />
                  <span className="sr-only">: {i.rotulo}</span>
                </Link>
              ) : (
                <span className="shrink-0 fin-t-caption text-[var(--fin-text-3)]">{i.pronto ? rotuloDaEntrega(i.entrega) : `Chega na ${rotuloDaEntrega(i.entrega)}`}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
