'use client';

/**
 * Relatórios por categoria, por centro de custo e por rateio (05/11/2026).
 *
 * Os filtros, colunas e totais que o mercado usa, com o que costuma faltar: regime de caixa proporcional ao pago (Data de = Movimentação), centro
 * em árvore, agrupar e ordenar, tags, planilha segura e clique para abrir o
 * lançamento. O servidor filtra e pagina: a tela recebe só a página.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, type LucideIcon } from 'lucide-react';

import type { CentroCusto, PlanoContas } from '@/lib/crm-types';
import type { RespostaLancamentos } from '@/lib/lancamentos-por-dimensao-servidor';
import {
  ROTULO_AGRUPAR, ROTULO_DATA_DE, ROTULO_EM, ROTULO_SITUACAO,
  type Agrupar, type CampoPesquisa, type DataDe, type LinhaLancamento, type Situacao, type TipoFiltro, type Visao,
} from '@/lib/lancamentos-por-dimensao';
import { ordenarEmArvore } from '@/lib/dimensoes';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Money } from '@/components/fin/Money';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { resolverPeriodo, type PeriodoChave } from '@/components/fin/PeriodPicker';
import { statusChipVariants } from '@/components/fin/StatusChip';
import { Interruptor } from '@/app/financeiro-ag/pagar/campos';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

const TITULO: Record<Visao, string> = {
  categoria: 'Por categoria',
  centro: 'Por centro de custo',
  rateio: 'Por rateio',
};
const SUBTITULO: Record<Visao, string> = {
  categoria: 'Cada conta a pagar e a receber separada pelas suas categorias, com grupo, pessoa e conta.',
  centro: 'Quanto de cada lançamento ficou em cada centro de custo, com o percentual e o valor do centro.',
  rateio: 'As contas divididas entre centros e categorias, linha por linha do rateio.',
};
const ROTA: Record<Visao, string> = {
  categoria: '/financeiro-ag/relatorios/lancamentos-categoria',
  centro: '/financeiro-ag/relatorios/lancamentos-centro-custo',
  rateio: '/financeiro-ag/relatorios/lancamentos-rateio',
};

const TOM_SITUACAO: Record<Exclude<Situacao, 'TODAS'>, 'neutro' | 'positivo' | 'negativo' | 'aviso'> = {
  EM_ABERTO: 'neutro',
  EM_ATRASO: 'negativo',
  LIQUIDADO: 'positivo',
  EXCLUIDO: 'neutro',
};

const ORDENS: Array<{ valor: string; rotulo: string }> = [
  { valor: ':asc', rotulo: 'Pela data, mais antiga primeiro' },
  { valor: ':desc', rotulo: 'Pela data, mais recente primeiro' },
  { valor: 'valor:desc', rotulo: 'Maior valor primeiro' },
  { valor: 'valor:asc', rotulo: 'Menor valor primeiro' },
  { valor: 'pessoa:asc', rotulo: 'Pela pessoa, de A a Z' },
  { valor: 'categoria:asc', rotulo: 'Pela categoria' },
  { valor: 'centro:asc', rotulo: 'Pelo centro de custo' },
  { valor: 'descricao:asc', rotulo: 'Pela descrição' },
];

type Filtros = {
  periodo: PeriodoChave;
  de: string;
  ate: string;
  data_de: DataDe;
  situacao: Situacao;
  tipo: TipoFiltro;
  incluir_repasse: boolean;
  centro_custo_id: string;
  categoria_id: string;
  pesquisar: string;
  em: CampoPesquisa;
  agrupar: Agrupar;
  ordem: string;
  pagina: number;
};

const TODOS = '__TODOS__';

function filtrosIniciais(): Filtros {
  const r = resolverPeriodo('MES_ATUAL');
  return {
    periodo: 'MES_ATUAL', de: r.de, ate: r.ate, data_de: 'VENCIMENTO', situacao: 'TODAS', tipo: 'TODOS',
    incluir_repasse: false, centro_custo_id: '', categoria_id: '', pesquisar: '', em: 'TUDO', agrupar: '',
    ordem: ':asc', pagina: 1,
  };
}

function parametros(visao: Visao, f: Filtros): URLSearchParams {
  const [ordenar, direcao] = f.ordem.split(':');
  const p = new URLSearchParams({
    visao, data_de: f.data_de, de: f.de || '1900-01-01', ate: f.ate || '2999-12-31', situacao: f.situacao,
    tipo: f.tipo, em: f.em, pagina: String(f.pagina), por_pagina: '50', direcao: direcao || 'asc',
  });
  if (ordenar) p.set('ordenar', ordenar);
  if (f.incluir_repasse) p.set('incluir_repasse', '1');
  if (f.centro_custo_id) p.set('centro_custo_id', f.centro_custo_id);
  if (f.categoria_id) p.set('categoria_id', f.categoria_id);
  if (f.pesquisar.trim()) p.set('pesquisar', f.pesquisar.trim());
  if (f.agrupar) p.set('agrupar', f.agrupar);
  return p;
}

function Situacao({ s }: { s: Exclude<Situacao, 'TODAS'> }) {
  return <span className={statusChipVariants({ tone: TOM_SITUACAO[s] })}>{ROTULO_SITUACAO[s]}</span>;
}

const texto = (v: string, classe = 'fin-t-body text-[var(--fin-text-2)]') => <span className={classe}>{v || '—'}</span>;

function colunasDa(visao: Visao, regime: 'caixa' | 'competencia'): FinColuna<LinhaLancamento>[] {
  const datas: FinColuna<LinhaLancamento>[] = [
    { id: 'emissao', cabecalho: 'Emissão', tipo: 'data', prioridade: 1, valor: l => l.emissao || null },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', valor: l => l.vencimento || null },
    { id: 'liquidacao', cabecalho: 'Liquidação', tipo: 'data', prioridade: 1, valor: l => l.liquidacao || null },
    { id: 'movimentacao', cabecalho: 'Movimentação', tipo: 'data', prioridade: 2, valor: l => l.movimentacao || null },
  ];
  const pessoa: FinColuna<LinhaLancamento> = {
    id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', minWidth: 160,
    render: l => (
      <span className="flex flex-col">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{l.pessoa || '—'}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]"><Situacao s={l.situacao} /></span>
      </span>
    ),
  };
  const descricao: FinColuna<LinhaLancamento> = {
    id: 'descricao', cabecalho: 'Descrição', tipo: 'texto', minWidth: 200, prioridade: 2,
    render: l => (
      <span className="flex flex-col gap-1">
        {texto(l.descricao)}
        {l.tags.length ? <span className="fin-t-caption text-[var(--fin-text-3)]">{l.tags.join(' · ')}</span> : null}
      </span>
    ),
  };
  const conta: FinColuna<LinhaLancamento> = { id: 'conta', cabecalho: 'Conta', tipo: 'texto', minWidth: 120, prioridade: 1, render: l => texto(l.conta_bancaria) };
  const tipo: FinColuna<LinhaLancamento> = { id: 'tipo', cabecalho: 'Tipo', tipo: 'texto', minWidth: 88, render: l => texto(l.tipo) };
  const categoria: FinColuna<LinhaLancamento> = {
    id: 'categoria', cabecalho: 'Categoria', tipo: 'texto', minWidth: 180,
    render: l => (
      <span className="flex items-baseline gap-[var(--fin-s-2)]">
        {l.categoria_codigo ? <span className="fin-t-code text-[var(--fin-text-3)]">{l.categoria_codigo}</span> : null}
        <span className="fin-t-body text-[var(--fin-text)]">{l.categoria_nome || 'Sem categoria'}</span>
        {l.repasse ? <span className={statusChipVariants({ tone: 'neutro' })}>Repasse</span> : null}
      </span>
    ),
  };
  const centro: FinColuna<LinhaLancamento> = { id: 'centro', cabecalho: 'Centro de custo', tipo: 'texto', minWidth: 160, render: l => texto(l.centro_custo_nome, 'fin-t-body text-[var(--fin-text)]') };
  const pct = (cab: string): FinColuna<LinhaLancamento> => ({
    id: 'percentual', cabecalho: cab, tipo: 'texto', minWidth: 72,
    render: l => <span className="fin-t-body block text-right tabular-nums text-[var(--fin-text-2)]">{l.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>,
  });
  const valorCaixa = regime === 'caixa' ? ' (pago)' : '';

  if (visao === 'categoria') {
    return [
      { id: 'numero', cabecalho: 'Número', tipo: 'texto', minWidth: 72, prioridade: 1, render: l => texto(l.numero, 'fin-t-code text-[var(--fin-text-3)]') },
      { id: 'venda', cabecalho: 'Nº da venda', tipo: 'texto', minWidth: 80, prioridade: 1, render: l => texto(l.venda_numero, 'fin-t-code text-[var(--fin-text-3)]') },
      ...datas, pessoa,
      { id: 'moeda', cabecalho: 'Moeda', tipo: 'texto', minWidth: 64, prioridade: 1, render: l => texto(l.moeda, 'fin-t-caption text-[var(--fin-text-3)]') },
      { id: 'valor', cabecalho: `Valor${valorCaixa}`, tipo: 'dinheiro', valor: l => l.valor, tone: l => (l.lado === 'pagar' ? 'negativo' : 'positivo') },
      { id: 'grupo', cabecalho: 'Grupo', tipo: 'texto', minWidth: 160, prioridade: 2, render: l => texto(l.grupo_nome) },
      categoria, tipo, descricao,
      { id: 'documento', cabecalho: 'Documento', tipo: 'texto', minWidth: 110, prioridade: 1, render: l => texto(l.documento, 'fin-t-code text-[var(--fin-text-3)]') },
      conta,
    ];
  }
  if (visao === 'centro') {
    return [
      { id: 'numero', cabecalho: 'Número', tipo: 'texto', minWidth: 72, prioridade: 1, render: l => texto(l.numero, 'fin-t-code text-[var(--fin-text-3)]') },
      ...datas, pessoa, descricao, centro,
      { id: 'valor_lancamento', cabecalho: 'Valor do lançamento', tipo: 'dinheiro', prioridade: 2, valor: l => l.valor_lancamento },
      { id: 'valor_movimentacao', cabecalho: 'Pago/recebido', tipo: 'dinheiro', prioridade: 1, valor: l => l.valor_movimentacao },
      pct('% no centro'),
      { id: 'valor', cabecalho: `Valor no centro${valorCaixa}`, tipo: 'dinheiro', valor: l => l.valor, tone: l => (l.lado === 'pagar' ? 'negativo' : 'positivo') },
      tipo, conta,
    ];
  }
  return [
    tipo, ...datas, pessoa, descricao, conta, centro, categoria,
    { id: 'valor_lancamento', cabecalho: 'Valor do lançamento', tipo: 'dinheiro', prioridade: 2, valor: l => l.valor_lancamento },
    pct('% da parte'),
    { id: 'valor', cabecalho: `Valor da parte${valorCaixa}`, tipo: 'dinheiro', valor: l => l.valor, tone: l => (l.lado === 'pagar' ? 'negativo' : 'positivo') },
    { id: 'valor_movimentacao', cabecalho: 'Pago/recebido', tipo: 'dinheiro', prioridade: 1, valor: l => l.valor_movimentacao },
  ];
}

export function RelatorioLancamentos({ visao, icone }: { visao: Visao; icone: LucideIcon }) {
  const router = useRouter();
  const [f, setF] = React.useState<Filtros>(filtrosIniciais);
  const [busca, setBusca] = React.useState('');
  const [dados, setDados] = React.useState<RespostaLancamentos | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [exportando, setExportando] = React.useState(false);
  const [centros, setCentros] = React.useState<CentroCusto[]>([]);
  const [categorias, setCategorias] = React.useState<PlanoContas[]>([]);
  const pedido = React.useRef(0);

  const mudar = React.useCallback((patch: Partial<Filtros>) => setF(atual => ({ ...atual, pagina: 1, ...patch })), []);

  React.useEffect(() => {
    void Promise.all([fetch('/api/centros-custo'), fetch('/api/plano-contas')]).then(async ([a, b]) => {
      if (a.ok) { const c = await a.json(); if (Array.isArray(c)) setCentros(c); }
      if (b.ok) { const c = await b.json(); if (Array.isArray(c)) setCategorias(c); }
    }).catch(() => undefined);
  }, []);

  // A pesquisa espera a pessoa parar de digitar.
  React.useEffect(() => {
    const t = setTimeout(() => { if (busca !== f.pesquisar) mudar({ pesquisar: busca }); }, 350);
    return () => clearTimeout(t);
  }, [busca, f.pesquisar, mudar]);

  const consultar = React.useCallback(async () => {
    const meu = ++pedido.current;
    setEstado('carregando');
    try {
      const res = await fetch(`/api/relatorios/lancamentos?${parametros(visao, f)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'O relatório não respondeu.');
      if (meu !== pedido.current) return;
      setDados(json as RespostaLancamentos);
      setErro(null);
      setAtualizadoEm(new Date());
      setEstado('ok');
    } catch (e) {
      if (meu !== pedido.current) return;
      setErro(e instanceof Error ? e.message : 'O relatório não respondeu.');
      setEstado('erro');
    }
  }, [visao, f]);

  React.useEffect(() => { void consultar(); }, [consultar]);

  async function exportar() {
    setExportando(true);
    try {
      const res = await fetch(`/api/relatorios/lancamentos?${parametros(visao, f)}&formato=csv`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(typeof json.error === 'string' ? json.error : 'A exportação falhou.');
      }
      const blob = await res.blob();
      const nome = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'lancamentos.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Não foi possível exportar', e instanceof Error ? e.message : '');
    } finally {
      setExportando(false);
    }
  }

  const arvore = React.useMemo(() => ordenarEmArvore(centros), [centros]);
  const categoriasOrdenadas = React.useMemo(
    () => [...categorias].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })),
    [categorias],
  );
  const regime = dados?.regime ?? (f.data_de === 'MOVIMENTACAO' ? 'caixa' : 'competencia');
  const colunas = React.useMemo(() => colunasDa(visao, regime), [visao, regime]);

  const ativos = [
    f.periodo !== 'MES_ATUAL', f.data_de !== 'VENCIMENTO', f.situacao !== 'TODAS', f.tipo !== 'TODOS', f.incluir_repasse,
    !!f.centro_custo_id, !!f.categoria_id, !!f.pesquisar, f.agrupar !== '',
  ].filter(Boolean).length;
  const totais = dados?.totais;
  const agrupaFiltravel = f.agrupar === 'categoria' || f.agrupar === 'centro';

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={icone}
        titulo={TITULO[visao]}
        subtitulo={SUBTITULO[visao]}
        atualizadoEm={atualizadoEm}
        onRecarregar={consultar}
        acaoPrimaria={{ rotulo: exportando ? 'Exportando…' : 'Exportar para Excel', icone: Download, onClick: () => { if (!exportando) void exportar(); } }}
        acoesSecundarias={(Object.keys(TITULO) as Visao[]).filter(v => v !== visao).map(v => ({ rotulo: TITULO[v], href: ROTA[v] }))}
      />

      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: `Pesquisar em ${ROTULO_EM[f.em].toLocaleLowerCase('pt-BR')}` }}
        periodo={{
          valor: f.periodo,
          de: f.de,
          ate: f.ate,
          opcoes: ['MES_ATUAL', 'MES_PASSADO', 'PROX_30', 'PROX_90', 'TUDO', 'PERSONALIZADO'],
          onChange: (chave, range) => mudar({ periodo: chave, de: range.de, ate: range.ate }),
        }}
        selects={[
          {
            id: 'em', rotulo: 'Pesquisar em', valor: f.em,
            opcoes: (Object.keys(ROTULO_EM) as CampoPesquisa[]).map(k => ({ valor: k, rotulo: k === 'TUDO' ? 'Em todos os campos' : `Em ${ROTULO_EM[k].toLocaleLowerCase('pt-BR')}` })),
            onChange: v => mudar({ em: v as CampoPesquisa }),
          },
          {
            id: 'data-de', rotulo: 'Data de', valor: f.data_de,
            opcoes: (Object.keys(ROTULO_DATA_DE) as DataDe[]).map(k => ({ valor: k, rotulo: `Data de ${ROTULO_DATA_DE[k].toLocaleLowerCase('pt-BR')}` })),
            onChange: v => mudar({ data_de: v as DataDe }),
          },
          {
            id: 'situacao', rotulo: 'Situação', valor: f.situacao,
            opcoes: (Object.keys(ROTULO_SITUACAO) as Situacao[]).map(k => ({ valor: k, rotulo: k === 'TODAS' ? 'Todas as situações' : ROTULO_SITUACAO[k] })),
            onChange: v => mudar({ situacao: v as Situacao }),
          },
          {
            id: 'tipo', rotulo: 'Tipo', valor: f.tipo,
            opcoes: [{ valor: 'TODOS', rotulo: 'Despesas e receitas' }, { valor: 'DESPESA', rotulo: 'Só despesas' }, { valor: 'RECEITA', rotulo: 'Só receitas' }],
            onChange: v => mudar({ tipo: v as TipoFiltro }),
          },
          {
            id: 'centro', rotulo: 'Centro de custo', valor: f.centro_custo_id || TODOS,
            opcoes: [{ valor: TODOS, rotulo: 'Todos os centros' }, ...arvore.map(c => ({ valor: c.id, rotulo: `${' '.repeat(Math.min(c.nivel, 3))}${c.nome}` }))],
            onChange: v => mudar({ centro_custo_id: v === TODOS ? '' : v }),
          },
          {
            id: 'categoria', rotulo: 'Categoria', valor: f.categoria_id || TODOS,
            opcoes: [{ valor: TODOS, rotulo: 'Todas as categorias' }, ...categoriasOrdenadas.map(c => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` }))],
            onChange: v => mudar({ categoria_id: v === TODOS ? '' : v }),
          },
          {
            id: 'agrupar', rotulo: 'Agrupar por', valor: f.agrupar || TODOS,
            opcoes: [{ valor: TODOS, rotulo: 'Sem agrupar' }, ...(Object.keys(ROTULO_AGRUPAR) as Array<Exclude<Agrupar, ''>>).map(k => ({ valor: k, rotulo: `Agrupar por ${ROTULO_AGRUPAR[k].toLocaleLowerCase('pt-BR')}` }))],
            onChange: v => mudar({ agrupar: (v === TODOS ? '' : v) as Agrupar }),
          },
          { id: 'ordem', rotulo: 'Ordenar', valor: f.ordem, opcoes: ORDENS, onChange: v => mudar({ ordem: v }) },
        ]}
        resumo={{
          exibidos: totais?.quantidade ?? 0,
          total: totais?.quantidade ?? 0,
          substantivo: (totais?.quantidade ?? 0) === 1 ? 'linha' : 'linhas',
          soma: totais?.valor,
          escopo: totais ? `${totais.lancamentos.toLocaleString('pt-BR')} ${totais.lancamentos === 1 ? 'lançamento' : 'lançamentos'}` : undefined,
        }}
        ativos={ativos}
        onLimpar={() => { setBusca(''); setF(filtrosIniciais()); }}
      />

      <Interruptor
        rotulo="Mostrar repasses"
        descricao="O dinheiro que só passa pela agência fica fora da conta até você ligar aqui."
        ligado={f.incluir_repasse}
        onChange={v => mudar({ incluir_repasse: v })}
      />

      {regime === 'caixa' ? (
        <Callout tom="info" titulo="Regime de caixa">
          Cada valor é a parte do que já foi pago ou recebido, proporcional à categoria e ao centro do lançamento.
        </Callout>
      ) : null}
      {dados?.truncado ? (
        <Callout tom="aviso" titulo="Período grande demais">
          O relatório leu os primeiros 20.000 lançamentos do período. Encurte o período para ver todos.
        </Callout>
      ) : null}

      {dados && dados.grupos.length > 0 ? (
        <section aria-label="Subtotais" className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)] shadow-[var(--fin-e-card)]">
          <h2 className="fin-t-subhead mb-[var(--fin-s-2)] text-[var(--fin-text)]">Subtotais por {ROTULO_AGRUPAR[f.agrupar as Exclude<Agrupar, ''>].toLocaleLowerCase('pt-BR')}</h2>
          <ul className="flex flex-col">
            {dados.grupos.map(g => {
              const conteudo = (
                <>
                  <span className="fin-t-body min-w-0 truncate text-[var(--fin-text)]">{g.rotulo}</span>
                  <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{g.quantidade.toLocaleString('pt-BR')}</span>
                  <Money valor={g.valor} size="body" estado="ok" />
                </>
              );
              const classe = 'grid w-full grid-cols-[1fr_auto_auto] items-center gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] px-[var(--fin-s-2)] py-[var(--fin-s-2)] text-left last:border-0';
              return (
                <li key={g.chave || g.rotulo}>
                  {agrupaFiltravel && g.chave ? (
                    <button
                      type="button"
                      onClick={() => mudar(f.agrupar === 'categoria' ? { categoria_id: g.chave, agrupar: '' } : { centro_custo_id: g.chave, agrupar: '' })}
                      className={cn(classe, 'rounded-[var(--fin-r-md)] hover:bg-[var(--fin-surface-2)]', FOCO)}
                      aria-label={`Ver só ${g.rotulo}`}
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div className={classe}>{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <FinTable
        linhas={dados?.linhas ?? []}
        colunas={colunas}
        chave={l => l.chave}
        densidade="compacta"
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void consultar(); } } : null}
        onLinhaClick={l => router.push(`/financeiro-ag/${l.lado}?abrir=${encodeURIComponent(l.conta_id)}`)}
        totais={totais ? [
          { colunaId: 'valor', valor: totais.valor, rotulo: `Total de ${totais.quantidade.toLocaleString('pt-BR')} linhas` },
          ...(visao !== 'categoria' ? [
            { colunaId: 'valor_lancamento', valor: totais.valor_lancamento, rotulo: 'Total dos lançamentos' },
            { colunaId: 'valor_movimentacao', valor: totais.valor_movimentacao, rotulo: 'Total movimentado' },
          ] : []),
        ] : undefined}
        vazio={
          ativos > 0
            ? {
              motivo: 'sem-resultado',
              titulo: 'Nada neste recorte',
              oQueE: visao === 'rateio'
                ? 'Nenhuma conta rateada bate com estes filtros. Troque o período ou limpe os filtros.'
                : 'Nenhum lançamento bate com estes filtros. Troque o período ou limpe os filtros.',
              acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => { setBusca(''); setF(filtrosIniciais()); } },
            }
            : {
              motivo: 'sem-dado',
              titulo: visao === 'rateio' ? 'Nenhuma conta rateada neste mês' : 'Nenhum lançamento neste mês',
              oQueE: visao === 'rateio'
                ? 'Aqui aparecem as contas divididas entre centros de custo. Divida uma conta na seção Rateios do lançamento.'
                : 'Aqui aparecem as contas a pagar e a receber com vencimento no período.',
              comoComeca: visao === 'rateio'
                ? ['Cadastre os centros de custo.', 'Na conta, abra Rateios e divida entre os centros.']
                : undefined,
              acao: visao === 'rateio' ? { rotulo: 'Cadastrar centros de custo', href: '/financeiro-ag/centros-custo' } : undefined,
            }
        }
      />

      {dados && dados.paginas > 1 ? (
        <nav aria-label="Páginas do relatório" className="flex items-center justify-end gap-[var(--fin-s-2)]">
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
            Página {dados.pagina.toLocaleString('pt-BR')} de {dados.paginas.toLocaleString('pt-BR')}
          </span>
          <Button type="button" variant="outline" size="icon" aria-label="Página anterior" disabled={dados.pagina <= 1} onClick={() => setF(a => ({ ...a, pagina: dados.pagina - 1 }))} className={cn('size-11 lg:size-10', FOCO)}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Próxima página" disabled={dados.pagina >= dados.paginas} onClick={() => setF(a => ({ ...a, pagina: dados.pagina + 1 }))} className={cn('size-11 lg:size-10', FOCO)}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </nav>
      ) : null}
    </MolduraDaPagina>
  );
}

export default RelatorioLancamentos;
