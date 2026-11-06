'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookA } from 'lucide-react';

import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import {
  GLOSSARIO, ROTULO_DO_ASSUNTO, buscarNoGlossario, type AssuntoDoGlossario, type TermoDoGlossario,
} from '@/lib/migracao/telas/glossario';
import { rotuloDaEntrega } from '@/lib/migracao/telas/paridade';

const TODOS = 'todos';

/**
 * Glossário da mudança (E4, 05/11/2026): o nome que a pessoa trazia do
 * sistema anterior e onde aquilo fica aqui, com uma frase quando funciona
 * diferente. Só termos de mercado. Duplo clique (ou Enter) abre a tela.
 */
export function TelaDoGlossario() {
  const router = useRouter();
  const [busca, setBusca] = React.useState('');
  const [assunto, setAssunto] = React.useState<AssuntoDoGlossario | typeof TODOS>(TODOS);

  const base = busca.trim().length >= 2 ? buscarNoGlossario(busca) : [...GLOSSARIO];
  const linhas = base.filter(t => assunto === TODOS || t.assunto === assunto);
  const ativos = (busca ? 1 : 0) + (assunto !== TODOS ? 1 : 0);
  const limpar = () => { setBusca(''); setAssunto(TODOS); };

  const colunas: FinColuna<TermoDoGlossario>[] = [
    {
      id: 'la', cabecalho: 'Como chamava lá', tipo: 'texto', minWidth: 220, sortable: true, acessor: t => t.la[0].toLowerCase(),
      render: t => (
        <span className="flex min-w-0 flex-col">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{t.la[0]}</span>
          {t.la.length > 1 ? <span className="fin-t-caption text-[var(--fin-text-3)]">também {t.la.slice(1).join(', ')}</span> : null}
        </span>
      ),
    },
    {
      id: 'aqui', cabecalho: 'Como chama aqui', tipo: 'texto', minWidth: 240, sortable: true, acessor: t => t.aqui.toLowerCase(),
      render: t => (
        <span className="flex min-w-0 items-start gap-[var(--fin-s-2)]">
          <ArrowRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[var(--fin-text-3)]" />
          <span className="flex min-w-0 flex-col">
            {t.href
              ? <Link href={t.href} className="fin-t-body-strong text-[var(--fin-accent)] underline-offset-2 hover:underline">{t.aqui}</Link>
              : <span className="fin-t-body-strong text-[var(--fin-text)]">{t.aqui}</span>}
            {t.chega ? <span className="fin-t-caption text-[var(--fin-warning-text)]">Ainda vem: {rotuloDaEntrega(t.chega)}</span> : null}
          </span>
        </span>
      ),
    },
    {
      id: 'diferenca', cabecalho: 'O que muda', tipo: 'texto', minWidth: 260, prioridade: 2,
      render: t => <span className="block max-w-[56ch] fin-t-body text-[var(--fin-text-2)]">{t.diferenca ?? 'Funciona igual.'}</span>,
    },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={BookA}
        titulo="Glossário da mudança"
        subtitulo="O nome que você usava no sistema anterior e onde aquilo fica aqui. Quando funciona diferente, uma frase explica."
        acoesSecundarias={[
          { rotulo: 'Checklist de paridade', href: '/mudanca/paridade' },
          { rotulo: 'Mudar para o EnturOS', href: '/mudanca' },
        ]}
      />

      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: 'Digite o nome que você usava…' }}
        selects={[{
          id: 'glossario-assunto', rotulo: 'Assunto', valor: assunto, onChange: v => setAssunto(v as AssuntoDoGlossario | typeof TODOS),
          opcoes: [{ valor: TODOS, rotulo: 'Todos' }, ...(Object.keys(ROTULO_DO_ASSUNTO) as AssuntoDoGlossario[]).map(a => ({ valor: a, rotulo: ROTULO_DO_ASSUNTO[a] }))],
        }]}
        resumo={{ exibidos: linhas.length, total: GLOSSARIO.length, substantivo: GLOSSARIO.length === 1 ? 'termo' : 'termos' }}
        ativos={ativos}
        onLimpar={limpar}
      />

      <FinTable<TermoDoGlossario>
        linhas={linhas}
        colunas={colunas}
        chave={t => t.id}
        densidade="compacta"
        estado="ok"
        onLinhaDuploClique={t => { if (t.href) router.push(t.href); }}
        vazio={{
          motivo: 'sem-resultado',
          titulo: 'Nenhum termo com esse nome',
          oQueE: 'Tente outra palavra, ou procure pela tela na busca do topo (⌘K): ela também entende os nomes de mercado.',
          acaoSecundaria: { rotulo: 'Limpar a busca', onClick: limpar },
        }}
      />
    </MolduraDaPagina>
  );
}
