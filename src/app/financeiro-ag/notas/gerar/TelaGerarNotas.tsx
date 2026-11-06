'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, ChevronLeft, ChevronRight, FileStack, Layers, ReceiptText, Scale } from 'lucide-react';

import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import { Button } from '@/components/ui/button';
import { resolverPeriodo, type PeriodoChave } from '@/components/fin/PeriodPicker';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { apiNotas, ErroDaNota, reais, type GradeDeNotas, type PreviaDeNotas } from '@/components/financeiro/notas/api';
import { PreviaDasNotas } from '@/components/financeiro/notas/PreviaDasNotas';
import {
  DATAS_DA_NOTA, ROTULO_DATA_DA_NOTA, formatarReais, ROTULO_DESTINO, type DataDaNota, type LinhaDaGrade, type SugestaoDeCancelamento,
} from '@/lib/nota-regras';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO } from '@/lib/venda-modelo';
import { documentoDeGerarNotas } from '@/lib/exportacao/listas-financeiro';
import { toast } from '@/lib/toast';
import { formatBRL } from '@/lib/utils';

/**
 * Gerar notas (E5, parte E): a receita de cada produto vendido contra o que
 * já está em nota. O saldo vira nota pela regra (ao pagante, ao fornecedor,
 * ao representante), com prévia antes de emitir; a receita que cresceu
 * depois vira nota complementar; a nota que passou da receita aparece para
 * cancelar, sem nada ser cancelado sozinho.
 */

const PERIODOS: PeriodoChave[] = ['MES_ATUAL', 'MES_PASSADO', 'PROX_30', 'TUDO', 'PERSONALIZADO'];
type Mostrar = 'pendentes' | 'tudo';
type DataDe = 'VENDA' | 'EMBARQUE';
const TODOS = '';
type Filtros = {
  periodo: PeriodoChave; de: string; ate: string; mostrar: Mostrar; busca: string;
  dataDe: DataDe; tipo: string; vendedor: string; fornecedor: string;
};

function filtrosPadrao(): Filtros {
  const r = resolverPeriodo('MES_ATUAL');
  return { periodo: 'MES_ATUAL', de: r.de, ate: r.ate, mostrar: 'pendentes', busca: '', dataDe: 'VENDA', tipo: TODOS, vendedor: TODOS, fornecedor: TODOS };
}

