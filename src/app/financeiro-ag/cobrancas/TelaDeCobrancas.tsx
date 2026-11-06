'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Ban, BookCopy, Clock, Copy, Ellipsis, ExternalLink, Mail, MessageCircle, ReceiptText, RefreshCw, RotateCcw, Wallet,
} from 'lucide-react';

import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { resolverPeriodo, type PeriodoChave } from '@/components/fin/PeriodPicker';
import { EmitirCobrancas, type ContaParaEmitir } from '@/components/financeiro/cobranca/EmitirCobrancas';
import { useAcoesDaCobranca } from '@/components/financeiro/cobranca/useAcoesDaCobranca';
import { MenuDaLinha, type ItemDoMenu } from '@/app/financeiro-ag/contas/MenuDaLinha';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import {
  api, ErroDaCobranca, type Cobranca, type FiltroDasCobrancas, type ProvedorDeCobranca, type RespostaDaListaDeCobrancas,
  type StatusDaCobranca,
} from '@/lib/cobranca/contrato-telas';
import {
  acoesDaCobranca, dataBR, mensagemDeErro, nomeDoProvedor, ROTULO_DO_TIPO, SITUACAO_DA_COBRANCA, type IdDaAcao,
} from '@/lib/cobranca/regras-telas';
import { documentoDasCobrancas } from '@/lib/exportacao/listas-financeiro';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Cobranças (05/11/2026): todo boleto, Pix e carnê emitido pelo provedor da
 * agência (Asaas ou Pagar.me), com a situação que o próprio provedor avisa.
 * Não existe remessa nem retorno: o pagamento chega pelo aviso e baixa a
 * conta a receber sozinho.
 *
 * Mesmo jeito de trabalhar das outras listas: período, situação, busca, Esc
 * limpa, totais do filtro, duplo clique abre a conta, clique direito (ou o
 * botão "…") mostra as ações. Gravar (2ª via, enviar, cancelar) sempre pede
 * confirmação.
 */

const PERIODOS: PeriodoChave[] = ['MES_ATUAL', 'PROX_30', 'PROX_90', 'MES_PASSADO', 'TUDO', 'PERSONALIZADO'];
type FiltroDeStatus = NonNullable<FiltroDasCobrancas['status']>;
const STATUS: Array<{ valor: FiltroDeStatus; rotulo: string }> = [
  { valor: 'em_aberto', rotulo: 'Em aberto (a pagar pelo cliente)' },
  { valor: 'todas', rotulo: 'Todas' },
  ...(['aberta', 'vencida', 'paga', 'emitindo', 'falhou', 'cancelada', 'estornada'] as StatusDaCobranca[])
    .map(s => ({ valor: s as FiltroDeStatus, rotulo: SITUACAO_DA_COBRANCA[s].rotulo })),
];
const TODOS = '__todos__';

const ICONE_DA_ACAO: Record<IdDaAcao, typeof Copy> = {
  copiar_linha: Copy, copiar_pix: Copy, abrir_boleto: ExternalLink, abrir_fatura: ExternalLink, segunda_via: RefreshCw,
  enviar_email: Mail, enviar_whatsapp: MessageCircle, cancelar: Ban, emitir_de_novo: RotateCcw,
};

type Filtros = { periodo: PeriodoChave; de: string; ate: string; status: FiltroDeStatus; provedor: ProvedorDeCobranca | ''; busca: string };

