'use client';

/**
 * A lista de vendas (/vendas) no visual do financeiro.
 *
 * Uma linha por venda, lida no modelo da venda completa (a mesma conta da
 * ficha e dos relatórios): cliente, produtos, fornecedores, vendedor,
 * unidade, situação, faturamento e, para quem pode ver, a receita da agência.
 * Filtros por fornecedor, tipo de produto, vendedor, unidade, período e
 * situação; a busca acha número, cliente, passageiro, produto e localizador.
 * Clicar na linha abre a ficha da venda. Baixa em CSV e Excel o mesmo recorte
 * da tela.
 */
import * as React from 'react';
import { useModulos } from '@/components/useModulos';
import { useRouter } from 'next/navigation';
import { Download, Eye, Plus, ShoppingCart, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { MetricCard } from '@/components/fin/MetricCard';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { statusChipVariants, type StatusTone } from '@/components/fin/StatusChip';
import type { PeriodoChave } from '@/components/fin/PeriodPicker';
import { deleteEntity } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ROTULO_TIPO_PRODUTO } from '@/lib/venda-modelo';
import {
  ROTULO_SITUACAO_NA_LISTA, filtrarLinhas, resumoDaLista,
  type FiltroDaLista, type LinhaDaLista, type Opcao, type SituacaoNaLista,
} from '@/lib/vendas-lista';

interface Resposta {
  linhas: LinhaDaLista[];
  opcoes: { fornecedores: Opcao[]; tipos: Opcao[]; vendedores: Opcao[]; unidades: Opcao[] };
  ver_receita: boolean;
  so_as_suas: boolean;
  pode_exportar: boolean;
}

const TODOS = 'todos';
const TOM_DA_SITUACAO: Record<SituacaoNaLista, StatusTone> = { ABERTA: 'info', FECHADA: 'positivo', CANCELADA: 'negativo' };
const OPCOES_DE_PERIODO: PeriodoChave[] = ['MES_ATUAL', 'MES_PASSADO', 'TUDO', 'PERSONALIZADO'];
const ICONE_DE_ACAO = 'inline-flex size-9 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const reaisDe = (centavos: number) => centavos / 100;
const nomesCurtos = (nomes: string[], max = 2) => (nomes.length <= max ? nomes.join(', ') : `${nomes.slice(0, max).join(', ')} e mais ${nomes.length - max}`);
const semTodos = (v: string) => (v === TODOS ? '' : v);

function ChipDaSituacao({ situacao }: { situacao: SituacaoNaLista }) {
  return <span className={statusChipVariants({ tone: TOM_DA_SITUACAO[situacao] })}>{ROTULO_SITUACAO_NA_LISTA[situacao]}</span>;
}

