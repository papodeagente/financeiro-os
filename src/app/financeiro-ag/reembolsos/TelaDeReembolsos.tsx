'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDownLeft, ArrowUpRight, Ban, CircleCheck, Clock, Ellipsis, ExternalLink, Plus, ReceiptText, Undo2, Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { StatusChip } from '@/components/fin/StatusChip';
import { resolverPeriodo, type PeriodoChave } from '@/components/fin/PeriodPicker';
import { MenuDaLinha, type ItemDoMenu } from '@/app/financeiro-ag/contas/MenuDaLinha';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { CampoReais, CONTROLE, SELECT } from '@/components/vendas/ficha/comum';
import { loadEntities } from '@/lib/crm-storage';
import { consumirAtalho, lerAtalhos } from '@/lib/atalho-da-url';
import { addDias, deCentavos, hojeISO } from '@/lib/money';
import type { ListaDeReembolsos, Reembolso, TipoDeReembolso } from '@/lib/reembolsos-servidor';
import { documentoDosReembolsos } from '@/lib/exportacao/reembolsos-e-creditos';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Reembolsos (E5, parte D): o que a agência devolve aos clientes e o que os
 * fornecedores devolvem à agência, com situação e prazo. Aprovar gera a
 * conta certa (a pagar ao cliente, a receber do fornecedor); pagar é a baixa
 * de sempre, na própria conta, e o reembolso fica "Pago" sozinho. O
 * reembolso ao cliente também pode virar crédito para a próxima viagem.
 *
 * Mesmo jeito das outras listas: período (pelo prazo), filtros, Esc limpa,
 * clique direito (ou "…") mostra as ações, gravar sempre pede confirmação.
 */

const PERIODOS: PeriodoChave[] = ['TUDO', 'MES_ATUAL', 'PROX_30', 'MES_PASSADO', 'PERSONALIZADO'];
type FiltroSituacao = 'em_andamento' | 'todas' | 'SOLICITADO' | 'APROVADO' | 'PAGO' | 'CANCELADO';
/** Os três sentidos, do ponto de vista da agência. */
type Sentido = 'CLIENTE' | 'DO_FORNECEDOR' | 'AO_FORNECEDOR';
const ROTULO_SENTIDO: Record<Sentido, string> = { CLIENTE: 'Ao cliente', DO_FORNECEDOR: 'Do fornecedor', AO_FORNECEDOR: 'Ao fornecedor' };
const sentidoDe = (r: Pick<Reembolso, 'tipo' | 'sentido'>): Sentido =>
  r.tipo === 'CLIENTE' ? 'CLIENTE' : r.sentido === 'PAGAR' ? 'AO_FORNECEDOR' : 'DO_FORNECEDOR';
/** A agência paga (ao cliente ou ao fornecedor): a conta gerada é a pagar. */
const agenciaPaga = (r: Pick<Reembolso, 'tipo' | 'sentido'>) => sentidoDe(r) !== 'DO_FORNECEDOR';

type Filtros = { periodo: PeriodoChave; de: string; ate: string; tipo: '' | Sentido; situacao: FiltroSituacao; busca: string };
const TODOS = '__todos__';

