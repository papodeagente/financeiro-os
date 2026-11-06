'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, CalendarClock, Handshake, Pencil, RefreshCcw, Trash2, Users } from 'lucide-react';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { apiRegras, ErroDaTela, type RegraNaLista } from '@/components/financeiro/regras-faturamento/api';
import { EditorDeRegra, regraNova, type Rascunho } from '@/components/financeiro/regras-faturamento/EditorDeRegra';
import { RecalcularVencimentos } from '@/components/financeiro/regras-faturamento/RecalcularVencimentos';
import { INFO_DO_PERIODO, ROTULO_TIPO_DE_PESSOA, TIPOS_DE_PESSOA, type RegraDeFaturamento, type TipoDePessoaDaRegra } from '@/lib/fatura-regras';
import { ROTULO_TIPO_PRODUTO, type TipoProduto } from '@/lib/venda-modelo';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Regras de faturamento (E5, parte B, 05/11/2026): de quanto em quanto tempo
 * os itens da forma Faturar de cada cliente viram fatura, por qual data e
 * quando vence. Também as regras de fornecedor e de representante.
 *
 * Mesmo jeito das outras listas: tipo, busca, Esc limpa, duplo clique abre.
 * Criar ou mudar uma regra de cliente oferece "Recalcular vencimentos" das
 * faturas abertas, com a prévia item a item.
 */

const TODOS = '__todos__';
type Filtros = { tipo: TipoDePessoaDaRegra | typeof TODOS; busca: string; desligadas: 'nao' | 'sim' };
const PADRAO: Filtros = { tipo: TODOS, busca: '', desligadas: 'nao' };

const ICONE_DO_TIPO: Record<TipoDePessoaDaRegra, typeof Users> = { CLIENTE: Users, FORNECEDOR: Building2, REPRESENTANTE: Handshake };

function valeParaQue(r: RegraDeFaturamento): string {
  const partes = [r.produto_tipo ? ROTULO_TIPO_PRODUTO[r.produto_tipo as TipoProduto] ?? r.produto_tipo : '', r.fornecedor_id ? r.fornecedor_nome || 'um fornecedor' : ''].filter(Boolean);
  return partes.length ? `Só ${partes.join(' de ')}` : 'Tudo';
}

const BOTAO_LINHA = 'inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] max-lg:size-11';