export function ListaDeVendas() {
  const router = useRouter();
  // Voucher (IA) e relatórios são de outros módulos (modulos.ts).
  const modulos = useModulos();
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [periodo, setPeriodo] = React.useState<{ chave: PeriodoChave; de: string; ate: string }>({ chave: 'TUDO', de: '', ate: '' });
  const [filtro, setFiltro] = React.useState<Required<FiltroDaLista>>({ busca: '', fornecedor: '', tipo: '', vendedor: '', unidade: '', situacao: '' });
  const [excluir, setExcluir] = React.useState<LinhaDaLista | null>(null);
  const [excluindo, setExcluindo] = React.useState(false);

  const consulta = React.useCallback((formato?: 'csv' | 'xlsx') => {
    const q = new URLSearchParams();
    if (periodo.de) q.set('de', periodo.de);
    if (periodo.ate) q.set('ate', periodo.ate);
    if (formato) {
      q.set('formato', formato);
      for (const [k, v] of Object.entries(filtro)) if (v) q.set(k, v);
    }
    return `/api/vendas/lista?${q}`;
  }, [periodo.de, periodo.ate, filtro]);

  // A lista do período vem do servidor; o resto do filtro corta na hora.
  const urlDoPeriodo = consulta();
  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch(urlDoPeriodo);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir a lista de vendas.');
      setDados(j as Resposta);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a lista de vendas.');
      setEstado('erro');
    }
  }, [urlDoPeriodo]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const todas = dados?.linhas ?? [];
  const linhas = React.useMemo(() => filtrarLinhas(todas, filtro), [todas, filtro]);
  const verReceita = dados?.ver_receita ?? false;
  const resumo = resumoDaLista(linhas, verReceita);
  const ativos = [filtro.busca, filtro.fornecedor, filtro.tipo, filtro.vendedor, filtro.unidade, filtro.situacao].filter(Boolean).length + (periodo.chave !== 'TUDO' ? 1 : 0);
  const mudar = (p: Partial<FiltroDaLista>) => setFiltro(f => ({ ...f, ...p }));
  const limpar = () => {
    setFiltro({ busca: '', fornecedor: '', tipo: '', vendedor: '', unidade: '', situacao: '' });
    setPeriodo({ chave: 'TUDO', de: '', ate: '' });
  };
  const abrir = (l: LinhaDaLista) => router.push(`/vendas/${encodeURIComponent(l.venda_id)}/ficha`);

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await deleteEntity('vendas-crm', excluir.venda_id);
      setDados(d => (d ? { ...d, linhas: d.linhas.filter(x => x.venda_id !== excluir.venda_id) } : d));
      toast.success(`Venda ${excluir.numero} excluída`);
      setExcluir(null);
    } catch (e) {
      toast.error('A venda não foi excluída', e instanceof Error ? e.message : undefined);
    } finally {
      setExcluindo(false);
    }
  }

  const opcao = (lista: Opcao[] | undefined, todos: string) => [{ valor: TODOS, rotulo: todos }, ...(lista ?? [])];

  const colunas: FinColuna<LinhaDaLista>[] = [
    {
      id: 'numero', cabecalho: 'Venda', tipo: 'texto', sortable: true, minWidth: 104,
      acessor: l => l.numero,
      render: l => (
        <span className="flex flex-col">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{l.numero || 'Sem número'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{l.origem === 'crm' ? 'Do CRM' : l.origem === 'mudanca' ? 'Do sistema anterior' : 'Lançada aqui'}</span>
        </span>
      ),
    },
    { id: 'data', cabecalho: 'Data', tipo: 'data', sortable: true, valor: l => l.data_venda || null },
    {
      id: 'cliente', cabecalho: 'Cliente e produtos', tipo: 'texto', sortable: true, minWidth: 180,
      acessor: l => l.cliente,
      render: l => (
        <span className="flex min-w-0 max-w-[200px] flex-col">
          <span className="truncate text-[var(--fin-text)]">{l.cliente}</span>
          <span className="truncate fin-t-caption text-[var(--fin-text-3)]" title={l.produtos}>
            {l.tipos.map(t => ROTULO_TIPO_PRODUTO[t]).join(' · ') || 'Sem produto'}
            {l.localizadores.length ? ` · ${nomesCurtos(l.localizadores)}` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'fornecedores', cabecalho: 'Fornecedores', tipo: 'texto', prioridade: 2, minWidth: 130,
      acessor: l => l.fornecedores.map(p => p.nome).join(', '),
      render: l => <span className="block max-w-[150px] text-[var(--fin-text-2)]">{l.fornecedores.length ? nomesCurtos(l.fornecedores.map(p => p.nome)) : '—'}</span>,
    },
    { id: 'vendedor', cabecalho: 'Vendedor', tipo: 'texto', sortable: true, prioridade: 1, acessor: l => l.vendedor, render: l => <span title={l.vendedor} className="block max-w-[110px] truncate text-[var(--fin-text-2)]">{l.vendedor}</span> },
    { id: 'unidade', cabecalho: 'Unidade', tipo: 'texto', sortable: true, prioridade: 1, acessor: l => l.unidade, render: l => <span className="text-[var(--fin-text-2)]">{l.unidade || '—'}</span> },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', sortable: true, acessor: l => l.situacao, render: l => <ChipDaSituacao situacao={l.situacao} /> },
    { id: 'faturamento', cabecalho: 'Faturamento', tipo: 'dinheiro', sortable: true, valor: l => reaisDe(l.faturamento) },
    ...(verReceita ? [{
      id: 'receita', cabecalho: 'Receita', tipo: 'dinheiro' as const, sortable: true, prioridade: 2 as const,
      valor: (l: LinhaDaLista) => reaisDe(l.receita ?? 0),
      tone: (l: LinhaDaLista) => ((l.receita ?? 0) < 0 ? 'negativo' as const : 'neutro' as const),
      sub: (l: LinhaDaLista) => (l.percentual_receita === null ? null : `${l.percentual_receita.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do total`),
    }] : []),
    {
      id: 'acoes', cabecalho: 'Ações', tipo: 'acoes',
      render: l => (
        <span className="inline-flex items-center justify-end gap-1">
          <button type="button" className={ICONE_DE_ACAO} aria-label={`Abrir a venda ${l.numero} na tela anterior`} title="Abrir na tela anterior"
            onClick={e => { e.stopPropagation(); router.push(`/vendas/${encodeURIComponent(l.venda_id)}`); }}>
            <Eye aria-hidden="true" className="size-4" />
          </button>
          <button type="button" className={cn(ICONE_DE_ACAO, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')} aria-label={`Excluir a venda ${l.numero}`} title="Excluir"
            onClick={e => { e.stopPropagation(); setExcluir(l); }}>
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </span>
      ),
    },
  ];

  const totais = [
    { colunaId: 'faturamento', valor: reaisDe(resumo.faturamento), rotulo: 'Total sem canceladas' },
    ...(verReceita ? [{ colunaId: 'receita', valor: reaisDe(resumo.receita ?? 0), rotulo: 'Total sem canceladas' }] : []),
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={ShoppingCart}
        titulo="Vendas"
        subtitulo="Todas as vendas, as lançadas aqui e as que chegam do CRM. Clique numa venda para abrir a ficha."
        acaoPrimaria={{
          rotulo: 'Lançar venda', icone: Plus,
          menu: [
            { rotulo: 'Venda completa', descricao: 'Produtos, passageiros, componentes de receita e pagamentos por forma.', href: '/vendas/lancar' },
            { rotulo: 'Venda simples', descricao: 'A tela de antes: um valor por fornecedor.', href: '/vendas/nova' },
            ...(modulos.tem('ia') ? [{ rotulo: 'Pelo voucher', descricao: 'A IA lê o voucher ou o e-mail da operadora e monta a venda para você conferir.', href: '/vendas/lancar/voucher' }] : []),
          ],
        }}
        acoesSecundarias={[
          ...(modulos.tem('ia') ? [{ rotulo: 'Lançar pelo voucher', href: '/vendas/lancar/voucher' }] : []),
          { rotulo: 'Orçamentos', href: '/vendas/orcamentos' },
          ...(modulos.tem('relatorios') ? [{ rotulo: 'Relatórios de vendas', href: '/relatorios/vendas' }] : []),
        ]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard rotulo="Faturamento" valor={estado === 'ok' ? reaisDe(resumo.faturamento) : null} estado={estado === 'ok' ? 'ok' : 'carregando'} emphasis="destaque"
          contexto={`${resumo.vendas} ${resumo.vendas === 1 ? 'venda' : 'vendas'} no recorte, sem as canceladas`} />
        <MetricCard rotulo="Vendas" formato="contagem" valor={estado === 'ok' ? resumo.vendas : null} estado={estado === 'ok' ? 'ok' : 'carregando'}
          contexto={linhas.length !== resumo.vendas ? `${linhas.length - resumo.vendas} canceladas ficam fora da conta` : 'todas valendo'} />
        <MetricCard rotulo="Ticket médio" valor={estado === 'ok' ? reaisDe(resumo.ticket_medio) : null} estado={estado === 'ok' ? 'ok' : 'carregando'}
          contexto="faturamento ÷ vendas do recorte" />
        {verReceita ? (
          <MetricCard rotulo="Receita da agência" valor={estado === 'ok' ? reaisDe(resumo.receita ?? 0) : null} estado={estado === 'ok' ? 'ok' : 'carregando'}
            tone={(resumo.receita ?? 0) < 0 ? 'negativo' : 'positivo'}
            contexto={`${(resumo.percentual_receita ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do faturamento, pela regra de Configurações › Vendas`} />
        ) : null}
      </div>

      {dados?.so_as_suas ? <Callout tom="info">Mostrando só as suas vendas.</Callout> : null}

      <FilterBar
        busca={{ valor: filtro.busca, onChange: v => mudar({ busca: v }), placeholder: 'Número, cliente, passageiro, localizador…' }}
        periodo={{
          valor: periodo.chave, de: periodo.de, ate: periodo.ate, opcoes: OPCOES_DE_PERIODO,
          onChange: (chave, r) => setPeriodo({ chave, de: r.de, ate: r.ate }),
        }}
        selects={[
          {
            id: 'vendas-situacao', rotulo: 'Situação', valor: filtro.situacao || TODOS, onChange: v => mudar({ situacao: semTodos(v) }),
            opcoes: [{ valor: TODOS, rotulo: 'Todas' }, { valor: 'ATIVAS', rotulo: 'Sem as canceladas' }, { valor: 'ABERTA', rotulo: 'Abertas' }, { valor: 'FECHADA', rotulo: 'Fechadas' }, { valor: 'CANCELADA', rotulo: 'Canceladas' }],
          },
          { id: 'vendas-fornecedor', rotulo: 'Fornecedor', valor: filtro.fornecedor || TODOS, onChange: v => mudar({ fornecedor: semTodos(v) }), opcoes: opcao(dados?.opcoes.fornecedores, 'Todos') },
          { id: 'vendas-tipo', rotulo: 'Produto', valor: filtro.tipo || TODOS, onChange: v => mudar({ tipo: semTodos(v) }), opcoes: opcao(dados?.opcoes.tipos, 'Todos') },
          { id: 'vendas-vendedor', rotulo: 'Vendedor', valor: filtro.vendedor || TODOS, onChange: v => mudar({ vendedor: semTodos(v) }), opcoes: opcao(dados?.opcoes.vendedores, 'Todos') },
          { id: 'vendas-unidade', rotulo: 'Unidade', valor: filtro.unidade || TODOS, onChange: v => mudar({ unidade: semTodos(v) }), opcoes: opcao(dados?.opcoes.unidades, 'Todas') },
        ]}
        resumo={{ exibidos: linhas.length, total: todas.length, substantivo: todas.length === 1 ? 'venda' : 'vendas' }}
        ativos={ativos}
        onLimpar={limpar}
      />

      {dados?.pode_exportar ? (
        <div className="-mt-[var(--fin-s-2)] flex flex-wrap items-center justify-end gap-[var(--fin-s-2)]">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Baixar o recorte</span>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={consulta('csv')} />}><Download aria-hidden="true" className="size-4" /> CSV</Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={consulta('xlsx')} />}><Download aria-hidden="true" className="size-4" /> Excel</Button>
        </div>
      ) : null}

      <FinTable<LinhaDaLista>
        linhas={linhas}
        colunas={colunas}
        chave={l => l.venda_id}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        vazio={todas.length === 0 && ativos === 0
          ? {
              motivo: 'sem-dado', titulo: 'Nenhuma venda ainda',
              oQueE: 'Aqui aparecem as vendas lançadas no financeiro e as que chegam do CRM, com o que o cliente paga e o que a agência ganha.',
              comoComeca: ['Lance a venda completa com produtos e pagamentos.', 'Ou ligue o CRM em Configurações para as vendas chegarem sozinhas.'],
              acao: { rotulo: 'Lançar venda completa', href: '/vendas/lancar' },
            }
          : {
              motivo: 'sem-resultado', titulo: 'Nenhuma venda neste recorte',
              oQueE: 'Nenhuma venda bate com os filtros escolhidos.',
              acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar },
            }}
        onLinhaClick={abrir}
        totais={totais}
      />

      <ConfirmDialog
        aberto={excluir !== null}
        onOpenChange={a => { if (!a) setExcluir(null); }}
        titulo={`Excluir a venda ${excluir?.numero ?? ''}`.trim()}
        oQueVaiAcontecer="A venda sai da lista. Contas já recebidas ou pagas não são apagadas por aqui; se a venda tiver contas ligadas, o sistema pode recusar e dizer o motivo."
        detalhes={excluir ? [
          { rotulo: 'Cliente', valor: excluir.cliente },
          { rotulo: 'Faturamento', valor: reaisDe(excluir.faturamento).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
        ] : undefined}
        confirmarRotulo="Excluir venda"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={confirmarExclusao}
      />
    </MolduraDaPagina>
  );
}