function filtrosPadrao(): Filtros {
  return { periodo: 'TUDO', de: '', ate: '', tipo: '', situacao: 'em_andamento', busca: '' };
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const reais = (c: number) => formatBRL(deCentavos(c));

async function mudar(id: string, corpo: Record<string, unknown>): Promise<Reembolso> {
  const r = await fetch(`/api/reembolsos/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j?.error ?? 'Não deu certo. Tente de novo.'));
  return j as Reembolso;
}

type Acao = { tipo: 'aprovar' | 'cancelar' | 'credito'; r: Reembolso };

export function TelaDeReembolsos() {
  const router = useRouter();
  const pode = usePermissoes();
  const moldura = React.useRef<HTMLDivElement>(null);
  const [f, setF] = React.useState<Filtros>(filtrosPadrao);
  const [dados, setDados] = React.useState<ListaDeReembolsos | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [menu, setMenu] = React.useState<{ r: Reembolso; posicao: { x: number; y: number } } | null>(null);
  const [acao, setAcao] = React.useState<Acao | null>(null);
  const [detalhe, setDetalhe] = React.useState<Reembolso | null>(null);
  const [novo, setNovo] = React.useState(false);
  const [prazo, setPrazo] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const [processando, setProcessando] = React.useState(false);

  const busca = useDebounce(f.busca.trim());
  const datasValidas = !f.de || !f.ate || f.de <= f.ate;

  React.useEffect(() => {
    if (!datasValidas) return;
    const ac = new AbortController();
    setCarregando(true);
    const q = new URLSearchParams();
    if (f.tipo) {
      q.set('tipo', f.tipo === 'CLIENTE' ? 'CLIENTE' : 'FORNECEDOR');
      if (f.tipo !== 'CLIENTE') q.set('sentido', f.tipo === 'AO_FORNECEDOR' ? 'PAGAR' : 'RECEBER');
    }
    if (f.situacao !== 'todas') q.set('situacao', f.situacao);
    if (f.de) q.set('de', f.de);
    if (f.ate) q.set('ate', f.ate);
    if (busca) q.set('busca', busca);
    fetch(`/api/reembolsos?${q}`, { signal: ac.signal })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'A consulta não respondeu.'); return j as ListaDeReembolsos; })
      .then(j => { setDados(j); setErro(null); setAtualizadoEm(new Date()); })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'A consulta não respondeu.'); })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [f.tipo, f.situacao, f.de, f.ate, busca, datasValidas, versao]);

  // ?abrir=<id> (link do sino): abre o reembolso.
  React.useEffect(() => {
    const abrir = lerAtalhos().get('abrir');
    if (!abrir) return;
    consumirAtalho('abrir');
    fetch(`/api/reembolsos/${encodeURIComponent(abrir)}`).then(r => (r.ok ? r.json() : null)).then(j => { if (j) setDetalhe(j as Reembolso); }).catch(() => undefined);
  }, []);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);
  const padrao = filtrosPadrao();
  const ativos = (f.periodo !== padrao.periodo ? 1 : 0) + (f.tipo ? 1 : 0) + (f.situacao !== padrao.situacao ? 1 : 0) + (f.busca ? 1 : 0);
  const limpar = React.useCallback(() => setF(filtrosPadrao()), []);
  const mudarFiltro = (patch: Partial<Filtros>) => setF(atual => ({ ...atual, ...patch }));
  const podeCuidar = pode('cuidar_reembolsos');
  const podeCredito = pode('usar_credito_cliente');

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || menu || acao || detalhe || novo) return;
    if (!moldura.current?.contains(e.target as Node)) return;
    if (ativos > 0) { e.preventDefault(); limpar(); }
  }

  const abrirConta = (r: Reembolso) => router.push(`/financeiro-ag/${r.conta_tabela === 'contas_pagar' ? 'pagar' : 'receber'}?abrir=${encodeURIComponent(r.conta_id)}`);

  function itensDoMenu(r: Reembolso): ItemDoMenu[] {
    const andamento = r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO';
    const semDireito = podeCuidar ? null : 'Seu acesso não inclui cuidar de reembolsos.';
    return [
      { id: 'ver', rotulo: 'Ver detalhes e histórico', icone: ReceiptText, atalho: 'Enter', onEscolher: () => setDetalhe(r) },
      { id: 'aprovar', rotulo: agenciaPaga(r) ? 'Aprovar e gerar a conta a pagar' : 'Aprovar e gerar a conta a receber', icone: CircleCheck,
        desabilitado: semDireito ?? (r.situacao === 'SOLICITADO' ? null : 'Só se aprova reembolso solicitado.'), onEscolher: () => { setPrazo(r.prazo); setAcao({ tipo: 'aprovar', r }); } },
      { id: 'pagar', rotulo: agenciaPaga(r) ? 'Registrar o pagamento na conta' : 'Registrar o recebimento na conta', icone: Wallet,
        desabilitado: r.situacao === 'APROVADO' && r.conta_id ? null : 'Aprove antes: o pagamento é dado na conta gerada.', onEscolher: () => abrirConta(r) },
      ...(r.tipo === 'CLIENTE' ? [{ id: 'credito', rotulo: 'Transformar em crédito do cliente', icone: Undo2,
        desabilitado: (podeCredito ? null : 'Seu acesso não inclui crédito do cliente.') ?? (andamento ? null : 'Este reembolso já foi pago ou cancelado.'), onEscolher: () => setAcao({ tipo: 'credito', r }) }] : []),
      ...(r.venda_id ? [{ id: 'venda', rotulo: `Abrir a venda ${r.venda_numero}`, icone: ExternalLink, onEscolher: () => router.push(`/vendas/${encodeURIComponent(r.venda_id)}/ficha`) }] : []),
      { id: 'cancelar', rotulo: 'Cancelar reembolso', icone: Ban, destrutivo: true,
        desabilitado: semDireito ?? (andamento ? null : 'Este reembolso já foi pago ou cancelado.'), onEscolher: () => { setMotivo(''); setAcao({ tipo: 'cancelar', r }); } },
    ];
  }

  async function confirmarAcao() {
    if (!acao) return;
    setProcessando(true);
    try {
      if (acao.tipo === 'aprovar') {
        await mudar(acao.r.id, { acao: 'aprovar', prazo });
        toast.success('Reembolso aprovado', {
          CLIENTE: 'A conta a pagar ao cliente já está nas contas, com vencimento no prazo.',
          DO_FORNECEDOR: 'A conta a receber do fornecedor já está nas contas, com vencimento no prazo.',
          AO_FORNECEDOR: 'A conta a pagar ao fornecedor já está nas contas, com vencimento no prazo.',
        }[sentidoDe(acao.r)]);
      } else if (acao.tipo === 'cancelar') {
        if (motivo.trim().length < 5) { toast.error('Diga o motivo', 'Pelo menos 5 letras: fica no histórico do reembolso.'); return; }
        await mudar(acao.r.id, { acao: 'cancelar', motivo });
        toast.success('Reembolso cancelado', acao.r.conta_id ? 'A conta em aberto foi cancelada junto.' : undefined);
      } else {
        await mudar(acao.r.id, { acao: 'converter_em_credito' });
        toast.success('Virou crédito do cliente', `${reais(acao.r.valor_centavos)} na carteira de ${acao.r.pessoa_nome}, para a próxima viagem.`);
      }
      setAcao(null);
      setDetalhe(null);
      void recarregar();
    } catch (e) {
      toast.error('Não deu certo', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  const colunas: FinColuna<Reembolso>[] = [
    { id: 'prazo', cabecalho: 'Prazo', tipo: 'data', sortable: true, valor: r => r.prazo || null },
    {
      id: 'pessoa', cabecalho: 'Para quem / de quem', tipo: 'texto', sortable: true, minWidth: 220, acessor: r => r.pessoa_nome.toLowerCase(),
      render: r => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]" title={r.pessoa_nome}>{r.pessoa_nome || '—'}</span>
          {r.descricao ? <span className="max-w-[48ch] truncate fin-t-caption text-[var(--fin-text-3)]" title={r.descricao}>{r.descricao}</span> : null}
        </span>
      ),
    },
    {
      id: 'tipo', cabecalho: 'Sentido', tipo: 'texto', minWidth: 130, prioridade: 2,
      render: r => (
        <span className="inline-flex items-center gap-1.5 text-[var(--fin-text)]">
          {agenciaPaga(r)
            ? <ArrowUpRight aria-hidden="true" className="size-3.5 text-[var(--fin-negative-text)]" />
            : <ArrowDownLeft aria-hidden="true" className="size-3.5 text-[var(--fin-positive)]" />}
          {ROTULO_SENTIDO[sentidoDe(r)]}
        </span>
      ),
    },
    {
      id: 'venda', cabecalho: 'Venda', tipo: 'texto', minWidth: 110, prioridade: 1, acessor: r => r.venda_numero,
      render: r => r.venda_id
        ? <Link href={`/vendas/${encodeURIComponent(r.venda_id)}/ficha`} onClick={e => e.stopPropagation()} className="tabular-nums text-[var(--fin-accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]">{r.venda_numero || 'Abrir'}</Link>
        : <span className="text-[var(--fin-text-3)]">—</span>,
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, valor: r => (r.atrasado ? 'ATRASADO' : r.situacao), dominio: 'reembolso' },
    {
      id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: r => deCentavos(r.valor_centavos),
      tone: r => (r.situacao === 'PAGO' ? 'positivo' : r.atrasado ? 'negativo' : 'neutro'),
      sub: r => (r.situacao === 'PAGO' ? (r.credito_id ? 'virou crédito' : r.pago_em ? `pago em ${dataBR(r.pago_em)}` : null) : r.situacao === 'CANCELADO' && r.motivo_cancelamento ? r.motivo_cancelamento.slice(0, 40) : null),
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: r => (
        <span className="inline-flex items-center justify-end gap-1">
          {r.situacao === 'SOLICITADO' && podeCuidar ? (
            <Button type="button" variant="outline" size="sm" className="h-8 max-lg:h-11" onClick={e => { e.stopPropagation(); setPrazo(r.prazo); setAcao({ tipo: 'aprovar', r }); }}>Aprovar</Button>
          ) : null}
          <button
            type="button" aria-label={`Ações do reembolso de ${r.pessoa_nome}`} aria-haspopup="menu"
            onClick={e => { e.stopPropagation(); const c = e.currentTarget.getBoundingClientRect(); setMenu({ r, posicao: { x: c.right - 8, y: c.bottom + 4 } }); }}
            className="inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] max-lg:size-11"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </button>
        </span>
      ),
    },
  ];

  const t = dados?.totais;
  const numeros = dados ? 'ok' : carregando ? 'carregando' : 'indisponivel';
  const linhas = dados?.reembolsos ?? [];
  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <div ref={moldura} onKeyDown={teclado} className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={Undo2}
          titulo="Reembolsos"
          subtitulo="O que a agência devolve a clientes e fornecedores, e o que os fornecedores devolvem a ela. Aprovar gera a conta; pagar é a baixa de sempre, na própria conta."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeCuidar ? { rotulo: 'Lançar reembolso', icone: Plus, onClick: () => setNovo(true) } : undefined}
          acoesSecundarias={[{ rotulo: 'Crédito do cliente', href: '/financeiro-ag/creditos' }]}
        />

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard rotulo="A devolver aos clientes" icone={ArrowUpRight} valor={t ? deCentavos(t.a_devolver_ao_cliente) : null} estado={numeros} tomDoIcone="negativo"
            contexto="Solicitados e aprovados ainda não pagos, no filtro." />
          <MetricCard rotulo="A receber dos fornecedores" icone={ArrowDownLeft} valor={t ? deCentavos(t.a_receber_do_fornecedor) : null} estado={numeros} tomDoIcone="positivo"
            contexto={t && t.a_pagar_ao_fornecedor > 0
              ? `O que os fornecedores ainda devem devolver, no filtro. A agência deve devolver a fornecedores ${reais(t.a_pagar_ao_fornecedor)}.`
              : 'O que os fornecedores ainda devem devolver, no filtro.'} />
          <MetricCard rotulo="Prazo vencido" icone={Clock} valor={t?.atrasados ?? null} formato="contagem" estado={numeros} tone={t && t.atrasados > 0 ? 'negativo' : 'neutro'} tomDoIcone="aviso"
            contexto="Reembolsos em andamento que passaram do prazo combinado." />
          <MetricCard rotulo="Pagos" icone={Wallet} valor={t ? deCentavos(t.pagos_no_periodo) : null} estado={numeros} tone="positivo" tomDoIcone="positivo"
            contexto="Já devolvidos ou recebidos, no filtro (inclui os que viraram crédito)." />
        </div>

        <FilterBar
          busca={{ valor: f.busca, onChange: v => mudarFiltro({ busca: v }), placeholder: 'Pesquisar pessoa, venda ou descrição…' }}
          periodo={{
            valor: f.periodo, de: f.de, ate: f.ate, opcoes: PERIODOS,
            onChange: (chave, range) => mudarFiltro({ periodo: chave, de: chave === 'TUDO' ? '' : range.de, ate: chave === 'TUDO' ? '' : range.ate }),
          }}
          selects={[
            {
              id: 'reemb-situacao', rotulo: 'Situação', valor: f.situacao, onChange: v => mudarFiltro({ situacao: v as FiltroSituacao }),
              opcoes: [
                { valor: 'em_andamento', rotulo: 'Em andamento (solicitados e aprovados)' }, { valor: 'todas', rotulo: 'Todas' },
                { valor: 'SOLICITADO', rotulo: 'Solicitados' }, { valor: 'APROVADO', rotulo: 'Aprovados' }, { valor: 'PAGO', rotulo: 'Pagos' }, { valor: 'CANCELADO', rotulo: 'Cancelados' },
              ],
            },
            {
              id: 'reemb-tipo', rotulo: 'Sentido', valor: f.tipo || TODOS, onChange: v => mudarFiltro({ tipo: v === TODOS ? '' : v as Sentido }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos' }, { valor: 'CLIENTE', rotulo: 'Ao cliente' }, { valor: 'DO_FORNECEDOR', rotulo: 'Do fornecedor' }, { valor: 'AO_FORNECEDOR', rotulo: 'Ao fornecedor' }],
            },
          ]}
          resumo={{ exibidos: linhas.length, total: linhas.length, substantivo: linhas.length === 1 ? 'reembolso' : 'reembolsos' }}
          ativos={ativos}
          onLimpar={limpar}
        />
        {!datasValidas ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p> : null}
        <div className="flex justify-end">
          <BotaoExportar
            origem="reembolsos"
            podeExportar={pode('exportar')}
            desabilitado={!linhas.length}
            documento={() => documentoDosReembolsos(linhas, { de: f.de, ate: f.ate, tipo: f.tipo, situacao: f.situacao, busca })}
          />
        </div>

        <FinTable<Reembolso>
          linhas={linhas}
          colunas={colunas}
          chave={r => r.id}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          vazio={ativos > 0
            ? { motivo: 'sem-resultado', titulo: 'Nenhum reembolso neste filtro', oQueE: 'Os reembolsos continuam guardados; o recorte atual é que não encontrou nenhum.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar } }
            : {
              motivo: 'sem-dado', titulo: 'Nenhum reembolso em andamento',
              oQueE: 'Aqui aparecem as devoluções ao cliente e as do fornecedor à agência, com o prazo de cada uma.',
              comoComeca: [
                'Ao cancelar um passageiro ou produto na venda, o que o cliente já pagou a mais vira reembolso (ou crédito, se você escolher).',
                'O que a agência pagou a mais ao fornecedor vira reembolso do fornecedor sozinho.',
                'Aprove para gerar a conta; a baixa da conta deixa o reembolso pago.',
              ],
              acao: podeCuidar ? { rotulo: 'Lançar reembolso', onClick: () => setNovo(true) } : undefined,
            }}
          totais={linhas.length && t ? [{ colunaId: 'valor', valor: deCentavos(linhas.filter(r => r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO').reduce((a, r) => a + r.valor_centavos, 0)), rotulo: 'Em andamento no filtro' }] : undefined}
          onLinhaClick={r => setDetalhe(r)}
          onLinhaMenu={(r, posicao) => setMenu({ r, posicao })}
        />
        {carregando && dados ? <span className="sr-only" role="status">Atualizando a lista.</span> : null}
      </div>

      <MenuDaLinha
        aberto={Boolean(menu)}
        posicao={menu?.posicao ?? { x: 0, y: 0 }}
        titulo={menu ? `${menu.r.pessoa_nome} · ${reais(menu.r.valor_centavos)}` : ''}
        itens={menu ? itensDoMenu(menu.r) : []}
        onFechar={() => setMenu(null)}
      />

      <ConfirmDialog
        aberto={acao !== null}
        onOpenChange={a => { if (!a) setAcao(null); }}
        titulo={acao?.tipo === 'aprovar' ? 'Aprovar o reembolso' : acao?.tipo === 'cancelar' ? 'Cancelar o reembolso' : 'Transformar em crédito do cliente'}
        oQueVaiAcontecer={!acao ? '' : acao.tipo === 'aprovar'
          ? (agenciaPaga(acao.r)
            ? `Nasce uma conta a pagar de ${reais(acao.r.valor_centavos)} para ${acao.r.pessoa_nome}, vencendo no prazo. Quando ela for paga, o reembolso fica pago.`
            : `Nasce uma conta a receber de ${reais(acao.r.valor_centavos)} de ${acao.r.pessoa_nome}, vencendo no prazo. Quando ela for recebida, o reembolso fica pago.`)
          : acao.tipo === 'cancelar'
            ? `O reembolso deixa de valer${acao.r.conta_id ? ' e a conta gerada, ainda em aberto, é cancelada junto' : ''}. O motivo fica no histórico.`
            : `Em vez de dinheiro, ${reais(acao.r.valor_centavos)} entram na carteira de crédito de ${acao.r.pessoa_nome}, para usar na próxima venda.${acao.r.conta_id ? ' A conta a pagar gerada é cancelada.' : ''} O reembolso fica pago.`}
        detalhes={acao ? [
          { rotulo: acao.r.tipo === 'CLIENTE' ? 'Cliente' : 'Fornecedor', valor: acao.r.pessoa_nome },
          { rotulo: 'Valor', valor: reais(acao.r.valor_centavos) },
          ...(acao.r.venda_numero ? [{ rotulo: 'Venda', valor: acao.r.venda_numero }] : []),
        ] : undefined}
        previa={acao?.tipo === 'aprovar' ? (
          <Field rotulo="Prazo" ajuda="Vencimento da conta gerada.">
            {a => <Input {...a} type="date" className={CONTROLE} value={prazo} onChange={e => setPrazo(e.target.value)} />}
          </Field>
        ) : acao?.tipo === 'cancelar' ? (
          <Field rotulo="Motivo" obrigatorio ajuda="Pelo menos 5 letras.">
            {a => <Textarea {...a} value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} className="min-h-20 fin-t-body" placeholder="Ex.: o cliente remarcou em vez de cancelar" />}
          </Field>
        ) : undefined}
        confirmarRotulo={acao?.tipo === 'aprovar' ? 'Aprovar e gerar a conta' : acao?.tipo === 'cancelar' ? 'Cancelar reembolso' : 'Virar crédito'}
        voltarRotulo="Voltar"
        tone={acao?.tipo === 'cancelar' ? 'destrutivo' : 'padrao'}
        processando={processando}
        onConfirmar={confirmarAcao}
      />

      <DetalheDoReembolso r={detalhe} onFechar={() => setDetalhe(null)} onAcao={a => setAcao(a)} podeCuidar={podeCuidar} podeCredito={podeCredito} onPrazo={setPrazo} onMotivo={setMotivo} />
      <NovoReembolso aberto={novo} onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void recarregar(); }} />
    </MolduraDaPagina>
  );
}

function DetalheDoReembolso({ r, onFechar, onAcao, podeCuidar, podeCredito, onPrazo, onMotivo }: {
  r: Reembolso | null; onFechar: () => void; onAcao: (a: Acao) => void; podeCuidar: boolean; podeCredito: boolean;
  onPrazo: (v: string) => void; onMotivo: (v: string) => void;
}) {
  if (!r) return null;
  const andamento = r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO';
  const primaria = r.situacao === 'SOLICITADO' && podeCuidar
    ? { rotulo: 'Aprovar', onClick: () => { onPrazo(r.prazo); onAcao({ tipo: 'aprovar', r }); } }
    : { rotulo: 'Fechar', onClick: onFechar };
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Reembolso ${ROTULO_SENTIDO[sentidoDe(r)].toLowerCase()}`}
      descricao={`${r.pessoa_nome} · ${reais(r.valor_centavos)}${r.venda_numero ? ` · venda ${r.venda_numero}` : ''}`}
      acaoPrimaria={primaria}
      acaoSecundaria={r.situacao === 'SOLICITADO' && podeCuidar ? { rotulo: 'Fechar', onClick: onFechar } : null}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <dl className="grid grid-cols-2 gap-[var(--fin-s-3)]">
          <div><dt className="fin-t-caption text-[var(--fin-text-3)]">Situação</dt><dd className="mt-1"><StatusChip dominio="reembolso" valor={r.atrasado ? 'ATRASADO' : r.situacao} /></dd></div>
          <div><dt className="fin-t-caption text-[var(--fin-text-3)]">Prazo</dt><dd className="mt-1 tabular-nums fin-t-body-strong text-[var(--fin-text)]">{dataBR(r.prazo)}</dd></div>
          {r.descricao ? <div className="col-span-2"><dt className="fin-t-caption text-[var(--fin-text-3)]">Descrição</dt><dd className="mt-1 fin-t-body text-[var(--fin-text)]">{r.descricao}</dd></div> : null}
          {r.conta_id ? (
            <div className="col-span-2"><dt className="fin-t-caption text-[var(--fin-text-3)]">Conta gerada</dt>
              <dd className="mt-1"><Link className="fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]" href={`/financeiro-ag/${r.conta_tabela === 'contas_pagar' ? 'pagar' : 'receber'}?abrir=${encodeURIComponent(r.conta_id)}`}>{r.conta_tabela === 'contas_pagar' ? 'Abrir a conta a pagar' : 'Abrir a conta a receber'}</Link></dd></div>
          ) : null}
        </dl>
        {andamento ? (
          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
            {r.tipo === 'CLIENTE' && podeCredito ? <Button type="button" variant="outline" onClick={() => onAcao({ tipo: 'credito', r })}><Undo2 aria-hidden="true" className="size-4" /> Virar crédito do cliente</Button> : null}
            {podeCuidar ? <Button type="button" variant="ghost" onClick={() => { onMotivo(''); onAcao({ tipo: 'cancelar', r }); }}>Cancelar reembolso</Button> : null}
          </div>
        ) : null}
        <section aria-labelledby="reemb-hist" className="flex flex-col gap-[var(--fin-s-2)]">
          <h3 id="reemb-hist" className="fin-t-body-strong text-[var(--fin-text)]">Histórico</h3>
          <ol className="flex flex-col gap-[var(--fin-s-2)] border-l border-[var(--fin-border)] pl-[var(--fin-s-3)]">
            {r.historico.map((h, i) => (
              <li key={`${h.em}${i}`} className="flex flex-col">
                <span className="fin-t-body text-[var(--fin-text)]">{h.de ? `${rotuloSituacao(h.de)} → ${rotuloSituacao(h.para)}` : rotuloSituacao(h.para)}{h.nota ? `: ${h.nota}` : ''}</span>
                <span className="fin-t-caption text-[var(--fin-text-3)]">{new Date(h.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}{h.quem ? ` · ${h.quem}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </RecordSheet>
  );
}

const rotuloSituacao = (s: string) => ({ SOLICITADO: 'Solicitado', APROVADO: 'Aprovado', PAGO: 'Pago', CANCELADO: 'Cancelado' } as Record<string, string>)[s] ?? s;

function NovoReembolso({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: () => void }) {
  const [sentido, setSentido] = React.useState<Sentido>('CLIENTE');
  const tipo: TipoDeReembolso = sentido === 'CLIENTE' ? 'CLIENTE' : 'FORNECEDOR';
  const paga = sentido !== 'DO_FORNECEDOR';
  const [pessoas, setPessoas] = React.useState<{ clientes: Array<{ id: string; nome: string }>; fornecedores: Array<{ id: string; nome: string }> }>({ clientes: [], fornecedores: [] });
  const [pessoa, setPessoa] = React.useState('');
  const [valor, setValor] = React.useState(0);
  const [prazo, setPrazo] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [aprovar, setAprovar] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => {
    if (!aberto) return;
    setSentido('CLIENTE'); setPessoa(''); setValor(0); setPrazo(addDias(hojeISO(), 7)); setDescricao(''); setAprovar(false);
    void Promise.all([
      loadEntities<{ id: string; nome: string }>('clientes'),
      loadEntities<{ id: string; nome_fantasia?: string; razao_social?: string }>('fornecedores-crm'),
    ]).then(([cs, fs]) => setPessoas({
      clientes: cs.map(c => ({ id: c.id, nome: c.nome || 'Cliente' })).sort((a, b) => a.nome.localeCompare(b.nome)),
      fornecedores: fs.map(f => ({ id: f.id, nome: f.nome_fantasia || f.razao_social || 'Fornecedor' })).sort((a, b) => a.nome.localeCompare(b.nome)),
    })).catch(() => undefined);
  }, [aberto]);

  const lista = tipo === 'CLIENTE' ? pessoas.clientes : pessoas.fornecedores;
  const escolhida = lista.find(p => p.id === pessoa);

  async function salvar() {
    if (!escolhida) { toast.error(tipo === 'CLIENTE' ? 'Escolha o cliente' : 'Escolha o fornecedor'); return; }
    if (valor <= 0) { toast.error('Informe o valor'); return; }
    setGravando(true);
    try {
      const r = await fetch('/api/reembolsos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, sentido: paga ? 'PAGAR' : 'RECEBER', pessoa_id: escolhida.id, pessoa_nome: escolhida.nome, valor_centavos: valor, prazo, descricao, aprovar }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error ?? 'Não deu certo.'));
      toast.success(aprovar ? 'Reembolso aprovado' : 'Reembolso solicitado', aprovar ? 'A conta já foi gerada.' : 'Aprove quando estiver combinado: a conta nasce na aprovação.');
      onCriado();
    } catch (e) {
      toast.error('O reembolso não foi lançado', e instanceof Error ? e.message : undefined);
    } finally {
      setGravando(false);
    }
  }

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Lançar reembolso"
      descricao="Para devolução combinada fora de um cancelamento. O cancelamento na venda já cria os reembolsos sozinho."
      sujo={valor > 0 || Boolean(pessoa)}
      resumo={escolhida && valor > 0 ? `${paga ? 'Devolver' : 'Receber de volta'} ${reais(valor)} ${paga ? 'para' : 'de'} ${escolhida.nome} até ${dataBR(prazo)}.` : undefined}
      acaoPrimaria={{ rotulo: aprovar ? 'Lançar e aprovar' : 'Lançar reembolso', onClick: salvar, carregando: gravando }}
      acaoSecundaria={{ rotulo: 'Voltar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <Segmentado<Sentido> rotulo="Sentido do reembolso" cheio valor={sentido} onChange={v => { if (tipo !== (v === 'CLIENTE' ? 'CLIENTE' : 'FORNECEDOR')) setPessoa(''); setSentido(v); }}
          opcoes={[
            { valor: 'CLIENTE', rotulo: 'Devolver ao cliente' },
            { valor: 'DO_FORNECEDOR', rotulo: 'Receber do fornecedor' },
            { valor: 'AO_FORNECEDOR', rotulo: 'Devolver ao fornecedor' },
          ]} />
        <Field rotulo={tipo === 'CLIENTE' ? 'Cliente' : 'Fornecedor'} obrigatorio>
          {a => (
            <select {...a} className={SELECT} value={pessoa} onChange={e => setPessoa(e.target.value)}>
              <option value="">Escolha…</option>
              {lista.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Valor</span>
            <CampoReais rotulo="Valor do reembolso" centavos={valor} onChange={setValor} />
          </div>
          <Field rotulo="Prazo">
            {a => <Input {...a} type="date" className={CONTROLE} value={prazo} onChange={e => setPrazo(e.target.value)} />}
          </Field>
        </div>
        <Field rotulo="Descrição" ajuda="O motivo da devolução, para quem for pagar ou cobrar.">
          {a => <Textarea {...a} value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} className="min-h-20 fin-t-body" />}
        </Field>
        <label className={cn('flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)]', aprovar ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)]')}>
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={aprovar} onChange={e => setAprovar(e.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Já aprovar</span>
            <span className="fin-t-caption text-[var(--fin-text-2)]">A conta {paga ? 'a pagar' : 'a receber'} nasce agora, vencendo no prazo.</span>
          </span>
        </label>
      </div>
    </RecordSheet>
  );
}