export function TelaDeRegras() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const moldura = React.useRef<HTMLDivElement>(null);
  const [f, setF] = React.useState<Filtros>(PADRAO);
  const [regras, setRegras] = React.useState<RegraNaLista[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [editando, setEditando] = React.useState<Rascunho | null>(null);
  const [desligar, setDesligar] = React.useState<Rascunho | null>(null);
  const [desligando, setDesligando] = React.useState(false);
  const [recalcular, setRecalcular] = React.useState<{ pessoa: { id: string; nome: string }; nova: boolean } | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    setCarregando(true);
    apiRegras.listar({ inativas: true }, ac.signal)
      .then(r => { setRegras(r.regras); setErro(null); setAtualizadoEm(new Date()); })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof ErroDaTela ? e.message : 'A lista não respondeu.'); })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [versao]);

  // "Nova regra ▾" chega pela URL (?nova=CLIENTE): abre o editor e limpa o endereço.
  const pedidoDeNova = params.get('nova');
  React.useEffect(() => {
    if (!pedidoDeNova) return;
    if ((TIPOS_DE_PESSOA as readonly string[]).includes(pedidoDeNova)) setEditando(regraNova(pedidoDeNova as TipoDePessoaDaRegra));
    router.replace(pathname, { scroll: false });
  }, [pedidoDeNova, pathname, router]);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);

  const ativos = (f.tipo !== TODOS ? 1 : 0) + (f.busca ? 1 : 0) + (f.desligadas !== 'nao' ? 1 : 0);
  const limpar = React.useCallback(() => setF(PADRAO), []);
  const mudar = (patch: Partial<Filtros>) => setF(atual => ({ ...atual, ...patch }));

  const todas = regras ?? [];
  const termo = f.busca.trim().toLowerCase();
  const linhas = todas.filter(r =>
    (f.desligadas === 'sim' || r.ativa)
    && (f.tipo === TODOS || r.pessoa_tipo === f.tipo)
    && (!termo || r.pessoa_nome.toLowerCase().includes(termo) || r.fornecedor_nome.toLowerCase().includes(termo) || r.descricao.toLowerCase().includes(termo)));

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || editando || desligar || recalcular) return;
    if (!moldura.current?.contains(e.target as Node)) return;
    if (ativos > 0) { e.preventDefault(); limpar(); }
  }

  const abrir = (r: RegraDeFaturamento) => setEditando({ ...r });

  async function abrirPorId(id: string) {
    const daLista = todas.find(r => r.id === id);
    if (daLista) { setEditando({ ...daLista }); return; }
    try {
      const r = await fetch(`/api/regras-faturamento/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const corpo = await r.json().catch(() => null) as { regra?: RegraDeFaturamento } | null;
      if (r.ok && corpo?.regra) setEditando({ ...corpo.regra });
      else toast.error('Não foi possível abrir a regra que já existe.');
    } catch {
      toast.error('Sem conexão. Tente de novo.');
    }
  }

  function salvo(regra: RegraDeFaturamento, nova: boolean) {
    setEditando(null);
    toast.success(nova ? `Regra criada para ${regra.pessoa_nome || 'a pessoa'}` : 'Regra salva');
    void recarregar();
    if (regra.pessoa_tipo === 'CLIENTE' && regra.ativa) setRecalcular({ pessoa: { id: regra.pessoa_id, nome: regra.pessoa_nome || 'o cliente' }, nova });
  }

  async function confirmarDesligar() {
    if (!desligar) return;
    setDesligando(true);
    try {
      await apiRegras.desligar(desligar.id);
      toast.success('Regra desligada', 'As faturas que ela já montou continuam como estão.');
      setDesligar(null);
      setEditando(null);
      void recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desligar.');
    } finally {
      setDesligando(false);
    }
  }

  const colunas: FinColuna<RegraNaLista>[] = [
    {
      id: 'pessoa', cabecalho: 'De quem', tipo: 'texto', sortable: true, minWidth: 220, acessor: r => r.pessoa_nome.toLowerCase(),
      render: r => {
        const Icone = ICONE_DO_TIPO[r.pessoa_tipo];
        return (
          <span className="flex min-w-0 items-start gap-[var(--fin-s-2)]">
            <Icone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
            <span className="flex min-w-0 flex-col">
              <span className={cn('truncate fin-t-body-strong', r.ativa ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)] line-through')} title={r.pessoa_nome}>
                {r.pessoa_nome || 'Sem nome no cadastro'}
              </span>
              <span className="fin-t-caption text-[var(--fin-text-3)]">{ROTULO_TIPO_DE_PESSOA[r.pessoa_tipo]}{r.ativa ? '' : ' · desligada'}</span>
            </span>
          </span>
        );
      },
    },
    { id: 'vale', cabecalho: 'Vale para', tipo: 'texto', prioridade: 2, minWidth: 140, render: r => <span className="text-[var(--fin-text-2)]">{valeParaQue(r)}</span> },
    {
      id: 'periodo', cabecalho: 'Período', tipo: 'texto', sortable: true, minWidth: 120, acessor: r => INFO_DO_PERIODO[r.periodo].rotulo,
      render: r => <span className="text-[var(--fin-text)]">{INFO_DO_PERIODO[r.periodo].rotulo}</span>,
    },
    {
      id: 'regra', cabecalho: 'Como fatura e vence', tipo: 'texto', prioridade: 1, minWidth: 280,
      render: r => <span className="line-clamp-2 max-w-[60ch] fin-t-caption text-[var(--fin-text-2)]" title={r.descricao_curta}>{r.descricao_curta}</span>,
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: r => (
        <span className="inline-flex items-center justify-end gap-1">
          <button type="button" className={BOTAO_LINHA} onClick={() => abrir(r)} aria-label={`Editar a regra de ${r.pessoa_nome}`} title="Editar">
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          {r.pessoa_tipo === 'CLIENTE' && r.ativa ? (
            <button type="button" className={BOTAO_LINHA} onClick={() => setRecalcular({ pessoa: { id: r.pessoa_id, nome: r.pessoa_nome }, nova: false })} aria-label={`Recalcular vencimentos de ${r.pessoa_nome}`} title="Recalcular vencimentos">
              <RefreshCcw aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          {r.ativa ? (
            <button type="button" className={cn(BOTAO_LINHA, 'hover:text-[var(--fin-negative-text)]')} onClick={() => setDesligar({ ...r })} aria-label={`Desligar a regra de ${r.pessoa_nome}`} title="Desligar">
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const estado: 'carregando' | 'erro' | 'ok' = !regras && carregando ? 'carregando' : !regras && erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <div ref={moldura} onKeyDown={teclado} className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={CalendarClock}
          titulo="Regras de faturamento"
          subtitulo="Como cada cliente é faturado: de quanto em quanto tempo, por qual data e quando vence. Fim de semana e feriado entram na conta."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={{
            rotulo: 'Nova regra',
            menu: [
              { rotulo: 'Regras para Cliente', descricao: 'Fatura corporativa: junta as vendas da forma Faturar.', icone: Users, href: `${pathname}?nova=CLIENTE` },
              { rotulo: 'Regras para Fornecedor', descricao: 'Período e vencimento da fatura do fornecedor.', icone: Building2, href: `${pathname}?nova=FORNECEDOR` },
              { rotulo: 'Regras para Representante', descricao: 'Período e vencimento do acerto com o representante.', icone: Handshake, href: `${pathname}?nova=REPRESENTANTE` },
            ],
          }}
          acoesSecundarias={[{ rotulo: 'Ver faturas', href: '/financeiro-ag/faturas' }]}
        />

        <FilterBar
          busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: 'Pesquisar cliente, fornecedor ou descrição…' }}
          selects={[
            {
              id: 'rf-tipo', rotulo: 'Regras de', valor: f.tipo, onChange: v => mudar({ tipo: v as Filtros['tipo'] }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos' }, ...TIPOS_DE_PESSOA.map(t => ({ valor: t, rotulo: ROTULO_TIPO_DE_PESSOA[t] }))],
            },
            {
              id: 'rf-desligadas', rotulo: 'Desligadas', valor: f.desligadas, onChange: v => mudar({ desligadas: v as Filtros['desligadas'] }),
              opcoes: [{ valor: 'nao', rotulo: 'Esconder' }, { valor: 'sim', rotulo: 'Mostrar' }],
            },
          ]}
          resumo={{ exibidos: linhas.length, total: todas.filter(r => f.desligadas === 'sim' || r.ativa).length, substantivo: linhas.length === 1 ? 'regra' : 'regras' }}
          ativos={ativos}
          onLimpar={limpar}
        />

        <FinTable<RegraNaLista>
          linhas={linhas}
          colunas={colunas}
          chave={r => r.id}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          vazio={ativos > 0
            ? {
              motivo: 'sem-resultado', titulo: 'Nenhuma regra neste filtro',
              oQueE: 'As regras continuam guardadas; o recorte atual é que não encontrou nenhuma.',
              acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar },
            }
            : {
              motivo: 'sem-dado', titulo: 'Nenhuma regra de faturamento ainda',
              oQueE: 'Sem regra, a venda da forma Faturar vira uma conta a receber solta, com o vencimento da venda. Com regra, ela entra sozinha na fatura do cliente.',
              comoComeca: [
                'Crie a regra do cliente corporativo: período (semanal, quinzenal, mensal…) e prazo.',
                'Na venda, escolha a forma de pagamento Faturar.',
                'A fatura junta os itens do período; feche, cobre e mande para o cliente conferir.',
              ],
              acao: { rotulo: 'Criar regra para cliente', onClick: () => setEditando(regraNova('CLIENTE')) },
            }}
          onLinhaDuploClique={abrir}
        />
        {carregando && regras ? <span className="sr-only" role="status">Atualizando a lista.</span> : null}
      </div>

      <EditorDeRegra
        aberto={Boolean(editando)}
        inicial={editando}
        onFechar={() => setEditando(null)}
        onSalvo={salvo}
        onAbrirExistente={id => { void abrirPorId(id); }}
        onDesligar={r => setDesligar(r)}
      />

      <ConfirmDialog
        aberto={Boolean(desligar)}
        onOpenChange={a => { if (!a) setDesligar(null); }}
        titulo="Desligar a regra"
        oQueVaiAcontecer="Os próximos itens deste cliente deixam de entrar sozinhos em fatura por esta regra. As faturas que ela já montou continuam como estão."
        detalhes={desligar ? [
          { rotulo: ROTULO_TIPO_DE_PESSOA[desligar.pessoa_tipo], valor: desligar.pessoa_nome || '—' },
          { rotulo: 'Período', valor: INFO_DO_PERIODO[desligar.periodo].rotulo },
          { rotulo: 'Vale para', valor: valeParaQue(desligar) },
        ] : undefined}
        confirmarRotulo="Desligar a regra"
        tone="destrutivo"
        processando={desligando}
        onConfirmar={confirmarDesligar}
      />

      <RecalcularVencimentos
        pessoa={recalcular?.pessoa ?? null}
        regraNova={recalcular?.nova ?? false}
        onFechar={() => setRecalcular(null)}
      />
    </MolduraDaPagina>
  );
}