function filtrosPadrao(): Filtros {
  const r = resolverPeriodo('MES_ATUAL');
  return { periodo: 'MES_ATUAL', de: r.de, ate: r.ate, status: 'em_aberto', provedor: '', busca: '' };
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export function TelaDeCobrancas() {
  const router = useRouter();
  const pode = usePermissoes();
  const moldura = React.useRef<HTMLDivElement>(null);
  const [f, setF] = React.useState<Filtros>(filtrosPadrao);
  const [dados, setDados] = React.useState<RespostaDaListaDeCobrancas | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [menu, setMenu] = React.useState<{ c: Cobranca; posicao: { x: number; y: number } } | null>(null);
  const [emitir, setEmitir] = React.useState<ContaParaEmitir[] | null>(null);

  const busca = useDebounce(f.busca.trim());
  const datasValidas = !f.de || !f.ate || f.de <= f.ate;

  React.useEffect(() => {
    if (!datasValidas) return;
    const ac = new AbortController();
    setCarregando(true);
    api.listar({ status: f.status, de: f.de || undefined, ate: f.ate || undefined, provedor: f.provedor, busca: busca || undefined }, ac.signal)
      .then(r => { setDados(r); setErro(null); setAtualizadoEm(new Date()); })
      .catch(e => {
        if (ac.signal.aborted) return;
        setErro(e instanceof ErroDaCobranca ? mensagemDeErro(e.codigo, e.message, e.status) : 'A consulta não respondeu.');
      })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [f.status, f.de, f.ate, f.provedor, busca, datasValidas, versao]);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);
  const { executar, dialogos } = useAcoesDaCobranca({
    onMudou: () => { void recarregar(); },
    onEmitirDeNovo: c => setEmitir([{
      id: c.conta_id, tipo: 'receber', situacao: 'em_aberto', saldo: c.valor, pessoa: c.cliente_nome,
      cliente_id: c.cliente_id, vencimento: c.vencimento, descricao: c.descricao,
    }]),
  });

  const padrao = filtrosPadrao();
  const ativos = (f.periodo !== padrao.periodo ? 1 : 0) + (f.status !== padrao.status ? 1 : 0) + (f.provedor ? 1 : 0) + (f.busca ? 1 : 0);
  const limpar = React.useCallback(() => setF(filtrosPadrao()), []);
  const mudar = (patch: Partial<Filtros>) => setF(atual => ({ ...atual, ...patch }));

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || menu || emitir) return;
    if (!moldura.current?.contains(e.target as Node)) return;
    if (ativos > 0) { e.preventDefault(); limpar(); }
  }

  const abrirConta = React.useCallback((c: Cobranca) => router.push(`/financeiro-ag/receber?abrir=${encodeURIComponent(c.conta_id)}`), [router]);
  const podeEmitir = pode('gerar_boletos');

  function itensDoMenu(c: Cobranca): ItemDoMenu[] {
    const itens: ItemDoMenu[] = [{ id: 'abrir', rotulo: 'Abrir a conta', icone: ReceiptText, atalho: 'Enter', onEscolher: () => abrirConta(c) }];
    for (const a of acoesDaCobranca(c, { emitir: podeEmitir })) {
      itens.push({ id: a.id, rotulo: a.rotulo, icone: ICONE_DA_ACAO[a.id], destrutivo: a.destrutiva, desabilitado: a.bloqueio, onEscolher: () => executar(a.id, c) });
    }
    return itens;
  }

  const colunas: FinColuna<Cobranca>[] = [
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: c => c.vencimento || null },
    {
      id: 'cliente', cabecalho: 'Cliente', tipo: 'texto', sortable: true, minWidth: 200, acessor: c => c.cliente_nome.toLowerCase(),
      render: c => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]" title={c.cliente_nome}>{c.cliente_nome || 'Cliente'}</span>
          {c.descricao ? <span className="max-w-[40ch] truncate fin-t-caption text-[var(--fin-text-3)]" title={c.descricao}>{c.descricao}</span> : null}
        </span>
      ),
    },
    {
      id: 'tipo', cabecalho: 'Como paga', tipo: 'texto', prioridade: 2, minWidth: 140,
      render: c => (
        <span className="flex flex-col">
          <span className="inline-flex items-center gap-1 text-[var(--fin-text)]">
            {c.tipo === 'carne' ? <BookCopy aria-hidden="true" className="size-3.5 text-[var(--fin-text-3)]" /> : null}
            {ROTULO_DO_TIPO[c.tipo]}
          </span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{nomeDoProvedor(c.provedor)}</span>
        </span>
      ),
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, valor: c => c.status, dominio: 'cobranca' },
    {
      id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: c => c.valor,
      tone: c => (c.status === 'paga' ? 'positivo' : c.status === 'vencida' ? 'negativo' : 'neutro'),
      sub: c => (c.status === 'paga' && c.valor_pago != null
        ? `entrou ${formatBRL(c.valor_pago)}${c.pago_em ? ` em ${dataBR(c.pago_em)}` : ''}`
        : c.status === 'falhou' && c.erro ? mensagemDeErro(null, c.erro).slice(0, 60) : null),
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: c => {
        const copiar = acoesDaCobranca(c, { emitir: podeEmitir }).find(a => (a.id === 'copiar_pix' || a.id === 'copiar_linha') && a.bloqueio === null);
        return (
          <span className="inline-flex items-center justify-end gap-1">
            {copiar ? (
              <button
                type="button"
                onClick={() => executar(copiar.id, c)}
                aria-label={`${copiar.rotulo} de ${c.cliente_nome}`}
                title={copiar.rotulo}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-caption text-[var(--fin-text-2)] max-lg:h-11',
                  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                )}
              >
                <Copy aria-hidden="true" className="size-3.5" />
                {copiar.id === 'copiar_pix' ? 'Pix' : 'Linha'}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`Ações da cobrança de ${c.cliente_nome}`}
              aria-haspopup="menu"
              onClick={e => {
                const caixa = e.currentTarget.getBoundingClientRect();
                setMenu({ c, posicao: { x: caixa.right - 8, y: caixa.bottom + 4 } });
              }}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] max-lg:size-11',
                'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
              )}
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </button>
          </span>
        );
      },
    },
  ];

  const t = dados?.totais;
  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';
  const numeros = dados ? 'ok' : carregando ? 'carregando' : 'indisponivel';
  const linhas = dados?.cobrancas ?? [];

  return (
    <MolduraDaPagina>
      <div ref={moldura} onKeyDown={teclado} className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={ReceiptText}
          titulo="Cobranças"
          subtitulo="Boletos, Pix e carnês emitidos pelo provedor da agência. Quando o cliente paga, a conta é baixada sozinha: sem remessa e sem retorno."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeEmitir ? { rotulo: 'Gerar boletos', icone: ReceiptText, href: '/financeiro-ag/contas?cobranca=sem_boleto' } : undefined}
          acoesSecundarias={[{ rotulo: 'Configurar cobrança', href: '/config/cobranca' }]}
        />

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            rotulo="Em aberto" icone={Clock} valor={t?.aberto.valor ?? null} estado={numeros}
            contexto={t ? `${t.aberto.quantidade} ${t.aberto.quantidade === 1 ? 'cobrança esperando' : 'cobranças esperando'} o cliente pagar.` : 'Cobranças esperando o cliente pagar.'}
          />
          <MetricCard
            rotulo="Vencidas" icone={AlertTriangle} valor={t?.vencido.valor ?? null} estado={numeros} tone="negativo" tomDoIcone="negativo"
            contexto={t ? `${t.vencido.quantidade} ${t.vencido.quantidade === 1 ? 'passou' : 'passaram'} do vencimento. A 2ª via muda a data.` : 'Passaram do vencimento sem pagamento.'}
          />
          <MetricCard
            rotulo="Pagas" icone={Wallet} valor={t?.pago.valor ?? null} estado={numeros} tone="positivo" tomDoIcone="positivo"
            contexto={t ? `${t.pago.quantidade} no período, já baixadas nas contas a receber.` : 'Pagas no período, já baixadas nas contas.'}
          />
          <MetricCard
            rotulo="Não emitidas" icone={Ban} valor={t?.falhou.quantidade ?? null} formato="contagem" estado={numeros} tomDoIcone="aviso"
            contexto="O provedor recusou. O motivo aparece na linha; corrija e emita de novo."
          />
        </div>

        <FilterBar
          busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: 'Pesquisar cliente ou descrição…' }}
          periodo={{
            valor: f.periodo, de: f.de, ate: f.ate, opcoes: PERIODOS,
            onChange: (chave, range) => mudar({ periodo: chave, de: range.de, ate: range.ate }),
          }}
          selects={[
            { id: 'cob-situacao', rotulo: 'Situação', valor: f.status, onChange: v => mudar({ status: v as FiltroDeStatus }), opcoes: STATUS },
            {
              id: 'cob-provedor', rotulo: 'Provedor', valor: f.provedor || TODOS, onChange: v => mudar({ provedor: v === TODOS ? '' : v as ProvedorDeCobranca }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos' }, { valor: 'asaas', rotulo: 'Asaas' }, { valor: 'pagarme', rotulo: 'Pagar.me' }],
            },
          ]}
          resumo={{ exibidos: linhas.length, total: linhas.length, substantivo: linhas.length === 1 ? 'cobrança' : 'cobranças' }}
          ativos={ativos}
          onLimpar={limpar}
        />
        {!datasValidas ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p> : null}

        <div className="flex justify-end">
          <BotaoExportar
            origem="cobrancas"
            podeExportar={pode('exportar')}
            desabilitado={!linhas.length}
            documento={() => documentoDasCobrancas(linhas, {
              de: f.de, ate: f.ate,
              situacao: STATUS.find(s => s.valor === f.status)?.rotulo,
              provedor: f.provedor ? nomeDoProvedor(f.provedor) : undefined,
              busca: f.busca.trim() || undefined,
            })}
          />
        </div>

        <FinTable<Cobranca>
          linhas={linhas}
          colunas={colunas}
          chave={c => c.id}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          vazio={ativos > 0
            ? {
              motivo: 'sem-resultado', titulo: 'Nenhuma cobrança neste filtro',
              oQueE: 'As cobranças continuam guardadas; o recorte atual é que não encontrou nenhuma.',
              acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar },
            }
            : {
              motivo: 'sem-dado', titulo: 'Nenhuma cobrança em aberto neste mês',
              oQueE: 'Aqui aparecem os boletos e Pix que a agência emitiu pelo Asaas ou pelo Pagar.me, com a situação que o provedor avisa.',
              comoComeca: [
                'Conecte o provedor da agência em Configurações › Cobrança.',
                'Em Contas a Pagar/Receber, filtre "Boleto não emitido", marque as contas e use Gerar boletos.',
                'Quando o cliente pagar, a conta a receber é baixada sozinha, com a taxa do provedor.',
              ],
              acao: podeEmitir ? { rotulo: 'Ver contas sem boleto', href: '/financeiro-ag/contas?cobranca=sem_boleto' } : undefined,
            }}
          totais={linhas.length && t ? [{ colunaId: 'valor', valor: t.aberto.valor, rotulo: 'Em aberto no filtro' }] : undefined}
          onLinhaDuploClique={abrirConta}
          onLinhaMenu={(c, posicao) => setMenu({ c, posicao })}
        />
        {carregando && dados ? <span className="sr-only" role="status">Atualizando a lista.</span> : null}
      </div>

      <MenuDaLinha
        aberto={Boolean(menu)}
        posicao={menu?.posicao ?? { x: 0, y: 0 }}
        titulo={menu ? `${menu.c.cliente_nome || 'Cobrança'} · ${SITUACAO_DA_COBRANCA[menu.c.status].rotulo}` : ''}
        itens={menu ? itensDoMenu(menu.c) : []}
        onFechar={() => setMenu(null)}
      />
      {dialogos}
      <EmitirCobrancas contas={emitir} onFechar={() => setEmitir(null)} onConcluido={() => { void recarregar(); }} />
    </MolduraDaPagina>
  );
}
