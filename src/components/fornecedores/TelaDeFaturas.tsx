'use client';

/**
 * FATURA DO FORNECEDOR (E5, parte C). Tela operacional:
 *  - "A faturar": um resumo por fornecedor; escolhido o fornecedor, a grade
 *    larga dos itens com Valor/Liquidado/Saldo do cliente ao lado do Saldo do
 *    fornecedor e do Valor a gerar, a seleção sugerida pela regra (até o
 *    corte), a prévia com o sinal descontado e o vencimento já em dia útil;
 *  - "Faturas geradas": a lista, o detalhe e o desfazer (com motivo).
 * A Taxa CC DU/RAV muda no detalhe do item, com motivo.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, FileStack, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { FilterBar } from '@/components/fin/FilterBar';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import { Callout } from '@/components/fin/Callout';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  ROTULO_AJUSTE, ROTULO_DATA_BASE, descreverRegra, normalizarRegra, proximasFaturas,
  type AjusteDoVencimento, type DataBaseDaFatura, type PeriodoDaFatura, type RegraDeFaturamento,
} from '@/lib/fornecedor-regra';
import type { ItemAFaturar, PreviaDaFatura } from '@/lib/fornecedor-fatura';
import type { AFaturarDaParte, DetalheDaFatura, FaturaResumo, RegraDoFornecedor, ResumoDaParte, SituacaoDoPagamento } from '@/lib/fornecedor-servidor';
import {
  CampoReais, ErroDaApi, LINK, LinhaDeResumo, ListaDeAlertas, Pilula, SECAO, SELECT, api, dataBR, emReais, hojeNoBrasil, quandoBR, reais,
} from './comum';

type Aba = 'a-faturar' | 'geradas';
type Vista = 'essenciais' | 'todas';

const ROTULO_PAGAMENTO: Record<SituacaoDoPagamento, { rotulo: string; tom: 'neutro' | 'acento' | 'positivo' | 'aviso' | 'violeta' }> = {
  EM_ABERTO: { rotulo: 'Em aberto', tom: 'acento' },
  VENCIDA: { rotulo: 'Vencida', tom: 'aviso' },
  PARCIAL: { rotulo: 'Paga em parte', tom: 'aviso' },
  PAGA: { rotulo: 'Paga', tom: 'positivo' },
  DESFEITA: { rotulo: 'Desfeita', tom: 'neutro' },
};

const COLUNAS_ESSENCIAIS = ['venda', 'cliente', 'produto', 'inicio', 'valor_cliente', 'liquidado_cliente', 'saldo_cliente', 'saldo_fornecedor', 'valor_a_gerar', 'alerta'];

function vencimentoTexto(v: { data: string; pela_regra: string; motivo_ajuste: string | null }): string {
  return v.motivo_ajuste && v.data !== v.pela_regra ? `${dataBR(v.data)} (${dataBR(v.pela_regra)} é ${v.motivo_ajuste})` : dataBR(v.data);
}

export function TelaDeFaturas() {
  const router = useRouter();
  const busca = useSearchParams();
  const aba: Aba = busca.get('aba') === 'geradas' || busca.get('fatura') ? 'geradas' : 'a-faturar';
  const parteId = busca.get('parte') ?? '';
  const faturaId = busca.get('fatura') ?? '';

  const irPara = React.useCallback((p: Record<string, string>) => {
    const q = new URLSearchParams(p);
    router.replace(`/financeiro-ag/fornecedores/faturas${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [router]);

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FileStack}
        titulo="Fatura do fornecedor"
        subtitulo="Junta os itens de várias vendas numa conta a pagar, pela regra de corte e vencimento de cada fornecedor."
        acoesSecundarias={[
          { rotulo: 'Sinais a fornecedores', href: '/financeiro-ag/fornecedores/sinais' },
          { rotulo: 'Acordos com fornecedores', href: '/financeiro-ag/fornecedores/acordos' },
        ]}
      />
      <Segmentado<Aba>
        rotulo="O que ver"
        opcoes={[{ valor: 'a-faturar', rotulo: 'A faturar' }, { valor: 'geradas', rotulo: 'Faturas geradas' }]}
        valor={aba}
        onChange={v => irPara(v === 'geradas' ? { aba: 'geradas' } : {})}
        className="self-start"
      />
      {aba === 'a-faturar'
        ? (parteId
          ? <ItensDaParte parteId={parteId} onVoltar={() => irPara({})} onGerada={id => irPara({ aba: 'geradas', fatura: id })} />
          : <ResumoPorFornecedor onEscolher={id => irPara({ parte: id })} />)
        : <FaturasGeradas faturaId={faturaId} onAbrir={id => irPara(id ? { aba: 'geradas', fatura: id } : { aba: 'geradas' })} />}
    </MolduraDaPagina>
  );
}

// ============================================================
// A faturar: resumo por fornecedor
// ============================================================

function ResumoPorFornecedor({ onEscolher }: { onEscolher: (id: string) => void }) {
  const [partes, setPartes] = React.useState<ResumoDaParte[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [filtro, setFiltro] = React.useState('');
  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      setPartes((await api<{ partes: ResumoDaParte[] }>('/api/fornecedores/faturas/a-faturar')).partes);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);
  const visiveis = partes.filter(p => !filtro || p.parte_nome.toLowerCase().includes(filtro.toLowerCase()));
  const colunas: FinColuna<ResumoDaParte>[] = [
    { id: 'nome', cabecalho: 'Fornecedor', tipo: 'texto', sortable: true, acessor: p => p.parte_nome, minWidth: 200,
      render: p => <span className="flex flex-col"><span className="fin-t-body-strong">{p.parte_nome}</span><span className="fin-t-caption text-[var(--fin-text-3)]">{p.regra}</span></span> },
    { id: 'ate', cabecalho: 'Até o corte', tipo: 'texto', sortable: true, acessor: p => p.corte,
      render: p => <span className="flex flex-col"><span>{dataBR(p.corte)}</span><span className="fin-t-caption text-[var(--fin-text-3)]">{p.itens_ate_o_corte} de {p.itens} {p.itens === 1 ? 'item' : 'itens'}</span></span> },
    { id: 'total_corte', cabecalho: 'Fatura até o corte', tipo: 'dinheiro', sortable: true, valor: p => emReais(p.total_ate_o_corte) },
    { id: 'vence', cabecalho: 'Vence', tipo: 'texto', sortable: true, acessor: p => p.vencimento.data, render: p => vencimentoTexto(p.vencimento) },
    { id: 'cliente', cabecalho: 'Clientes ainda devem', tipo: 'dinheiro', sortable: true, valor: p => emReais(p.saldo_cliente), tone: p => (p.saldo_cliente > 0 ? 'negativo' : 'neutro'), prioridade: 2 },
    { id: 'sinal', cabecalho: 'Sinal a descontar', tipo: 'dinheiro', sortable: true, valor: p => emReais(p.sinal_disponivel), prioridade: 1 },
    { id: 'total', cabecalho: 'Tudo a faturar', tipo: 'dinheiro', sortable: true, valor: p => emReais(p.total), prioridade: 2 },
  ];
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <FilterBar
        busca={{ valor: filtro, onChange: setFiltro, placeholder: 'Buscar fornecedor' }}
        resumo={{ exibidos: visiveis.length, total: partes.length, substantivo: 'fornecedores com itens a faturar', soma: emReais(visiveis.reduce((a, p) => a + p.total_ate_o_corte, 0)), escopo: 'até o corte' }}
        ativos={filtro ? 1 : 0}
        onLimpar={() => setFiltro('')}
      />
      <FinTable<ResumoDaParte>
        linhas={visiveis}
        colunas={colunas}
        chave={p => p.parte_id}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={p => onEscolher(p.parte_id)}
        vazio={filtro
          ? { motivo: 'sem-resultado', titulo: 'Nenhum fornecedor com esse nome', oQueE: 'Nenhum fornecedor com itens a faturar se encaixa na busca.', acaoSecundaria: { rotulo: 'Limpar busca', onClick: () => setFiltro('') } }
          : { motivo: 'sem-dado', titulo: 'Nada a faturar', oQueE: 'Aqui aparecem os fornecedores com contas de vendas em aberto, prontas para juntar numa fatura.', comoComeca: ['Lance a venda com o fornecedor de cada produto.', 'A conta a pagar nasce sozinha e aparece aqui.'] }}
      />
    </div>
  );
}

// ============================================================
// A faturar: os itens de um fornecedor
// ============================================================

function colunasDosItens(): FinColuna<ItemAFaturar>[] {
  const din = (id: string, cabecalho: string, valor: (i: ItemAFaturar) => number, extra: Partial<Extract<FinColuna<ItemAFaturar>, { tipo: 'dinheiro' }>> = {}): FinColuna<ItemAFaturar> =>
    ({ id, cabecalho, tipo: 'dinheiro', sortable: true, valor: i => emReais(valor(i)), ...extra });
  const txt = (id: string, cabecalho: string, v: (i: ItemAFaturar) => string, minWidth?: number): FinColuna<ItemAFaturar> =>
    ({ id, cabecalho, tipo: 'texto', sortable: true, acessor: v, render: i => v(i) || '—', minWidth });
  return [
    { id: 'venda', cabecalho: 'Venda', tipo: 'texto', sortable: true, acessor: i => i.data_venda,
      render: i => <span className="flex flex-col whitespace-nowrap"><span className="fin-t-body-strong">{i.venda_numero}</span><span className="fin-t-caption text-[var(--fin-text-3)]">{dataBR(i.data_venda)}</span></span> },
    txt('cliente', 'Cliente', i => i.cliente, 160),
    { id: 'produto', cabecalho: 'Produto', tipo: 'texto', sortable: true, acessor: i => i.produto, minWidth: 200,
      render: i => (
        <span className="flex flex-col">
          <span>{i.produto || i.tipos}{i.complemento ? <span className="ml-[var(--fin-s-1)]"><Pilula tom="violeta">diferença da venda</Pilula></span> : null}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{[i.tipos, i.localizador].filter(Boolean).join(' · ')}</span>
        </span>
      ) },
    { id: 'inicio', cabecalho: 'Início', tipo: 'data', sortable: true, valor: i => i.data_inicio || null },
    { id: 'fim', cabecalho: 'Fim', tipo: 'data', sortable: true, valor: i => i.data_fim || null },
    txt('tipo', 'Tipo', i => i.tipos),
    txt('fornecedores', 'Fornecedor do produto', i => i.fornecedores, 160),
    txt('representante', 'Representante', i => i.representante, 140),
    txt('intermediario', 'Intermediário', i => i.intermediario, 140),
    txt('localizador', 'Localizador', i => i.localizador),
    txt('destino', 'Destino', i => i.destino),
    din('valor_cliente', 'Valor do cliente', i => i.valor_cliente),
    din('liquidado_cliente', 'Liquidado do cliente', i => i.liquidado_cliente, { tone: i => (i.liquidado_cliente > 0 ? 'positivo' : 'neutro') }),
    din('saldo_cliente', 'Saldo do cliente', i => i.saldo_cliente, { tone: i => (i.saldo_cliente > 0 ? 'negativo' : 'neutro') }),
    { id: 'moeda', cabecalho: 'Moeda do fornecedor', tipo: 'texto', sortable: true, acessor: i => i.moeda_fornecedor,
      render: i => (i.moeda_fornecedor === 'BRL' ? 'BRL' : `${i.moeda_fornecedor} ${(i.saldo_moeda_fornecedor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`) },
    din('saldo_fornecedor', 'Saldo do fornecedor', i => i.saldo_fornecedor),
    din('valor_a_gerar', 'Valor a gerar', i => i.valor_a_gerar),
    din('taxa_du', 'Taxa DU', i => i.taxa_du),
    din('rav', 'RAV', i => i.rav),
    din('taxa_cc_du', 'Taxa CC DU', i => i.taxa_cc_du),
    din('taxa_cc_rav', 'Taxa CC RAV', i => i.taxa_cc_rav),
    din('over', 'Over', i => i.over),
    din('tarifa', 'Valor do produto', i => i.tarifa),
    din('taxas', 'Taxas', i => i.taxas),
    din('comissao', 'Comissão', i => i.comissao),
    din('valor_fornecedor', 'Valor do fornecedor', i => i.valor_fornecedor),
    din('liquidado_fornecedor', 'Pago ao fornecedor', i => i.liquidado_fornecedor),
    txt('situacao', 'Situação da venda', i => (i.situacao_venda === 'FECHADA' ? 'Fechada' : i.situacao_venda === 'CANCELADA' ? 'Cancelada' : 'Aberta')),
    { id: 'vencimento_atual', cabecalho: 'Vencia na venda', tipo: 'data', sortable: true, valor: i => i.vencimento_atual || null },
    { id: 'alerta', cabecalho: 'Atenção', tipo: 'texto', minWidth: 120,
      render: i => {
        const a = i.alertas.find(x => x.gravidade === 'atencao');
        if (!a) return <span className="fin-t-caption text-[var(--fin-text-3)]">—</span>;
        const rotulo = a.codigo === 'CLIENTE_NAO_PAGOU' ? 'Cliente não pagou' : a.codigo === 'CLIENTE_EM_ATRASO' ? 'Cliente em atraso' : a.codigo === 'VENDA_CANCELADA' ? 'Venda cancelada' : 'Pago antes';
        return <span title={a.mensagem}><Pilula tom="aviso">{rotulo}</Pilula></span>;
      } },
  ];
}

function ItensDaParte({ parteId, onVoltar, onGerada }: { parteId: string; onVoltar: () => void; onGerada: (id: string) => void }) {
  const [dados, setDados] = React.useState<AFaturarDaParte | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [filtro, setFiltro] = React.useState('');
  const [vista, setVista] = React.useState<Vista>('essenciais');
  const [aberto, setAberto] = React.useState<ItemAFaturar | null>(null);
  const [previaAberta, setPreviaAberta] = React.useState(false);
  const [regraAberta, setRegraAberta] = React.useState(false);

  const carregar = React.useCallback(async (manterSelecao = false) => {
    setEstado('carregando');
    try {
      const d = await api<AFaturarDaParte>(`/api/fornecedores/faturas/a-faturar?parte_id=${encodeURIComponent(parteId)}`);
      setDados(d);
      setMarcados(m => (manterSelecao ? new Set([...m].filter(id => d.itens.some(i => i.conta_id === id))) : new Set(d.sugeridos)));
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, [parteId]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const itens = dados?.itens ?? [];
  const termo = filtro.trim().toLowerCase();
  const visiveis = termo
    ? itens.filter(i => [i.venda_numero, i.cliente, i.produto, i.localizador, i.destino, i.fornecedores].some(x => x.toLowerCase().includes(termo)))
    : itens;
  const selecionados = itens.filter(i => marcados.has(i.conta_id));
  const totalSel = selecionados.reduce((a, i) => a + i.valor_a_gerar, 0);
  const deveSel = selecionados.reduce((a, i) => a + i.saldo_cliente, 0);
  const sinal = (dados?.sinais ?? []).reduce((a, s) => a + s.disponivel, 0);
  const colunas = React.useMemo(colunasDosItens, []);
  const corte = dados?.periodo_sugerido.corte ?? '';

  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <section className={cn(SECAO, 'gap-[var(--fin-s-3)]')} aria-labelledby="t-parte">
        <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
            <button type="button" onClick={onVoltar} className={cn(LINK, 'inline-flex w-fit items-center gap-[var(--fin-s-1)] fin-t-caption')}>
              <ArrowLeft aria-hidden="true" className="size-3.5" /> Todos os fornecedores
            </button>
            <h2 id="t-parte" className="fin-t-subhead text-[var(--fin-text)]">{dados?.parte_nome || 'Fornecedor'}</h2>
            <p className="fin-t-caption text-[var(--fin-text-2)]">{dados?.regra.descricao ?? ' '}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setRegraAberta(true)} disabled={!dados} className="h-11 gap-[var(--fin-s-2)] lg:h-10">
            <Settings2 aria-hidden="true" className="size-4" /> Regra de faturamento
          </Button>
        </div>
        {dados ? (
          <dl className="grid grid-cols-1 gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Período sugerido</dt>
              <dd className="fin-t-body-strong">{dataBR(dados.periodo_sugerido.inicio)} a {dataBR(dados.periodo_sugerido.corte)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Vence pela regra</dt>
              <dd className="fin-t-body-strong">{vencimentoTexto(dados.periodo_sugerido.vencimento)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Sinal pago a descontar</dt>
              <dd className="fin-t-body-strong tabular-nums">{reais(sinal)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-[var(--fin-s-2)]">
          <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" disabled={!dados} onClick={() => setMarcados(new Set(dados?.sugeridos ?? []))}>
            Marcar até o corte{corte ? ` de ${dataBR(corte).slice(0, 5)}` : ''}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" disabled={!itens.length} onClick={() => setMarcados(new Set(itens.map(i => i.conta_id)))}>Marcar todos</Button>
          <Button type="button" variant="ghost" size="sm" className="h-11 lg:h-9" disabled={!marcados.size} onClick={() => setMarcados(new Set())}>Desmarcar</Button>
        </div>
        <Segmentado<Vista>
          rotulo="Colunas"
          opcoes={[{ valor: 'essenciais', rotulo: 'Colunas essenciais' }, { valor: 'todas', rotulo: 'Todas as colunas' }]}
          valor={vista}
          onChange={setVista}
        />
      </div>

      <FilterBar
        busca={{ valor: filtro, onChange: setFiltro, placeholder: 'Buscar venda, cliente, produto, localizador ou destino' }}
        resumo={{ exibidos: visiveis.length, total: itens.length, substantivo: 'itens a faturar', soma: emReais(visiveis.reduce((a, i) => a + i.valor_a_gerar, 0)) }}
        ativos={filtro ? 1 : 0}
        onLimpar={() => setFiltro('')}
      />

      <FinTable<ItemAFaturar>
        linhas={visiveis}
        colunas={colunas}
        colunasVisiveis={vista === 'essenciais' ? COLUNAS_ESSENCIAIS : undefined}
        chave={i => i.conta_id}
        densidade="compacta"
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={setAberto}
        selecao={{
          selecionadas: marcados,
          onAlterar: (chaves, marcar) => setMarcados(m => {
            const n = new Set(m);
            for (const c of chaves) { if (marcar) n.add(c); else n.delete(c); }
            return n;
          }),
          rotulo: i => `Incluir a venda ${i.venda_numero} de ${i.cliente} na fatura`,
        }}
        vazio={filtro
          ? { motivo: 'sem-resultado', titulo: 'Nenhum item na busca', oQueE: 'Nenhum item a faturar deste fornecedor se encaixa na busca.', acaoSecundaria: { rotulo: 'Limpar busca', onClick: () => setFiltro('') } }
          : { motivo: 'sem-dado', titulo: 'Nada a faturar deste fornecedor', oQueE: 'Os itens das vendas com este fornecedor já estão em faturas ou já foram pagos.', acao: { rotulo: 'Ver faturas geradas', href: '/financeiro-ag/fornecedores/faturas?aba=geradas' } }}
      />

      {selecionados.length > 0 ? (
        <div
          role="region"
          aria-label="Itens marcados para a fatura"
          className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)] shadow-[var(--fin-e1)] sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-0.5" aria-live="polite">
            <span className="fin-t-body-strong tabular-nums">{selecionados.length} {selecionados.length === 1 ? 'item' : 'itens'} · {reais(totalSel)}</span>
            <span className={cn('fin-t-caption tabular-nums', deveSel > 0 ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-3)]')}>
              {deveSel > 0 ? `Os clientes ainda devem ${reais(deveSel)} destas vendas.` : 'Os clientes destas vendas já pagaram.'}
            </span>
          </div>
          <Button type="button" onClick={() => setPreviaAberta(true)} className="h-11 lg:h-10">Ver prévia e gerar fatura</Button>
        </div>
      ) : null}

      {aberto ? (
        <DetalheDoItem item={aberto} onFechar={() => setAberto(null)} onMudou={() => { setAberto(null); void carregar(true); }} />
      ) : null}
      {previaAberta && dados ? (
        <PreviaDaFaturaSheet
          parteId={parteId}
          contaIds={selecionados.map(i => i.conta_id)}
          corte={selecionados.every(i => i.data_base <= corte) ? corte : ''}
          onFechar={() => setPreviaAberta(false)}
          onGerada={f => { setPreviaAberta(false); toast.success(`Fatura ${f.numero} gerada`, f.valor > 0 ? `${reais(f.valor)} a pagar em ${dataBR(f.vencimento)}.` : 'O sinal cobriu tudo: não há conta a pagar.'); onGerada(f.id); }}
          onItensMudaram={() => { setPreviaAberta(false); void carregar(true); }}
        />
      ) : null}
      {regraAberta && dados ? (
        <RegraSheet regra={dados.regra} onFechar={() => setRegraAberta(false)} onSalva={() => { setRegraAberta(false); void carregar(); }} />
      ) : null}
    </div>
  );
}

// ============================================================
// Prévia e gerar
// ============================================================

function PreviaDaFaturaSheet({ parteId, contaIds, corte, onFechar, onGerada, onItensMudaram }: {
  parteId: string; contaIds: string[]; corte: string;
  onFechar: () => void; onGerada: (f: DetalheDaFatura) => void; onItensMudaram: () => void;
}) {
  const [previa, setPrevia] = React.useState<{ previa: PreviaDaFatura; assinatura: string; periodo: { inicio: string; corte: string } } | null>(null);
  const [erro, setErro] = React.useState('');
  const [vencimento, setVencimento] = React.useState('');
  const [observacoes, setObservacoes] = React.useState('');
  const [gerando, setGerando] = React.useState(false);

  const pedir = React.useCallback(async (venc: string) => {
    setErro('');
    try {
      setPrevia(await api('/api/fornecedores/faturas/previa', { metodo: 'POST', corpo: { parte_id: parteId, conta_ids: contaIds, corte: corte || undefined, vencimento: venc || undefined } }));
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === 'ITENS_MUDARAM') { toast.warning('A lista mudou', e.message); onItensMudaram(); return; }
      setErro(e instanceof Error ? e.message : 'Não foi possível montar a prévia.');
    }
  }, [parteId, contaIds, corte, onItensMudaram]);
  React.useEffect(() => { void pedir(''); }, [pedir]);

  async function gerar() {
    if (!previa) return;
    setGerando(true);
    try {
      const f = await api<DetalheDaFatura>('/api/fornecedores/faturas', {
        metodo: 'POST',
        corpo: { parte_id: parteId, conta_ids: contaIds, corte: corte || undefined, vencimento: vencimento || undefined, observacoes, assinatura: previa.assinatura },
      });
      onGerada(f);
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === 'PREVIA_MUDOU') {
        const d = e.detalhes as { previa: PreviaDaFatura; assinatura: string } | undefined;
        if (d) setPrevia(p => (p ? { ...p, previa: d.previa, assinatura: d.assinatura } : p));
        toast.warning('Os valores mudaram', 'Confira a prévia nova antes de gerar.');
      } else if (e instanceof ErroDaApi && e.codigo === 'ITENS_MUDARAM') {
        toast.warning('A lista mudou', e.message);
        onItensMudaram();
      } else {
        toast.error('A fatura não foi gerada', e instanceof Error ? e.message : undefined);
      }
    } finally {
      setGerando(false);
    }
  }

  const p = previa?.previa;
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Prévia da fatura"
      descricao={p ? `${p.parte_nome}: ${p.quantidade} ${p.quantidade === 1 ? 'item' : 'itens'} de ${p.vendas} ${p.vendas === 1 ? 'venda' : 'vendas'}.` : 'Montando a prévia…'}
      largura={640}
      resumo={p ? (p.a_pagar > 0
        ? <>Nasce uma conta a pagar de <strong>{reais(p.a_pagar)}</strong> para {dataBR(p.vencimento.data)}, e as contas destas vendas passam a ser pagas por ela.</>
        : <>O sinal cobre a fatura inteira: nenhuma conta a pagar nasce, e as vendas ficam com o fornecedor pago.</>) : null}
      acaoPrimaria={{ rotulo: 'Gerar fatura', onClick: gerar, carregando: gerando, desabilitado: !p || p.quantidade === 0 }}
    >
      {erro ? <Callout tom="negativo" titulo="Não deu para montar a prévia">{erro}</Callout> : null}
      {!p && !erro ? <div className="h-48 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" aria-label="Carregando a prévia" /> : null}
      {p && previa ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <dl className="flex flex-col">
            <LinhaDeResumo rotulo="Período">{dataBR(previa.periodo.inicio)} a {dataBR(previa.periodo.corte)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Itens">{reais(p.total_itens)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Sinal descontado">{p.total_sinal > 0 ? `− ${reais(p.total_sinal)}` : 'Nenhum'}</LinhaDeResumo>
            <LinhaDeResumo rotulo="A pagar" forte>{reais(p.a_pagar)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Vencimento">
              <span className="inline-flex items-center gap-[var(--fin-s-1)]"><CalendarClock aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />{vencimentoTexto(p.vencimento)}</span>
            </LinhaDeResumo>
          </dl>
          <ListaDeAlertas alertas={p.alertas} />
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Field rotulo="Outro vencimento" ajuda="Vazio: o da regra do fornecedor.">
              {a => (
                <Input {...a} type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} onBlur={() => { void pedir(vencimento); }}
                  className="h-11 lg:h-10" />
              )}
            </Field>
            <Field rotulo="Observação na conta" ajuda="Opcional. Vai para a conta a pagar da fatura.">
              {a => <Input {...a} value={observacoes} maxLength={500} onChange={e => setObservacoes(e.target.value)} className="h-11 lg:h-10" />}
            </Field>
          </div>
        </div>
      ) : null}
    </RecordSheet>
  );
}

// ============================================================
// Detalhe do item e a Taxa CC
// ============================================================

function DetalheDoItem({ item, onFechar, onMudou }: { item: ItemAFaturar; onFechar: () => void; onMudou: () => void }) {
  const router = useRouter();
  const [editando, setEditando] = React.useState<{ produto_id: string; lado: 'DU' | 'RAV'; valor: number } | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);

  async function salvarTaxa() {
    if (!editando) return;
    setSalvando(true);
    try {
      const r = await api<{ de: number; para: number }>('/api/fornecedores/taxa-cc', {
        metodo: 'POST', corpo: { venda_id: item.venda_id, produto_id: editando.produto_id, lado: editando.lado, valor_centavos: editando.valor, motivo },
      });
      toast.success(`Taxa CC ${editando.lado} alterada`, `De ${reais(r.de)} para ${reais(r.para)}. A conta do fornecedor foi refeita.`);
      onMudou();
    } catch (e) {
      toast.error('A Taxa CC não mudou', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Venda ${item.venda_numero} · ${item.cliente}`}
      descricao={`${item.tipos} · vendida em ${dataBR(item.data_venda)}`}
      largura={960}
      acaoPrimaria={{ rotulo: 'Abrir a venda', onClick: () => router.push(`/vendas/${encodeURIComponent(item.venda_id)}/ficha`) }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-4)] md:grid-cols-2">
          <dl className="flex flex-col">
            <LinhaDeResumo rotulo="Valor do cliente">{reais(item.valor_cliente)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Liquidado do cliente">{reais(item.liquidado_cliente)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Saldo do cliente" forte>{reais(item.saldo_cliente)}</LinhaDeResumo>
          </dl>
          <dl className="flex flex-col">
            <LinhaDeResumo rotulo="Valor do fornecedor">{reais(item.valor_fornecedor)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Já pago ao fornecedor">{reais(item.liquidado_fornecedor)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Valor a gerar" forte>{reais(item.valor_a_gerar)}</LinhaDeResumo>
          </dl>
        </div>
        <ListaDeAlertas alertas={item.alertas} />
        {item.produtos.map(p => (
          <section key={p.produto_id} className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]" aria-label={p.descricao || p.tipo}>
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
              <h3 className="fin-t-body-strong">{p.descricao || p.tipo}</h3>
              <span className="fin-t-caption text-[var(--fin-text-3)]">{[p.tipo, p.fornecedor, p.representante && `via ${p.representante}`, p.localizador, p.moeda !== 'BRL' ? p.moeda : ''].filter(Boolean).join(' · ')}</span>
            </div>
            {p.passageiros.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse fin-t-body">
                  <thead>
                    <tr className="border-b border-[var(--fin-border)] text-left">
                      {['Passageiro', 'Documento', 'Tarifa', 'Taxas', 'Taxa DU', 'RAV'].map((c, i) => (
                        <th key={c} scope="col" className={cn('fin-t-overline py-[var(--fin-s-2)] pr-[var(--fin-s-3)] text-[var(--fin-text-3)]', i > 1 && 'text-right')}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.passageiros.map((x, i) => (
                      <tr key={`${x.nome}-${i}`} className="border-b border-[var(--fin-border)] last:border-b-0">
                        <td className="py-[var(--fin-s-2)] pr-[var(--fin-s-3)]">{x.nome}</td>
                        <td className="py-[var(--fin-s-2)] pr-[var(--fin-s-3)] text-[var(--fin-text-2)]">{x.documento || '—'}</td>
                        {[x.tarifa, x.taxas, x.taxa_du, x.rav].map((v, k) => <td key={k} className="py-[var(--fin-s-2)] pr-[var(--fin-s-3)] text-right tabular-nums">{reais(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:gap-[var(--fin-s-5)]">
              {(['DU', 'RAV'] as const).map(lado => {
                const tem = lado === 'DU' ? p.tem_du : p.tem_rav;
                const valor = lado === 'DU' ? p.taxa_cc_du : p.taxa_cc_rav;
                return (
                  <div key={lado} className="flex items-center gap-[var(--fin-s-2)]">
                    <span className="fin-t-body text-[var(--fin-text-2)]">Taxa CC {lado}</span>
                    <span className="fin-t-body-strong tabular-nums">{tem ? reais(valor) : '—'}</span>
                    {tem && item.pode_alterar_taxa_cc ? (
                      <Button type="button" variant="link" className="h-auto px-0" onClick={() => { setEditando({ produto_id: p.produto_id, lado, valor }); setMotivo(''); }}>Alterar</Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {editando && editando.produto_id === p.produto_id ? (
              <div className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)]">
                <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-[200px_1fr]">
                  <Field rotulo={`Nova Taxa CC ${editando.lado}`} ajuda={`Até o valor da ${editando.lado === 'DU' ? 'Taxa DU' : 'RAV'} do produto.`}>
                    {a => <CampoReais id={a.id} rotulo={`Nova Taxa CC ${editando.lado}`} centavos={editando.valor} onChange={v => setEditando(x => (x ? { ...x, valor: v } : x))} />}
                  </Field>
                  <Field rotulo="Motivo" obrigatorio ajuda="Fica no histórico da venda.">
                    {a => <Textarea {...a} rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: a operadora cobrou a taxa no cartão do cliente" />}
                  </Field>
                </div>
                <div className="flex justify-end gap-[var(--fin-s-2)]">
                  <Button type="button" variant="ghost" onClick={() => setEditando(null)} disabled={salvando} className="h-11 lg:h-10">Cancelar</Button>
                  <Button type="button" onClick={() => { void salvarTaxa(); }} disabled={salvando || motivo.trim().length < 10} className="h-11 lg:h-10">
                    {salvando ? 'Salvando…' : 'Salvar Taxa CC'}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ))}
        {!item.pode_alterar_taxa_cc && item.produtos.some(p => p.tem_du || p.tem_rav) ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">A Taxa CC só muda com a venda aberta. Reabra a venda para mudar.</p>
        ) : null}
      </div>
    </RecordSheet>
  );
}

// ============================================================
// Regra de faturamento (com a prévia das próximas 3 faturas)
// ============================================================

const DIAS = Array.from({ length: 31 }, (_, i) => i + 1);

function RegraSheet({ regra, onFechar, onSalva }: { regra: RegraDoFornecedor; onFechar: () => void; onSalva: () => void }) {
  const [r, setR] = React.useState<RegraDeFaturamento>(regra.regra);
  const [salvando, setSalvando] = React.useState(false);
  const proximas: PeriodoDaFatura[] = React.useMemo(() => proximasFaturas(hojeNoBrasil(), normalizarRegra(r), 3), [r]);
  const sujo = JSON.stringify(r) !== JSON.stringify(regra.regra);
  async function salvar() {
    setSalvando(true);
    try {
      await api(`/api/fornecedores/regra-faturamento?parte_id=${encodeURIComponent(regra.parte_id)}`, { metodo: 'PUT', corpo: r });
      toast.success('Regra salva', 'As próximas faturas deste fornecedor seguem a regra nova.');
      onSalva();
    } catch (e) {
      toast.error('A regra não foi salva', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }
  const dia = (v: number) => (v >= 31 ? 'Último dia do mês' : `Dia ${v}`);
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Regra de faturamento · ${regra.nome}`}
      descricao="Quando a fatura deste fornecedor fecha e quando vence."
      largura={640}
      sujo={sujo}
      resumo={descreverRegra(r)}
      acaoPrimaria={{ rotulo: 'Salvar regra', onClick: salvar, carregando: salvando, desabilitado: !sujo }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <Field rotulo="Dia do corte" ajuda="Os itens até este dia entram na fatura.">
            {a => <select {...a} className={SELECT} value={r.dia_corte} onChange={e => setR(x => ({ ...x, dia_corte: Number(e.target.value) }))}>{DIAS.map(d => <option key={d} value={d}>{dia(d)}</option>)}</select>}
          </Field>
          <Field rotulo="Dia do vencimento" ajuda="Depois do corte: no mesmo mês, se vier depois; senão, no seguinte.">
            {a => <select {...a} className={SELECT} value={r.dia_vencimento} onChange={e => setR(x => ({ ...x, dia_vencimento: Number(e.target.value) }))}>{DIAS.map(d => <option key={d} value={d}>{dia(d)}</option>)}</select>}
          </Field>
          <Field rotulo="Vencimento sem expediente" ajuda="Fim de semana e feriado nacional.">
            {a => (
              <select {...a} className={SELECT} value={r.ajuste_vencimento} onChange={e => setR(x => ({ ...x, ajuste_vencimento: e.target.value as AjusteDoVencimento }))}>
                {(Object.keys(ROTULO_AJUSTE) as AjusteDoVencimento[]).map(k => <option key={k} value={k}>{ROTULO_AJUSTE[k]}</option>)}
              </select>
            )}
          </Field>
          <Field rotulo="Data que decide o período" ajuda="Sem a data da viagem, vale a da venda.">
            {a => (
              <select {...a} className={SELECT} value={r.data_base} onChange={e => setR(x => ({ ...x, data_base: e.target.value as DataBaseDaFatura }))}>
                {(Object.keys(ROTULO_DATA_BASE) as DataBaseDaFatura[]).map(k => <option key={k} value={k}>{ROTULO_DATA_BASE[k]}</option>)}
              </select>
            )}
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] hover:bg-[var(--fin-surface-2)]">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={r.gerar_sozinha} onChange={e => setR(x => ({ ...x, gerar_sozinha: e.target.checked }))} />
          <span className="flex flex-col gap-0.5">
            <span className="fin-t-body-strong">Montar a fatura sozinha no dia seguinte ao corte</span>
            <span className="fin-t-caption text-[var(--fin-text-2)]">Com os itens até o corte e o sinal já descontado. Sem esta opção, o sino avisa que a fatura está pronta para montar.</span>
          </span>
        </label>
        <section aria-labelledby="t-proximas" className="flex flex-col gap-[var(--fin-s-2)]">
          <h3 id="t-proximas" className="fin-t-body-strong">Próximas faturas</h3>
          <ol className="flex flex-col">
            {proximas.map(p => (
              <li key={p.corte} className="flex flex-col gap-0.5 border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0 sm:flex-row sm:justify-between">
                <span className="fin-t-body">{dataBR(p.inicio)} a {dataBR(p.corte)}</span>
                <span className="fin-t-body-strong">vence {vencimentoTexto(p.vencimento)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </RecordSheet>
  );
}

// ============================================================
// Faturas geradas
// ============================================================

function FaturasGeradas({ faturaId, onAbrir }: { faturaId: string; onAbrir: (id: string) => void }) {
  const [faturas, setFaturas] = React.useState<FaturaResumo[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [filtro, setFiltro] = React.useState('');
  const [situacao, setSituacao] = React.useState('GERADA');
  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      setFaturas((await api<{ faturas: FaturaResumo[] }>(`/api/fornecedores/faturas${situacao ? `?situacao=${situacao}` : ''}`)).faturas);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, [situacao]);
  React.useEffect(() => { void carregar(); }, [carregar]);
  const visiveis = faturas.filter(f => !filtro || `${f.numero} ${f.parte_nome}`.toLowerCase().includes(filtro.toLowerCase()));
  const colunas: FinColuna<FaturaResumo>[] = [
    { id: 'numero', cabecalho: 'Fatura', tipo: 'texto', sortable: true, acessor: f => f.numero,
      render: f => <span className="flex flex-col"><span className="fin-t-body-strong">{f.numero}</span>{f.automatica ? <span className="fin-t-caption text-[var(--fin-text-3)]">montada sozinha</span> : null}</span> },
    { id: 'parte', cabecalho: 'Fornecedor', tipo: 'texto', sortable: true, acessor: f => f.parte_nome, render: f => f.parte_nome, minWidth: 180 },
    { id: 'periodo', cabecalho: 'Período', tipo: 'texto', sortable: true, acessor: f => f.corte, render: f => `${dataBR(f.periodo_inicio)} a ${dataBR(f.corte)}`, prioridade: 2 },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: f => f.vencimento },
    { id: 'itens', cabecalho: 'Itens', tipo: 'texto', sortable: true, acessor: f => f.itens, render: f => `${f.itens} de ${f.vendas} ${f.vendas === 1 ? 'venda' : 'vendas'}`, prioridade: 1 },
    { id: 'valor_itens', cabecalho: 'Itens', tipo: 'dinheiro', sortable: true, valor: f => emReais(f.valor_itens), prioridade: 1 },
    { id: 'sinal', cabecalho: 'Sinal', tipo: 'dinheiro', sortable: true, valor: f => emReais(f.sinal), prioridade: 1 },
    { id: 'valor', cabecalho: 'A pagar', tipo: 'dinheiro', sortable: true, valor: f => emReais(f.valor) },
    { id: 'pagamento', cabecalho: 'Situação', tipo: 'texto', sortable: true, acessor: f => f.pagamento,
      render: f => <Pilula tom={ROTULO_PAGAMENTO[f.pagamento].tom}>{ROTULO_PAGAMENTO[f.pagamento].rotulo}</Pilula> },
  ];
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <FilterBar
        busca={{ valor: filtro, onChange: setFiltro, placeholder: 'Buscar fatura ou fornecedor' }}
        selects={[{ id: 'situacao', rotulo: 'Situação', valor: situacao || 'TODAS', opcoes: [{ valor: 'GERADA', rotulo: 'Valendo' }, { valor: 'DESFEITA', rotulo: 'Desfeitas' }, { valor: 'TODAS', rotulo: 'Todas' }], onChange: v => setSituacao(v === 'TODAS' ? '' : v) }]}
        resumo={{ exibidos: visiveis.length, total: faturas.length, substantivo: 'faturas', soma: emReais(visiveis.reduce((a, f) => a + f.valor, 0)) }}
        ativos={(filtro ? 1 : 0) + (situacao !== 'GERADA' ? 1 : 0)}
        onLimpar={() => { setFiltro(''); setSituacao('GERADA'); }}
      />
      <FinTable<FaturaResumo>
        linhas={visiveis}
        colunas={colunas}
        chave={f => f.id}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={f => onAbrir(f.id)}
        vazio={filtro
          ? { motivo: 'sem-resultado', titulo: 'Nenhuma fatura na busca', oQueE: 'Nenhuma fatura se encaixa na busca.', acaoSecundaria: { rotulo: 'Limpar busca', onClick: () => setFiltro('') } }
          : { motivo: 'sem-dado', titulo: 'Nenhuma fatura de fornecedor ainda', oQueE: 'As faturas montadas aparecem aqui, com o que já foi pago de cada uma.', acao: { rotulo: 'Ver o que está a faturar', href: '/financeiro-ag/fornecedores/faturas' } }}
      />
      {faturaId ? <DetalheDaFaturaSheet id={faturaId} onFechar={() => onAbrir('')} onMudou={() => { void carregar(); }} /> : null}
    </div>
  );
}

function DetalheDaFaturaSheet({ id, onFechar, onMudou }: { id: string; onFechar: () => void; onMudou: () => void }) {
  const [f, setF] = React.useState<DetalheDaFatura | null>(null);
  const [erro, setErro] = React.useState('');
  const [desfazendo, setDesfazendo] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const carregar = React.useCallback(async () => {
    try { setF(await api<DetalheDaFatura>(`/api/fornecedores/faturas/${encodeURIComponent(id)}`)); } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível abrir.'); }
  }, [id]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  async function desfazer() {
    setEnviando(true);
    try {
      setF(await api<DetalheDaFatura>(`/api/fornecedores/faturas/${encodeURIComponent(id)}/desfazer`, { metodo: 'POST', corpo: { motivo } }));
      setDesfazendo(false);
      toast.success('Fatura desfeita', 'Os itens voltaram para "A faturar" e o sinal voltou a ficar disponível.');
      onMudou();
    } catch (e) {
      toast.error('A fatura não foi desfeita', e instanceof Error ? e.message : undefined);
    } finally {
      setEnviando(false);
    }
  }

  const podeDesfazer = f && f.situacao === 'GERADA' && (f.pagamento === 'EM_ABERTO' || f.pagamento === 'VENCIDA' || (f.pagamento === 'PAGA' && f.valor === 0));
  if (desfazendo && f) {
    return (
      <RecordSheet
        aberto
        onOpenChange={a => { if (!a) setDesfazendo(false); }}
        titulo={`Desfazer a fatura ${f.numero}`}
        descricao="Os itens voltam para as vendas e entram na próxima fatura. Nada é apagado: a fatura fica registrada como desfeita."
        largura={480}
        sujo={motivo.length > 0}
        acaoPrimaria={{ rotulo: 'Desfazer fatura', onClick: desfazer, carregando: enviando, desabilitado: motivo.trim().length < 10 }}
      >
        <Field rotulo="Motivo" obrigatorio ajuda="Pelo menos 10 letras. Fica registrado na fatura.">
          {a => <Textarea {...a} rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: o fornecedor mandou a fatura com outro período" />}
        </Field>
      </RecordSheet>
    );
  }
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={f ? `Fatura ${f.numero} · ${f.parte_nome}` : 'Fatura do fornecedor'}
      descricao={f ? `Período de ${dataBR(f.periodo_inicio)} a ${dataBR(f.corte)} · gerada por ${f.criada_por || '—'} em ${quandoBR(f.criada_em)}` : undefined}
      largura={960}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={podeDesfazer ? { rotulo: 'Desfazer fatura', onClick: () => { setMotivo(''); setDesfazendo(true); } } : null}
    >
      {erro ? <Callout tom="negativo" titulo="Não deu para abrir a fatura">{erro}</Callout> : null}
      {!f && !erro ? <div className="h-64 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" aria-label="Carregando a fatura" /> : null}
      {f ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <div className="grid grid-cols-1 gap-[var(--fin-s-4)] md:grid-cols-2">
            <dl className="flex flex-col">
              <LinhaDeResumo rotulo="Itens">{reais(f.valor_itens)}</LinhaDeResumo>
              <LinhaDeResumo rotulo="Sinal descontado">{f.sinal ? `− ${reais(f.sinal)}` : 'Nenhum'}</LinhaDeResumo>
              <LinhaDeResumo rotulo="A pagar" forte>{reais(f.valor)}</LinhaDeResumo>
            </dl>
            <dl className="flex flex-col">
              <LinhaDeResumo rotulo="Vencimento">{vencimentoTexto({ data: f.vencimento, pela_regra: f.vencimento_pela_regra || f.vencimento, motivo_ajuste: f.motivo_ajuste || null })}</LinhaDeResumo>
              <LinhaDeResumo rotulo="Pago (com o sinal)">{reais(f.pago)}</LinhaDeResumo>
              <LinhaDeResumo rotulo="Situação"><Pilula tom={ROTULO_PAGAMENTO[f.pagamento].tom}>{ROTULO_PAGAMENTO[f.pagamento].rotulo}</Pilula></LinhaDeResumo>
            </dl>
          </div>
          {f.situacao === 'DESFEITA' ? (
            <Callout tom="info" titulo="Fatura desfeita">{`Por ${f.desfeita_por || '—'} em ${quandoBR(f.desfeita_em)}: ${f.motivo_desfazer}`}</Callout>
          ) : null}
          {f.situacao === 'GERADA' && f.conta_pagar_id ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              O pagamento é pela conta a pagar {f.numero}, em <Link className={LINK} href="/financeiro-ag/pagar">Contas a pagar</Link>. Para desfazer uma fatura já paga, estorne o pagamento antes.
            </p>
          ) : null}
          {f.compensacoes.length ? (
            <section aria-labelledby="t-sinais" className="flex flex-col gap-[var(--fin-s-2)]">
              <h3 id="t-sinais" className="fin-t-body-strong">Sinal descontado</h3>
              <ul className="flex flex-col">
                {f.compensacoes.map(c => (
                  <li key={c.sinal_id} className="flex justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0 fin-t-body">
                    <span>{c.sinal_descricao || 'Sinal'} de {dataBR(c.sinal_data)}{c.desfeita ? ' (devolvido ao sinal)' : ''}</span>
                    <span className="tabular-nums">{reais(c.valor_centavos)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <FinTable<ItemAFaturar>
            linhas={f.linhas}
            colunas={colunasDosItens()}
            colunasVisiveis={['venda', 'cliente', 'produto', 'valor_cliente', 'liquidado_cliente', 'saldo_cliente', 'saldo_fornecedor']}
            chave={i => i.conta_id}
            densidade="compacta"
            estado="ok"
            vazio={{ motivo: 'sem-dado', titulo: 'Sem itens', oQueE: 'Esta fatura não tem itens.' }}
          />
        </div>
      ) : null}
    </RecordSheet>
  );
}