/** O período filtra por uma data e a nota sai com outra: o aviso diz qual. */
export function avisoDasDatas(dataDe: DataDe, dataDaNota: DataDaNota): string | null {
  if (dataDaNota === 'DIA' || dataDaNota === dataDe) return null;
  return dataDaNota === 'EMBARQUE'
    ? 'A lista está pela data da venda, mas as notas saem com a data do embarque. Para conferir o mês certo, filtre pelo embarque.'
    : 'A lista está pela data do embarque, mas as notas saem com a data da venda. Para conferir o mês certo, filtre pela venda.';
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

const chaveDaLinha = (l: LinhaDaGrade) => `${l.venda_id}::${l.produto_id}`;
const dataBR = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export function TelaGerarNotas() {
  const router = useRouter();
  const pode = usePermissoes();
  const [f, setF] = React.useState<Filtros>(filtrosPadrao);
  const [dados, setDados] = React.useState<GradeDeNotas | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [previa, setPrevia] = React.useState<PreviaDeNotas | null>(null);
  const [abrindoPrevia, setAbrindoPrevia] = React.useState(false);
  const [emitindo, setEmitindo] = React.useState(false);
  const [cancelar, setCancelar] = React.useState<SugestaoDeCancelamento | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [cancelando, setCancelando] = React.useState(false);
  const [pagina, setPagina] = React.useState(1);
  // A data da nota: começa pela configuração (Regras da nota) e pode mudar aqui, só para esta emissão.
  const [dataNota, setDataNota] = React.useState<DataDaNota | null>(null);

  const busca = useDebounce(f.busca.trim());
  const datasValidas = !f.de || !f.ate || f.de <= f.ate;

  React.useEffect(() => {
    if (!datasValidas) return;
    const ac = new AbortController();
    setCarregando(true);
    apiNotas.grade({
      de: f.de || '2000-01-01', ate: f.ate || '2100-12-31', busca: busca || undefined, pendentes: f.mostrar === 'pendentes',
      data_de: f.dataDe, tipo: f.tipo || undefined, vendedor: f.vendedor || undefined, fornecedor: f.fornecedor || undefined, pagina,
    }, ac.signal)
      .then(r => {
        setDados(r); setErro(null); setAtualizadoEm(new Date());
        setDataNota(atual => atual ?? r.data_da_nota);
        if (r.pagina > r.paginas) setPagina(r.paginas);
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'A consulta não respondeu.'); })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [f.de, f.ate, f.mostrar, f.dataDe, f.tipo, f.vendedor, f.fornecedor, busca, datasValidas, versao, pagina]);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);
  const linhas = dados?.linhas ?? [];
  // Marcação só das linhas que ainda estão na lista.
  const marcadasValidas = React.useMemo(() => new Set(linhas.map(chaveDaLinha).filter(k => marcadas.has(k))), [linhas, marcadas]);
  const comSaldo = linhas.filter(l => l.a_emitir > 0);
  const podeEmitir = pode('emitir_nota');

  const padrao = filtrosPadrao();
  const ativos = (f.periodo !== padrao.periodo ? 1 : 0) + (f.mostrar !== padrao.mostrar ? 1 : 0) + (f.busca ? 1 : 0)
    + (f.dataDe !== padrao.dataDe ? 1 : 0) + (f.tipo ? 1 : 0) + (f.vendedor ? 1 : 0) + (f.fornecedor ? 1 : 0);
  const limpar = () => { setF(filtrosPadrao()); setPagina(1); };
  // Mudou o filtro: volta para a primeira página.
  const mudar = (patch: Partial<Filtros>) => { setF(a => ({ ...a, ...patch })); setPagina(1); };
  const modoData: DataDaNota = dataNota ?? dados?.data_da_nota ?? 'DIA';
  const avisoData = avisoDasDatas(f.dataDe, modoData);

  function selecaoDasMarcadas() {
    const porVenda = new Map<string, string[]>();
    for (const l of linhas) {
      if (!marcadasValidas.has(chaveDaLinha(l))) continue;
      porVenda.set(l.venda_id, [...(porVenda.get(l.venda_id) ?? []), l.produto_id]);
    }
    return [...porVenda].map(([venda_id, produto_ids]) => ({ venda_id, produto_ids }));
  }

  async function abrirPrevia() {
    const selecao = selecaoDasMarcadas();
    if (!selecao.length) { toast.info('Marque os produtos que vão para nota.'); return; }
    setAbrindoPrevia(true);
    try {
      setPrevia(await apiNotas.previa(selecao, modoData));
    } catch (e) {
      toast.error('Não foi possível montar a prévia', e instanceof Error ? e.message : undefined);
    } finally {
      setAbrindoPrevia(false);
    }
  }

  async function emitir() {
    if (!previa) return;
    setEmitindo(true);
    try {
      const r = await apiNotas.emitir(selecaoDasMarcadas(), previa.assinatura, modoData);
      const n = r.emitidas.length;
      if (n) toast.success(n === 1 ? '1 nota emitida' : `${n} notas emitidas`, r.recusadas.length ? `${r.recusadas.length} ficaram de fora: ${r.recusadas[0].motivo}` : 'Elas já aparecem em Notas fiscais.');
      else toast.error('Nenhuma nota saiu', r.recusadas[0]?.motivo);
      setPrevia(null);
      setMarcadas(new Set());
      await recarregar();
    } catch (e) {
      if (e instanceof ErroDaNota && e.codigo === 'PREVIA_MUDOU' && e.detalhes) {
        setPrevia(e.detalhes as PreviaDeNotas);
        toast.warning('Os valores mudaram desde a prévia', 'Confira a prévia nova antes de emitir.');
      } else {
        toast.error('As notas não foram emitidas', e instanceof Error ? e.message : undefined);
      }
    } finally {
      setEmitindo(false);
    }
  }

  async function confirmarCancelamento() {
    if (!cancelar || motivo.trim().length < 10) return;
    setCancelando(true);
    try {
      await apiNotas.cancelarNota(cancelar.nota_id, motivo.trim());
      toast.success('Nota cancelada', 'O cancelamento foi pedido ao emissor e fica no histórico da nota.');
      setCancelar(null);
      setMotivo('');
      await recarregar();
    } catch (e) {
      toast.error('A nota não foi cancelada', e instanceof Error ? e.message : undefined);
    } finally {
      setCancelando(false);
    }
  }

  const colunas: FinColuna<LinhaDaGrade>[] = [
    {
      id: 'venda', cabecalho: 'Venda', tipo: 'texto', sortable: true, minWidth: 180, acessor: l => l.data_venda,
      render: l => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]">
            {l.venda_numero || 'Venda'}{' '}
            <span className="fin-t-caption font-normal text-[var(--fin-text-3)]">
              {f.dataDe === 'EMBARQUE' && l.data_embarque ? `embarque ${dataBR(l.data_embarque)}` : dataBR(l.data_venda)}
            </span>
          </span>
          <span className="max-w-[32ch] truncate fin-t-caption text-[var(--fin-text-3)]" title={l.cliente_nome}>{l.cliente_nome}</span>
        </span>
      ),
    },
    {
      id: 'produto', cabecalho: 'Produto', tipo: 'texto', minWidth: 200, acessor: l => l.produto_descricao.toLowerCase(),
      render: l => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-[36ch] truncate text-[var(--fin-text)]" title={l.produto_descricao}>{l.produto_descricao || l.rotulo_tipo}</span>
          <span className="max-w-[36ch] truncate fin-t-caption text-[var(--fin-text-3)]">
            {l.rotulo_tipo}{l.fornecedor_nome ? ` · ${l.fornecedor_nome}` : ''}{l.regra_descricao ? ` · regra: ${l.regra_descricao}` : ''}
          </span>
        </span>
      ),
    },
    { id: 'receita', cabecalho: 'Receitas', tipo: 'dinheiro', sortable: true, valor: l => reais(l.receita) },
    { id: 'notas', cabecalho: 'Valor das notas', tipo: 'dinheiro', sortable: true, valor: l => reais(l.valor_notas) },
    {
      id: 'saldo', cabecalho: 'Saldo', tipo: 'dinheiro', sortable: true, valor: l => reais(l.saldo),
      tone: l => (l.saldo < 0 ? 'negativo' : 'neutro'),
      sub: l => (l.a_emitir > 0 && l.a_emitir !== l.saldo ? `a regra manda emitir ${formatarReais(l.a_emitir)}` : null),
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, valor: l => l.situacao, dominio: 'nota' },
  ];

  const colunasCancelar: FinColuna<SugestaoDeCancelamento>[] = [
    {
      id: 'nota', cabecalho: 'Nota', tipo: 'texto', minWidth: 160,
      render: c => (
        <span className="flex flex-col">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{c.numero ? `Nº ${c.numero}` : 'Sem número'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">Venda {c.venda_numero} · {c.destino ? ROTULO_DESTINO[c.destino].toLowerCase() : 'por conta a receber'}</span>
        </span>
      ),
    },
    { id: 'emitida', cabecalho: 'Emitida em', tipo: 'data', valor: c => c.emitida_em || null, prioridade: 2 },
    { id: 'motivo', cabecalho: 'Por que cancelar', tipo: 'texto', minWidth: 260, render: c => <span className="fin-t-body text-[var(--fin-text-2)]">{c.motivo}</span> },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: c => reais(c.valor_centavos) },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: c => (
        <button
          type="button"
          onClick={() => { setCancelar(c); setMotivo(''); }}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-caption text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] max-lg:h-11"
        >
          <Ban aria-hidden="true" className="size-3.5" /> Cancelar nota
        </button>
      ),
    },
  ];

  const t = dados?.totais;
  const numeros = dados ? 'ok' : carregando ? 'carregando' : 'indisponivel';
  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';
  const nMarcadas = marcadasValidas.size;

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={FileStack}
          titulo="Gerar notas"
          subtitulo="A receita de cada venda contra o que já está em nota. O saldo vira nota pela regra, com prévia antes de emitir."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeEmitir ? { rotulo: nMarcadas ? `Ver prévia (${nMarcadas})` : 'Ver prévia', icone: ReceiptText, onClick: () => { void abrirPrevia(); } } : undefined}
          acoesSecundarias={[
            { rotulo: 'Regras da nota', href: '/financeiro-ag/notas/regras' },
            { rotulo: 'Retenções na fonte', href: '/financeiro-ag/notas/retencoes' },
            { rotulo: 'Notas emitidas', href: '/financeiro-ag/notas' },
          ]}
        />

        {dados && !dados.tem_regras ? (
          <Callout
            tom="aviso"
            titulo="Ainda não há regra da nota"
            acao={{ rotulo: 'Criar a primeira regra', onClick: () => router.push('/financeiro-ag/notas/regras?nova=sugerida') }}
          >
            A regra diz para quem sai nota (o cliente, o fornecedor, o representante) e sobre o quê. Sem ela, a grade mostra a receita, mas nenhuma nota é sugerida.
          </Callout>
        ) : null}

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <MetricCard
            rotulo="Receitas" icone={Layers} valor={t ? reais(t.receita) : null} estado={numeros}
            contexto={`Dos ${linhas.length} ${linhas.length === 1 ? 'produto' : 'produtos'} na lista, pelos componentes que a agência conta como receita.`}
          />
          <MetricCard
            rotulo="Já em nota" icone={ReceiptText} valor={t ? reais(t.valor_notas) : null} estado={numeros} tomDoIcone="positivo"
            contexto="Notas autorizadas ou em emissão, pela regra e por conta a receber."
          />
          <MetricCard
            rotulo="A emitir pela regra" icone={Scale} valor={t ? reais(t.a_emitir) : null} estado={numeros} emphasis="destaque" tomDoIcone="aviso"
            contexto={comSaldo.length ? `${comSaldo.length} ${comSaldo.length === 1 ? 'produto com saldo' : 'produtos com saldo'}, complementares inclusas.` : 'Nada a emitir neste recorte.'}
          />
        </div>

        <FilterBar
          busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: 'Pesquisar venda, cliente ou produto…' }}
          periodo={{ valor: f.periodo, de: f.de, ate: f.ate, opcoes: PERIODOS, onChange: (chave, range) => mudar({ periodo: chave, de: range.de, ate: range.ate }) }}
          selects={[
            {
              id: 'notas-data-de', rotulo: 'Período pela data', valor: f.dataDe, onChange: v => mudar({ dataDe: v as DataDe }),
              opcoes: [{ valor: 'VENDA', rotulo: 'Período pela venda' }, { valor: 'EMBARQUE', rotulo: 'Período pelo embarque' }],
            },
            {
              id: 'notas-tipo', rotulo: 'Produto', valor: f.tipo, onChange: v => mudar({ tipo: v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos os produtos' }, ...TIPOS_PRODUTO.map(tp => ({ valor: tp, rotulo: ROTULO_TIPO_PRODUTO[tp] }))],
            },
            {
              id: 'notas-vendedor', rotulo: 'Vendedor', valor: f.vendedor, onChange: v => mudar({ vendedor: v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos os vendedores' }, ...(dados?.opcoes.vendedores ?? []).map(o => ({ valor: o.id, rotulo: o.nome }))],
            },
            {
              id: 'notas-fornecedor', rotulo: 'Fornecedor ou representante', valor: f.fornecedor, onChange: v => mudar({ fornecedor: v }),
              opcoes: [{ valor: TODOS, rotulo: 'Todos os fornecedores' }, ...(dados?.opcoes.fornecedores ?? []).map(o => ({ valor: o.id, rotulo: o.nome }))],
            },
            {
              id: 'notas-mostrar', rotulo: 'Mostrar', valor: f.mostrar, onChange: v => mudar({ mostrar: v as Mostrar }),
              opcoes: [{ valor: 'pendentes', rotulo: 'O que pede ação' }, { valor: 'tudo', rotulo: 'Tudo' }],
            },
          ]}
          resumo={{ exibidos: linhas.length, total: linhas.length, substantivo: linhas.length === 1 ? 'produto nesta página' : 'produtos nesta página', soma: t ? reais(t.saldo) : undefined, escopo: 'de saldo' }}
          ativos={ativos}
          onLimpar={limpar}
        />
        {!datasValidas ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p> : null}

        <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-center sm:gap-[var(--fin-s-3)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">As notas saem com</span>
          <Segmentado<DataDaNota>
            rotulo="Data das notas"
            opcoes={DATAS_DA_NOTA.map(d => ({ valor: d, rotulo: ROTULO_DATA_DA_NOTA[d] }))}
            valor={modoData}
            onChange={setDataNota}
            cheio="celular"
          />
        </div>
        {avisoData ? <Callout tom="aviso">{avisoData}</Callout> : null}
        <div className="flex justify-end">
          <BotaoExportar
            origem="gerar_notas"
            podeExportar={pode('exportar')}
            desabilitado={!linhas.length}
            documento={() => documentoDeGerarNotas(linhas, {
              de: f.de, ate: f.ate,
              mostrar: f.mostrar === 'pendentes' ? 'O que pede ação' : 'Tudo',
              busca: f.busca.trim() || undefined,
            })}
          />
        </div>

        <FinTable<LinhaDaGrade>
          linhas={linhas}
          colunas={colunas}
          chave={chaveDaLinha}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          selecao={podeEmitir ? {
            selecionadas: marcadasValidas,
            onAlterar: (chaves, marcar) => setMarcadas(atual => {
              const novo = new Set(atual);
              for (const k of chaves) { if (marcar) novo.add(k); else novo.delete(k); }
              return novo;
            }),
            rotulo: l => `Gerar nota de ${l.produto_descricao || l.rotulo_tipo}, venda ${l.venda_numero}`,
          } : undefined}
          vazio={ativos > 0
            ? { motivo: 'sem-resultado', titulo: 'Nada neste filtro', oQueE: 'As vendas continuam aqui; o recorte é que não encontrou produto.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar } }
            : {
              motivo: 'sem-dado', titulo: 'Nenhuma nota pendente neste mês',
              oQueE: 'Aqui aparece cada produto vendido, com a receita, o que já está em nota e o saldo que ainda pode ir para nota.',
              comoComeca: [
                'Cadastre as regras da nota: para quem sai e sobre quais componentes.',
                'Marque os produtos com saldo e abra a prévia.',
                'Emita. Se a receita crescer depois, a complementar aparece sozinha.',
              ],
              acao: { rotulo: 'Ver tudo do mês', onClick: () => mudar({ mostrar: 'tudo' }) },
            }}
          totais={linhas.length && t ? [
            { colunaId: 'receita', valor: reais(t.receita), rotulo: 'Receitas' },
            { colunaId: 'notas', valor: reais(t.valor_notas), rotulo: 'Em nota' },
            { colunaId: 'saldo', valor: reais(t.saldo), rotulo: 'Saldo' },
          ] : undefined}
          onLinhaDuploClique={l => router.push(`/vendas/${encodeURIComponent(l.venda_id)}/ficha`)}
        />
        {dados && dados.total_vendas > 0 ? (
          <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
            <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
              {dados.total_vendas.toLocaleString('pt-BR')} {dados.total_vendas === 1 ? 'venda' : 'vendas'} no filtro, {dados.por_pagina} por página. Os totais acima são desta página.
            </span>
            <span className="flex items-center gap-[var(--fin-s-2)]">
              <Button type="button" variant="ghost" size="icon" aria-label="Página anterior" disabled={dados.pagina <= 1 || carregando} onClick={() => setPagina(p => Math.max(1, p - 1))}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]" aria-live="polite">Página {dados.pagina} de {dados.paginas}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Próxima página" disabled={dados.pagina >= dados.paginas || carregando} onClick={() => setPagina(p => p + 1)}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </span>
          </nav>
        ) : null}

        {dados && dados.cancelar.length > 0 ? (
          <section aria-labelledby="titulo-cancelar" className="flex flex-col gap-[var(--fin-s-3)]">
            <div className="flex flex-col gap-[var(--fin-s-1)]">
              <h2 id="titulo-cancelar" className="fin-t-subhead text-[var(--fin-text)]">Notas para cancelar</h2>
              <p className="fin-t-body text-[var(--fin-text-2)]">
                Sugestão: estas notas passam da receita da venda (venda ou produto cancelado, receita que caiu). Nada é cancelado sem você confirmar.
              </p>
            </div>
            <FinTable<SugestaoDeCancelamento>
              linhas={dados.cancelar}
              colunas={colunasCancelar}
              chave={c => c.nota_id}
              densidade="compacta"
              estado="ok"
              vazio={{ motivo: 'sem-dado', titulo: 'Nada a cancelar', oQueE: 'Nenhuma nota passa da receita.' }}
            />
          </section>
        ) : null}
        {carregando && dados ? <span className="sr-only" role="status">Atualizando a lista.</span> : null}
      </div>

      <PreviaDasNotas
        previa={previa}
        emitindo={emitindo}
        podeEmitir={podeEmitir}
        onFechar={() => setPrevia(null)}
        onEmitir={emitir}
        carregando={abrindoPrevia}
      />

      <ConfirmDialog
        aberto={Boolean(cancelar)}
        onOpenChange={a => { if (!a) setCancelar(null); }}
        titulo="Cancelar a nota"
        oQueVaiAcontecer="O cancelamento é pedido ao emissor. A nota fica no histórico como cancelada, com o motivo, e o saldo da venda volta a aparecer aqui se ainda houver receita."
        detalhes={cancelar ? [
          { rotulo: 'Nota', valor: cancelar.numero ? `Nº ${cancelar.numero}` : 'Sem número' },
          { rotulo: 'Venda', valor: cancelar.venda_numero },
          { rotulo: 'Valor', valor: formatBRL(reais(cancelar.valor_centavos)) },
        ] : []}
        previa={(
          <label className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Motivo (vai para a prefeitura)</span>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={3}
              className="rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] p-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)]"
              placeholder="Ex.: venda cancelada pelo cliente em 04/11."
            />
            {motivo.trim().length > 0 && motivo.trim().length < 10 ? <span className="fin-t-caption text-[var(--fin-negative-text)]">Escreva o motivo com pelo menos 10 letras.</span> : null}
          </label>
        )}
        confirmarRotulo="Cancelar a nota"
        voltarRotulo="Manter a nota"
        tone="destrutivo"
        processando={cancelando}
        confirmarDesabilitado={motivo.trim().length < 10}
        onConfirmar={confirmarCancelamento}
      />
    </MolduraDaPagina>
  );
}
