'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownLeft, ArrowUpRight, CheckCheck, Columns3, Copy, ExternalLink, Plus, ReceiptText, RotateCcw, Scale, ShoppingBag, Trash2,
} from 'lucide-react';

import {
  CAMPOS_DA_BUSCA, camposDaConfig, rotuloDaSituacao, type CampoDaBusca, type CampoDaLista, type CobrancaDoFiltro,
  type DataDoFiltro, type LinhaDeConta, type SituacaoDoFiltro,
} from '@/lib/contas-pagar-receber';
import { contasParaEscolher } from '@/lib/contas-bancarias-regras';
import { enderecoDaVenda, postarRegistro } from '@/lib/gravar-registro';
import { api as apiDaCobranca, type ProvedorDeCobranca } from '@/lib/cobranca/contrato-telas';
import { motivoSemCarne, PROVEDORES, separarParaBoleto, type ContaParaCobrar } from '@/lib/cobranca/regras-telas';
import { EmitirCobrancas } from '@/components/financeiro/cobranca/EmitirCobrancas';
import { GerarCarne } from '@/components/financeiro/cobranca/GerarCarne';
import type { AcaoDeLote } from '@/lib/contas-em-lote';
import type { ContaBancaria, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { formatBRL } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { nomeDaEmpresa, useEmpresas } from '@/components/fin/useEmpresas';
import type { FinColuna } from '@/components/fin/FinTable';
import { resolverPeriodo, type PeriodoChave } from '@/components/fin/PeriodPicker';

import { AcaoEmLote, type Categoria, type Centro } from './AcaoEmLote';
import {
  COLUNAS_ESCOLHIVEIS, COLUNAS_FIXAS, COLUNAS_PADRAO, colunasDoServidor, colunasSalvas, criarColunas, linhasParaCopiar, normalizarColunas,
  ordemDaColuna, salvarColunas, cobrancaDaLinha, type ColunaId,
} from './colunas';
import { LiquidarEmLote } from './LiquidarEmLote';
import { filtrosDoEndereco } from './filtro-do-endereco';
import { MenuDaLinha, type ItemDoMenu } from './MenuDaLinha';
import { BarraDoLote, RodapeDaLista, type AcaoDaBarra } from './PartesDaLista';
import { enderecoDaConta, enderecoDaExportacao, todasDoFiltro, useContas, usePermissoes } from './useContas';
import { BotaoExportar } from '@/components/fin/BotaoExportar';

/**
 * Contas a Pagar/Receber (05/11/2026): as contas a pagar e a receber numa
 * lista só, para quem trabalha o dia inteiro nelas. As telas de Contas a
 * pagar e Contas a receber continuam; esta é a visão de trabalho:
 *   · filtros de sempre (período, data de emissão/vencimento/liquidação,
 *     situação, tipo, pesquisar em um campo, categoria, centro, conta);
 *     Esc limpa;
 *   · grade densa, colunas escolhidas e guardadas, ordem e páginas no
 *     servidor, totais do filtro inteiro no rodapé;
 *   · duplo clique abre a conta na tela de sempre; clique direito (ou o
 *     botão "…") abre o menu da linha;
 *   · marcar várias e agir de uma vez, sempre com prévia.
 */

const PERIODOS: PeriodoChave[] = [
  'MES_ATUAL', 'SEMANA_ATUAL', 'AMANHA', 'PROX_7', 'PROX_14', 'PROX_30', 'PROX_90', 'PROX_MES',
  'ULT_7', 'ULT_14', 'ULT_30', 'MES_PASSADO', 'ANO_ATUAL', 'TUDO', 'PERSONALIZADO',
];

const ROTULO_SITUACAO: Record<SituacaoDoFiltro, string> = {
  todas: 'Todas', em_aberto: 'Em aberto', em_atraso: 'Em atraso', liquidado: 'Pago/Recebido', cancelado: 'Cancelado', excluido: 'Excluído',
};
const ROTULO_DATA: Record<DataDoFiltro, string> = { emissao: 'Emissão', vencimento: 'Vencimento', liquidacao: 'Liquidação' };
const ROTULO_EM: Record<CampoDaBusca, string> = {
  tudo: 'Todos os campos', numero: 'Nº', descricao: 'Descrição', pessoa: 'Pessoa', documento: 'Documento', categoria: 'Categoria',
  centro: 'Centro de custo', venda: 'Venda Nº',
};
const TODOS = '__todos__';
const ROTULO_COBRANCA: Record<CobrancaDoFiltro, string> = {
  todas: 'Todas', sem_boleto: 'Boleto não emitido', emitida: 'Boleto emitido', vencida: 'Cobrança vencida', paga: 'Paga pela cobrança', falhou: 'Não emitida (erro)',
};

/** A linha da lista no formato que as regras de cobrança leem. */
function paraCobrar(l: LinhaDeConta): ContaParaCobrar & { descricao: string } {
  return {
    // Excluída não se cobra: para as regras de cobrança, é como cancelada.
    id: l.id, tipo: l.tipo, situacao: l.situacao === 'excluido' ? 'cancelado' : l.situacao, saldo: l.saldo, pessoa: l.pessoa, vencimento: l.vencimento,
    cobranca: cobrancaDaLinha(l), descricao: l.descricao,
  };
}

type Filtros = {
  periodo: PeriodoChave; de: string; ate: string; data: DataDoFiltro; situacao: SituacaoDoFiltro;
  tipo: 'ambos' | 'pagar' | 'receber'; busca: string; em: CampoDaBusca; categoria: string; centro: string; conta: string;
  cobranca: CobrancaDoFiltro;
};

function filtrosPadrao(): Filtros {
  const r = resolverPeriodo('MES_ATUAL');
  return {
    periodo: 'MES_ATUAL', de: r.de, ate: r.ate, data: 'vencimento', situacao: 'todas', tipo: 'ambos',
    busca: '', em: 'tudo', categoria: '', centro: '', conta: '', cobranca: 'todas',
  };
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export function TelaDeContas() {
  const router = useRouter();
  const pode = usePermissoes();
  const moldura = React.useRef<HTMLDivElement>(null);

  const [f, setF] = React.useState<Filtros>(filtrosPadrao);
  const [ordem, setOrdem] = React.useState<{ coluna: ColunaId; direcao: 'asc' | 'desc' }>({ coluna: 'vencimento', direcao: 'asc' });
  const [pagina, setPagina] = React.useState(1);
  const [porPagina, setPorPagina] = React.useState(100);
  const [colunas, setColunas] = React.useState<ColunaId[]>([...COLUNAS_PADRAO]);
  const [mostrarColunas, setMostrarColunas] = React.useState(false);
  const [selecionadas, setSelecionadas] = React.useState<Map<string, LinhaDeConta>>(new Map());
  const [menu, setMenu] = React.useState<{ linha: LinhaDeConta; posicao: { x: number; y: number } } | null>(null);
  const [liquidar, setLiquidar] = React.useState<LinhaDeConta[] | null>(null);
  const [lote, setLote] = React.useState<{ acao: AcaoDeLote; linhas: LinhaDeConta[] } | null>(null);
  const [selecionandoTodas, setSelecionandoTodas] = React.useState(false);
  const [boletos, setBoletos] = React.useState<Array<ContaParaCobrar & { descricao: string }> | null>(null);
  const [carne, setCarne] = React.useState<Array<ContaParaCobrar & { descricao: string }> | null>(null);
  // Provedor de cobrança da agência (E3): decide se "Gerar carnê" aparece.
  const [provedor, setProvedor] = React.useState<ProvedorDeCobranca | '' | null>(null);

  const [categorias, setCategorias] = React.useState<Categoria[]>([]);
  const [centros, setCentros] = React.useState<Centro[]>([]);
  const [contasBancarias, setContasBancarias] = React.useState<Array<{ id: string; nome: string; ativo?: unknown }>>([]);
  const [campos, setCampos] = React.useState<CampoDaLista[]>([]);
  const [restaurando, setRestaurando] = React.useState<LinhaDeConta | null>(null);
  const [gravandoRestauro, setGravandoRestauro] = React.useState(false);

  React.useEffect(() => {
    // Filtro no endereço: o atalho da tela Cobranças (?cobranca=sem_boleto,
    // em todo o período) e o link do "Perguntar em texto" (E7), com o filtro
    // que a resposta usou. Sem parâmetro, a tela de sempre.
    const doEndereco = window.location.search;
    setF(atual => filtrosDoEndereco(doEndereco, atual as Filtros & { periodo: string }) as Filtros);
    setColunas(colunasSalvas());
    // Campos personalizados da agência viram colunas; depois, a escolha
    // guardada no servidor (a deste navegador fica de reserva).
    void (async () => {
      const lidos = await fetch('/api/config/financeiro/campos-personalizados')
        .then(r => (r.ok ? r.json() : null)).then(camposDaConfig).catch(() => [] as CampoDaLista[]);
      setCampos(lidos);
      const doServidor = normalizarColunas(await colunasDoServidor(), lidos);
      if (doServidor) setColunas(doServidor);
    })();
    loadEntities<PlanoContas>('plano-contas')
      .then(l => setCategorias(l.map(c => ({ id: c.id, codigo: c.codigo, nome: c.nome, tipo: c.tipo, ativo: c.ativo }))))
      .catch(() => setCategorias([]));
    fetch('/api/centros-custo').then(r => (r.ok ? r.json() : [])).then((l: Centro[]) => setCentros(Array.isArray(l) ? l : [])).catch(() => setCentros([]));
    loadEntities<ContaBancaria & { ativo?: unknown }>('contas-bancarias')
      .then(l => setContasBancarias(l.map(c => ({ id: c.id, nome: c.nome || 'Conta', ativo: c.ativo }))))
      .catch(() => setContasBancarias([]));
    apiDaCobranca.config().then(c => setProvedor(c.provedor_padrao)).catch(() => setProvedor(null));
  }, []);

  const busca = useDebounce(f.busca.trim());
  const recorte = React.useMemo(() => {
    const p = new URLSearchParams({ data: f.data, situacao: f.situacao, tipo: f.tipo, em: f.em });
    if (f.de) p.set('de', f.de);
    if (f.ate) p.set('ate', f.ate);
    if (busca) p.set('busca', busca);
    if (f.categoria) p.set('categoria', f.categoria);
    if (f.centro) p.set('centro', f.centro);
    if (f.conta) p.set('conta', f.conta);
    if (f.cobranca !== 'todas') p.set('cobranca', f.cobranca);
    return p.toString();
  }, [f.data, f.situacao, f.tipo, f.em, f.de, f.ate, busca, f.categoria, f.centro, f.conta, f.cobranca]);
  const datasValidas = !f.de || !f.ate || f.de <= f.ate;
  const consulta = datasValidas
    ? `${recorte}&ordem=${ordemDaColuna(ordem.coluna) ?? 'vencimento'}&direcao=${ordem.direcao}&pagina=${pagina}&por_pagina=${porPagina}`
    : '';
  const { dados, carregando, erro, atualizadoEm, recarregar } = useContas(consulta);

  // Filtro mudou: volta à página 1 e esquece a seleção (ela era de outro recorte).
  React.useEffect(() => { setPagina(1); setSelecionadas(new Map()); }, [recorte]);

  const padrao = filtrosPadrao();
  const ativos = (f.periodo !== padrao.periodo ? 1 : 0) + (f.data !== padrao.data ? 1 : 0) + (f.situacao !== 'todas' ? 1 : 0)
    + (f.tipo !== 'ambos' ? 1 : 0) + (f.busca ? 1 : 0) + (f.em !== 'tudo' ? 1 : 0) + (f.categoria ? 1 : 0) + (f.centro ? 1 : 0) + (f.conta ? 1 : 0) + (f.cobranca !== 'todas' ? 1 : 0);
  const limpar = React.useCallback(() => setF(filtrosPadrao()), []);
  const mudar = (patch: Partial<Filtros>) => setF(atual => ({ ...atual, ...patch }));

  // Esc limpa os filtros, como sempre foi. Só quando o foco está na própria
  // tela: Esc dentro de uma lista aberta, menu ou janela continua fechando ela.
  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!moldura.current?.contains(e.target as Node) || menu || liquidar || lote || boletos || carne || restaurando) return;
    if (ativos > 0) { e.preventDefault(); limpar(); }
    else if (selecionadas.size > 0) { e.preventDefault(); setSelecionadas(new Map()); }
  }

  function ordenar(colunaId: string) {
    const c = colunaId as ColunaId;
    if (!ordemDaColuna(c)) return;
    setOrdem(o => (o.coluna === c ? { coluna: c, direcao: o.direcao === 'asc' ? 'desc' : 'asc' } : { coluna: c, direcao: 'asc' }));
    setPagina(1);
  }

  function alterarSelecao(chaves: string[], marcar: boolean) {
    setSelecionadas(atual => {
      const nova = new Map(atual);
      for (const k of chaves) {
        const l = dados?.linhas.find(x => x.chave === k);
        if (marcar && l) nova.set(k, l); else nova.delete(k);
      }
      return nova;
    });
  }

  async function selecionarTodasDoFiltro() {
    setSelecionandoTodas(true);
    try {
      const r = await todasDoFiltro(recorte);
      setSelecionadas(new Map(r.linhas.map(l => [l.chave, l])));
      if (r.cortado) toast.info('Foram marcadas as primeiras 2.000 contas.', 'Use mais filtros para agir no restante.');
    } catch (e) {
      toast.error('Não foi possível marcar todas.', e instanceof Error ? e.message : '');
    } finally {
      setSelecionandoTodas(false);
    }
  }

  function trocarColunas(novas: ColunaId[]) {
    const final: ColunaId[] = [
      ...COLUNAS_ESCOLHIVEIS.map(c => c.id).filter(c => novas.includes(c)),
      ...campos.map(c => `campo:${c.id}` as const).filter(c => novas.includes(c)),
    ];
    const comFixas = [...final, ...COLUNAS_FIXAS.filter(c => !final.includes(c))];
    setColunas(comFixas);
    salvarColunas(comFixas);
  }

  async function copiar(linhas: LinhaDeConta[]) {
    try {
      await navigator.clipboard.writeText(linhasParaCopiar(linhas));
      toast.success(linhas.length === 1 ? 'Linha copiada' : `${linhas.length} linhas copiadas`, 'Cole no Excel, numa planilha ou numa mensagem.');
    } catch {
      toast.error('Não foi possível copiar.', 'O navegador não liberou a área de transferência.');
    }
  }

  const abrir = React.useCallback((l: LinhaDeConta) => router.push(enderecoDaConta(l)), [router]);
  const aposLote = () => { setSelecionadas(new Map()); void recarregar(); };

  const podeLiquidarTipo = (l: LinhaDeConta) => pode(l.tipo === 'pagar' ? 'liquidar_pagar' : 'liquidar_receber');
  const podeEditar = pode('editar_financeiro');
  const podeExcluir = pode('excluir');

  /** Restaurar um título excluído (a rota decide caixa, razão e permissão). */
  async function restaurar(l: LinhaDeConta) {
    setGravandoRestauro(true);
    try {
      const r = await postarRegistro<{ ok: boolean; aviso?: string }>(
        `/api/${l.tipo === 'pagar' ? 'contas-pagar' : 'contas-receber'}/${encodeURIComponent(l.id)}/restaurar`,
      );
      toast.success('Conta restaurada', r?.aviso || `${l.pessoa || 'A conta'} voltou para a lista e para os relatórios.`);
      setRestaurando(null);
      void recarregar();
    } catch (e) {
      toast.error('Não foi possível restaurar', e instanceof Error ? e.message : '');
    } finally {
      setGravandoRestauro(false);
    }
  }

  function itensDoMenu(l: LinhaDeConta): ItemDoMenu[] {
    const vendaItem: ItemDoMenu[] = l.venda_id
      ? [{ id: 'venda', rotulo: l.venda_numero ? `Abrir a venda ${l.venda_numero}` : 'Abrir a venda', icone: ShoppingBag,
          onEscolher: () => router.push(enderecoDaVenda(l.venda_id)) }]
      : [];
    if (l.situacao === 'excluido') {
      return [
        ...(podeEditar ? [{ id: 'restaurar', rotulo: 'Restaurar', icone: RotateCcw, onEscolher: () => setRestaurando(l) }] : []),
        ...vendaItem,
        { id: 'copiar', rotulo: 'Copiar linha', icone: Copy, onEscolher: () => { void copiar([l]); } },
      ];
    }
    const marcadas = selecionadas.has(l.chave) && selecionadas.size > 1 ? [...selecionadas.values()] : [l];
    const aberta = l.situacao === 'em_aberto' || l.situacao === 'em_atraso';
    const itens: ItemDoMenu[] = [
      { id: 'abrir', rotulo: 'Abrir', icone: ExternalLink, atalho: 'Enter', onEscolher: () => abrir(l) },
      ...vendaItem,
    ];
    if (podeLiquidarTipo(l)) {
      itens.push({
        id: 'liquidar', rotulo: l.tipo === 'pagar' ? 'Liquidar (pagar)' : 'Liquidar (receber)', icone: CheckCheck,
        desabilitado: !aberta ? (l.situacao === 'cancelado' ? 'Conta cancelada.' : 'Já está liquidada.') : null,
        onEscolher: () => setLiquidar([l]),
      });
    }
    if (l.tipo === 'receber' && pode('gerar_boletos')) {
      const fora = separarParaBoleto([paraCobrar(l)]).fora[0];
      itens.push({
        id: 'boleto', rotulo: 'Gerar boleto', icone: ReceiptText,
        desabilitado: fora ? fora.motivo : null,
        onEscolher: () => setBoletos(marcadas.map(paraCobrar)),
      });
    }
    itens.push({
      id: 'copiar', rotulo: marcadas.length > 1 ? `Copiar ${marcadas.length} linhas` : 'Copiar linha', icone: Copy,
      onEscolher: () => { void copiar(marcadas); },
    });
    if (podeExcluir) {
      itens.push({ id: 'excluir', rotulo: 'Excluir', icone: Trash2, destrutivo: true, onEscolher: () => setLote({ acao: 'excluir', linhas: [l] }) });
    }
    return itens;
  }

  // Várias empresas (E7): a coluna Empresa só existe com duas ou mais.
  const { multi, empresas } = useEmpresas();
  const colunasDaTabela = React.useMemo(() => {
    const base = criarColunas({ onMenu: (linha, posicao) => setMenu({ linha, posicao }), campos });
    if (!multi) return base;
    const empresa: FinColuna<LinhaDeConta> = {
      id: 'empresa', cabecalho: 'Empresa', tipo: 'texto', minWidth: 120,
      render: l => {
        const nome = nomeDaEmpresa(empresas, l.empresa_id);
        return <span title={nome} className="block max-w-[120px] truncate text-[var(--fin-text-2)]">{nome}</span>;
      },
    };
    const i = base.findIndex(c => c.id === 'pessoa');
    return [...base.slice(0, i), empresa, ...base.slice(i)];
  }, [multi, empresas, campos]);
  const colunasVisiveisDaTabela = React.useMemo(() => (multi ? [...colunas, 'empresa'] : colunas), [multi, colunas]);
  const verExcluidas = f.situacao === 'excluido';
  const contasEscolhiveis = contasParaEscolher(contasBancarias, f.conta);
  const contasParaLiquidar = contasParaEscolher(contasBancarias);

  const marcadas = [...selecionadas.values()];
  function acaoDaBarra(acao: AcaoDaBarra) {
    if (acao === 'liquidar') setLiquidar(marcadas);
    else if (acao === 'reagendar' || acao === 'recategorizar' || acao === 'excluir') setLote({ acao, linhas: marcadas });
    else if (acao === 'copiar') void copiar(marcadas);
    else if (acao === 'boletos') setBoletos(marcadas.map(paraCobrar));
    else if (acao === 'carne') setCarne(marcadas.map(paraCobrar));
    else if (acao === 'desmarcar') setSelecionadas(new Map());
    else void selecionarTodasDoFiltro();
  }
  const paginaToda = Boolean(dados && dados.linhas.length > 0 && dados.linhas.every(l => selecionadas.has(l.chave)));
  const t = dados?.totais;

  const opcoesCategoria = [...categorias]
    .filter(c => f.tipo === 'ambos' || (f.tipo === 'pagar' ? c.tipo !== 'RECEITA' : c.tipo !== 'DESPESA'))
    .sort((a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), undefined, { numeric: true }));

  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <div ref={moldura} onKeyDown={teclado} className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          empresas
          icone={Scale}
          titulo="Contas a Pagar/Receber"
          subtitulo="O que a agência tem a pagar e a receber, numa lista só. Marque várias para liquidar, reagendar ou mudar a categoria de uma vez."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeEditar ? {
            rotulo: 'Nova conta', icone: Plus,
            menu: [
              { rotulo: 'Conta a pagar', descricao: 'Fornecedor, despesa, custo de venda', icone: ArrowUpRight, href: '/financeiro-ag/pagar?nova=1' },
              { rotulo: 'Conta a receber', descricao: 'Reembolso, acerto, aluguel', icone: ArrowDownLeft, href: '/financeiro-ag/receber?nova=outro' },
            ],
          } : undefined}
          acoesSecundarias={[
            { rotulo: 'Só contas a pagar', href: '/financeiro-ag/pagar' },
            { rotulo: 'Só contas a receber', href: '/financeiro-ag/receber' },
          ]}
        />

        <FilterBar
          busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: f.em === 'tudo' ? 'Pesquisar pessoa, descrição…' : `Pesquisar em ${ROTULO_EM[f.em].toLowerCase()}` }}
          periodo={{
            valor: f.periodo, de: f.de, ate: f.ate, opcoes: PERIODOS,
            onChange: (chave, range) => mudar({ periodo: chave, de: range.de, ate: range.ate }),
          }}
          selects={[
            { id: 'cpr-em', rotulo: 'Em', valor: f.em, onChange: v => mudar({ em: v as CampoDaBusca }),
              opcoes: CAMPOS_DA_BUSCA.map(c => ({ valor: c, rotulo: ROTULO_EM[c] })) },
            { id: 'cpr-data', rotulo: 'Data de', valor: f.data, onChange: v => mudar({ data: v as DataDoFiltro }),
              opcoes: (Object.keys(ROTULO_DATA) as DataDoFiltro[]).map(d => ({ valor: d, rotulo: ROTULO_DATA[d] })) },
            { id: 'cpr-situacao', rotulo: 'Situação', valor: f.situacao, onChange: v => mudar({ situacao: v as SituacaoDoFiltro }),
              opcoes: (Object.keys(ROTULO_SITUACAO) as SituacaoDoFiltro[]).map(s => ({ valor: s, rotulo: ROTULO_SITUACAO[s] })) },
            { id: 'cpr-tipo', rotulo: 'Tipo', valor: f.tipo, onChange: v => mudar({ tipo: v as Filtros['tipo'] }),
              opcoes: [{ valor: 'ambos', rotulo: 'Pagar e receber' }, { valor: 'pagar', rotulo: 'A pagar' }, { valor: 'receber', rotulo: 'A receber' }] },
            { id: 'cpr-categoria', rotulo: 'Categoria', valor: f.categoria || TODOS, onChange: v => mudar({ categoria: v === TODOS ? '' : v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todas' }, ...opcoesCategoria.map(c => ({ valor: c.id, rotulo: `${c.codigo ? `${c.codigo} · ` : ''}${c.nome}` }))] },
            ...(centros.length ? [{ id: 'cpr-centro', rotulo: 'Centro', valor: f.centro || TODOS, onChange: (v: string) => mudar({ centro: v === TODOS ? '' : v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos' }, ...centros.map(c => ({ valor: c.id, rotulo: c.nome }))] }] : []),
            ...(contasEscolhiveis.length ? [{ id: 'cpr-conta', rotulo: 'Conta', valor: f.conta || TODOS, onChange: (v: string) => mudar({ conta: v === TODOS ? '' : v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todas' }, ...contasEscolhiveis.map(c => ({ valor: c.id, rotulo: c.nome }))] }] : []),
            { id: 'cpr-cobranca', rotulo: 'Cobrança', valor: f.cobranca, onChange: v => mudar({ cobranca: v as CobrancaDoFiltro }),
              opcoes: (Object.keys(ROTULO_COBRANCA) as CobrancaDoFiltro[]).map(c => ({ valor: c, rotulo: ROTULO_COBRANCA[c] })) },
          ]}
          resumo={{
            exibidos: dados?.linhas.length ?? 0,
            total: dados?.total ?? 0,
            substantivo: 'contas',
          }}
          ativos={ativos}
          onLimpar={limpar}
        />
        {!datasValidas ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
          <Button type="button" variant="outline" size="sm" aria-expanded={mostrarColunas} onClick={() => setMostrarColunas(v => !v)} className="h-11 gap-[var(--fin-s-2)] lg:h-9">
            <Columns3 aria-hidden="true" className="size-4" />
            Colunas
          </Button>
          <p className="hidden fin-t-caption text-[var(--fin-text-3)] lg:block">
            Duplo clique abre a conta. Clique direito mostra as ações. Esc limpa os filtros.
          </p>
          <BotaoExportar
            origem="contas"
            podeExportar={pode('exportar')}
            desabilitado={!dados?.total}
            endereco={f => enderecoDaExportacao(`${recorte}&ordem=${ordemDaColuna(ordem.coluna) ?? 'vencimento'}&direcao=${ordem.direcao}`, f)}
          />
        </div>

        {mostrarColunas ? (
          <fieldset className="flex flex-wrap gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
            <legend className="sr-only">Colunas visíveis</legend>
            {[...COLUNAS_ESCOLHIVEIS, ...campos.map(c => ({ id: `campo:${c.id}` as ColunaId, rotulo: c.nome }))].map(c => (
              <label key={c.id} className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:min-h-8">
                <input
                  type="checkbox"
                  checked={colunas.includes(c.id)}
                  disabled={COLUNAS_FIXAS.includes(c.id)}
                  onChange={e => trocarColunas(e.target.checked ? [...colunas, c.id] : colunas.filter(x => x !== c.id))}
                  className="size-4 accent-[var(--fin-accent)]"
                />
                {c.rotulo}
              </label>
            ))}
            <button type="button" onClick={() => trocarColunas([...COLUNAS_PADRAO])} className="inline-flex min-h-11 items-center fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline lg:min-h-8">
              Voltar ao padrão
            </button>
          </fieldset>
        ) : null}

        {verExcluidas ? (
          <p className="fin-t-body text-[var(--fin-text-2)]">
            Contas excluídas não entram nos totais, nos relatórios nem no fluxo de caixa. Restaurar devolve a conta à lista;
            o que tinha sido pago ou recebido voltou ao caixa na exclusão e não volta sozinho.
          </p>
        ) : null}

        {selecionadas.size > 0 && !verExcluidas ? (
          <BarraDoLote
            marcadas={marcadas}
            totalDoFiltro={dados?.total ?? 0}
            oferecerTodas={Boolean(paginaToda && dados && dados.total > dados.linhas.length && selecionadas.size < dados.total)}
            marcandoTodas={selecionandoTodas}
            pode={{
              liquidar: pode('liquidar_pagar') || pode('liquidar_receber'), editar: podeEditar, excluir: podeExcluir,
              boletos: pode('gerar_boletos'),
              carne: provedor && PROVEDORES[provedor].capacidades.carne ? { motivo: motivoSemCarne(marcadas.map(paraCobrar), provedor) } : null,
            }}
            onAcao={acaoDaBarra}
          />
        ) : null}

        <FinTable<LinhaDeConta>
          linhas={dados?.linhas ?? []}
          colunas={colunasDaTabela}
          colunasVisiveis={colunasVisiveisDaTabela}
          chave={l => l.chave}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          vazio={verExcluidas
            ? {
                motivo: 'sem-resultado',
                titulo: 'Nenhuma conta excluída neste filtro',
                oQueE: 'Contas excluídas ficam guardadas aqui e podem ser restauradas. Experimente um período maior.',
                acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar },
              }
            : ativos > 0
            ? {
                motivo: 'sem-resultado',
                titulo: 'Nenhuma conta neste filtro',
                oQueE: 'Nenhuma conta a pagar ou a receber se encaixa nos filtros escolhidos.',
                acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar },
              }
            : {
                motivo: 'sem-dado',
                titulo: 'Nenhuma conta vence neste mês',
                oQueE: 'Aqui aparecem juntas as contas que a agência tem a pagar e a receber, com a situação e o saldo de cada uma.',
                comoComeca: ['Escolha um período maior no filtro.', 'Ou lance uma conta nova pelo botão Nova conta.'],
              }}
          selecao={verExcluidas ? undefined : {
            selecionadas: new Set(selecionadas.keys()),
            onAlterar: alterarSelecao,
            rotulo: l => `Marcar ${l.pessoa || 'conta'}${l.descricao ? `, ${l.descricao}` : ''}`,
          }}
          ordemControlada={{ colunaId: ordem.coluna, direcao: ordem.direcao, onOrdenar: ordenar }}
          onLinhaDuploClique={l => { if (l.situacao === 'excluido') { if (podeEditar) setRestaurando(l); } else abrir(l); }}
          onLinhaMenu={(linha, posicao) => setMenu({ linha, posicao })}
          rodape={dados && t ? (
            <RodapeDaLista
              totais={t}
              pagina={dados.pagina}
              totalPaginas={dados.total_paginas}
              porPagina={porPagina}
              onPorPagina={n => { setPorPagina(n); setPagina(1); }}
              onPagina={setPagina}
            />
          ) : null}
        />
        {carregando && dados ? <span className="sr-only" role="status">Atualizando a lista.</span> : null}
      </div>

      <MenuDaLinha
        aberto={Boolean(menu)}
        posicao={menu?.posicao ?? { x: 0, y: 0 }}
        titulo={menu ? `${menu.linha.pessoa || 'Conta'} · ${rotuloDaSituacao(menu.linha)}` : ''}
        itens={menu ? itensDoMenu(menu.linha) : []}
        onFechar={() => setMenu(null)}
      />

      <ConfirmDialog
        aberto={Boolean(restaurando)}
        onOpenChange={aberto => { if (!aberto) setRestaurando(null); }}
        titulo="Restaurar esta conta?"
        oQueVaiAcontecer={restaurando && restaurando.estornado_na_exclusao > 0
          ? `A conta volta para a lista, em aberto. Os ${formatBRL(restaurando.estornado_na_exclusao)} que tinham sido ${restaurando.tipo === 'pagar' ? 'pagos' : 'recebidos'} voltaram ao caixa na exclusão: se o dinheiro saiu ou entrou de verdade, liquide de novo.`
          : 'A conta volta para a lista, para os totais e para os relatórios, como estava antes de ser excluída.'}
        detalhes={restaurando ? [
          ...(restaurando.numero !== null ? [{ rotulo: 'Nº', valor: String(restaurando.numero) }] : []),
          { rotulo: restaurando.tipo === 'pagar' ? 'Fornecedor' : 'Cliente', valor: restaurando.pessoa || '—' },
          { rotulo: 'Valor', valor: formatBRL(restaurando.valor) },
          ...(restaurando.excluido_por ? [{ rotulo: 'Excluída por', valor: restaurando.excluido_por }] : []),
        ] : undefined}
        confirmarRotulo="Restaurar conta"
        voltarRotulo="Deixar excluída"
        processando={gravandoRestauro}
        onConfirmar={async () => { if (restaurando) await restaurar(restaurando); }}
      />

      <LiquidarEmLote
        linhas={liquidar}
        contas={contasParaLiquidar}
        onFechar={() => setLiquidar(null)}
        onConcluido={() => { setLiquidar(null); aposLote(); }}
      />

      <EmitirCobrancas
        contas={boletos}
        onFechar={() => setBoletos(null)}
        onConcluido={aposLote}
      />

      <GerarCarne
        contas={carne}
        onFechar={() => setCarne(null)}
        onConcluido={aposLote}
      />

      <AcaoEmLote
        acao={lote?.acao ?? null}
        linhas={lote?.linhas ?? []}
        categorias={categorias}
        centros={centros}
        onFechar={() => setLote(null)}
        onConcluido={aposLote}
      />
    </MolduraDaPagina>
  );
}

