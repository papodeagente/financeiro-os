'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Columns3, ShoppingCart, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Segmentado } from '@/components/fin/Segmentado';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { BotaoExportar, usePodeExportar } from '@/components/fin/BotaoExportar';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { GradeDinamica } from '@/app/financeiro-ag/resultado-por-categoria/GradeDinamica';
import { FormularioDeEnvio } from '@/components/relatorios/FormularioDeEnvio';
import {
  CAMPOS_DA_DINAMICA, DATAS_BASE, RELATORIOS, ROTULO_DATA_BASE, ROTULO_RELATORIO, registrosDaDinamica,
  type ColunaDoRelatorio, type DataBase, type LinhaDoRelatorio, type OpcoesDosFiltros, type OrdemDoRanking, type TipoDeRelatorio,
} from '@/lib/relatorios-vendas';
import { montarTabelaDinamica, registrosDaCelula } from '@/lib/tabela-dinamica';
import { hojeISO } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Relatórios de vendas (E5, parte F; E7): por produto (colunas escolhíveis, a
 * receita aberta por componente), por vendedor, unidade, fornecedor, forma de
 * pagamento, os pagamentos um a um, ranking de clientes (por faturamento ou
 * receita) e a tabela dinâmica. Filtros por fornecedor, vendedor, produto,
 * unidade, situação do produto e qual data vale; gráfico de barras do recorte;
 * Excel, PDF e Imprimir; agendar o envio por e-mail. Clicar abre a venda. O
 * ganho da agência só aparece para quem pode vê-lo (o servidor nem manda).
 */

interface Resposta {
  relatorio: TipoDeRelatorio;
  titulo: string;
  colunas: ColunaDoRelatorio[];
  catalogo: ColunaDoRelatorio[];
  medidas: ColunaDoRelatorio[];
  linhas: LinhaDoRelatorio[];
  totais: LinhaDoRelatorio;
  opcoes: OpcoesDosFiltros;
  serie: Array<{ mes: string; rotulo: string; centavos: number }>;
  ver_receita: boolean;
  so_as_suas: boolean;
  ordem: OrdemDoRanking;
  quantidade_vendas: number;
}

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const ROTULO_CURTO: Record<TipoDeRelatorio, string> = {
  produto: 'Por produto', vendedor: 'Por vendedor', unidade: 'Por unidade', fornecedor: 'Por fornecedor', forma: 'Por forma de pagamento',
  pagamentos: 'Pagamentos', clientes: 'Ranking de clientes', dinamica: 'Tabela dinâmica',
};
const AGRUPADOS: TipoDeRelatorio[] = ['vendedor', 'unidade', 'fornecedor', 'clientes'];
const dataBR = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : '');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Filtros {
  data_base: DataBase;
  vendedor: string;
  fornecedor: string;
  tipo: string;
  produto: string;
  unidade: string;
  situacao_produto: 'todos' | 'ativos' | 'cancelados';
}
const SEM_FILTRO: Filtros = { data_base: 'venda', vendedor: '', fornecedor: '', tipo: '', produto: '', unidade: '', situacao_produto: 'todos' };

function colunaDaTabela(c: ColunaDoRelatorio, i: number): FinColuna<LinhaDoRelatorio> {
  const base = { id: c.id, cabecalho: c.rotulo, sortable: true as const, prioridade: (i < 3 ? 3 : i < 6 ? 2 : 1) as 1 | 2 | 3 };
  if (c.tipo === 'dinheiro') return { ...base, tipo: 'dinheiro', valor: l => Number(l[c.id] ?? 0) / 100 };
  if (c.tipo === 'data') return { ...base, tipo: 'data', valor: l => (l[c.id] ? String(l[c.id]) : null) };
  if (c.tipo === 'percentual') return { ...base, tipo: 'texto', acessor: l => Number(l[c.id] ?? 0), render: l => <span className="tabular-nums">{Number(l[c.id] ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span> };
  if (c.tipo === 'numero') return { ...base, tipo: 'texto', acessor: l => Number(l[c.id] ?? 0), render: l => <span className="tabular-nums">{Number(l[c.id] ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</span> };
  return { ...base, tipo: 'texto', acessor: l => String(l[c.id] ?? ''), render: l => <span className={i === 0 ? 'fin-t-body-strong text-[var(--fin-text)]' : undefined}>{String(l[c.id] ?? '') || '—'}</span> };
}

/** O gráfico de barras do recorte (só o que a tabela já mostra). */
function barrasDoRelatorio(d: Resposta): { titulo: string; sublinha: string; linhas: LinhaBarra[] } | null {
  const metrica = d.ordem === 'receita' && d.ver_receita ? 'receita' : 'faturamento';
  const nomeMetrica = metrica === 'receita' ? 'receita da agência' : 'faturamento';
  if (d.relatorio === 'produto' || d.relatorio === 'pagamentos' || d.relatorio === 'dinamica') {
    if (d.relatorio !== 'produto' || d.serie.length < 2) return null;
    return {
      titulo: 'Faturamento por mês', sublinha: 'Mês a mês, na ordem do calendário.',
      linhas: d.serie.map(p => ({ id: p.mes, nome: p.rotulo, valor: p.centavos / 100 })),
    };
  }
  if (d.relatorio === 'forma') {
    return {
      titulo: 'Quanto entrou por forma de pagamento', sublinha: 'Do maior para o menor valor.',
      linhas: d.linhas.map(l => ({ id: String(l.forma ?? l.grupo), nome: String(l.grupo), valor: Number(l.valor ?? 0) / 100, secundario: `${l.vendas} ${Number(l.vendas) === 1 ? 'venda' : 'vendas'}` })),
    };
  }
  const nomeGrupo = d.relatorio === 'clientes' ? 'clientes' : d.relatorio === 'vendedor' ? 'vendedores' : d.relatorio === 'unidade' ? 'unidades' : 'fornecedores';
  return {
    titulo: `Os 10 ${nomeGrupo} com mais ${nomeMetrica}`, sublinha: `Do maior para o menor ${nomeMetrica}, todos na mesma escala.`,
    linhas: d.linhas.slice(0, 10).map(l => ({
      id: String(l.grupo), nome: String(l.grupo), valor: Number(l[metrica] ?? 0) / 100,
      secundario: `${l.vendas} ${Number(l.vendas) === 1 ? 'venda' : 'vendas'}${metrica === 'faturamento' && d.ver_receita && l.receita !== undefined ? ` · receita ${brl(Number(l.receita) / 100)}` : ''}`,
    })),
  };
}

/** A tela inteira; a página só diz como abrir a venda (o roteador do app). */
export function RelatoriosDeVendas({ abrirVenda }: { abrirVenda: (vendaId: string) => void }) {
  const hoje = hojeISO();
  const [relatorio, setRelatorio] = React.useState<TipoDeRelatorio>('produto');
  const [de, setDe] = React.useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = React.useState(hoje);
  const [situacao, setSituacao] = React.useState('todas');
  const [canceladas, setCanceladas] = React.useState(false);
  const [filtros, setFiltros] = React.useState<Filtros>(SEM_FILTRO);
  const [buscaDigitada, setBuscaDigitada] = React.useState('');
  const [ordem, setOrdem] = React.useState<OrdemDoRanking>('faturamento');
  const [soLiquidados, setSoLiquidados] = React.useState(false);
  const [escolhidas, setEscolhidas] = React.useState<Record<string, string[]>>({});
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  // Tabela dinâmica: linhas, coluna e o número somado.
  const [linhaA, setLinhaA] = React.useState<string>('Vendedor');
  const [linhaB, setLinhaB] = React.useState<string>('Tipo de produto');
  const [colunaDin, setColunaDin] = React.useState<string>('Mês');
  const [medida, setMedida] = React.useState('faturamento');
  const [celula, setCelula] = React.useState<{ titulo: string; vendas: Array<{ venda_id: string; venda_numero: string; centavos: number }> } | null>(null);
  const [agendando, setAgendando] = React.useState(false);
  const [crmLigado, setCrmLigado] = React.useState<boolean | null>(null);
  const podeExportar = usePodeExportar();

  // Link do "Perguntar em texto" (E7): o relatório, o período, a ordem e os
  // filtros que a resposta usou vêm no endereço. Sem parâmetro, a tela de sempre.
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const pedido = p.get('relatorio');
    if (!pedido || !(RELATORIOS as readonly string[]).includes(pedido)) return;
    const data = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(p.get(k) ?? '') ? p.get(k)! : '');
    setRelatorio(pedido as TipoDeRelatorio);
    setDe(data('de'));
    setAte(data('ate'));
    if (p.get('ordem') === 'receita') setOrdem('receita');
    const fornecedor = (p.get('fornecedor') ?? '').slice(0, 200);
    const vendedor = (p.get('vendedor') ?? '').slice(0, 200);
    if (fornecedor || vendedor) setFiltros(f => ({ ...f, fornecedor, vendedor }));
  }, []);

  // A busca no produto espera a pessoa parar de digitar.
  React.useEffect(() => {
    const t = setTimeout(() => setFiltros(f => (f.produto === buscaDigitada ? f : { ...f, produto: buscaDigitada })), 350);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  /** Os filtros como parâmetros (a tela, o arquivo e o envio agendado usam os mesmos). */
  const parametros = React.useCallback((comDatas = true) => {
    const q = new URLSearchParams({ relatorio });
    if (situacao !== 'todas') q.set('situacao', situacao);
    if (comDatas && de) q.set('de', de);
    if (comDatas && ate) q.set('ate', ate);
    if (canceladas) q.set('canceladas', '1');
    const cols = escolhidas[relatorio];
    if (cols?.length) q.set('colunas', cols.join(','));
    if (filtros.data_base !== 'venda') q.set('data_base', filtros.data_base);
    for (const k of ['vendedor', 'fornecedor', 'tipo', 'produto', 'unidade'] as const) if (filtros[k].trim()) q.set(k, filtros[k].trim());
    if (filtros.situacao_produto !== 'todos') q.set('situacao_produto', filtros.situacao_produto);
    if (ordem !== 'faturamento' && AGRUPADOS.includes(relatorio)) q.set('ordem', ordem);
    if (soLiquidados && relatorio === 'pagamentos') q.set('so_liquidados', '1');
    if (relatorio === 'dinamica') {
      q.set('din_linhas', [linhaA, linhaB].filter(Boolean).join(','));
      q.set('din_coluna', colunaDin);
      q.set('din_medida', medida);
    }
    return q;
  }, [relatorio, situacao, de, ate, canceladas, escolhidas, filtros, ordem, soLiquidados, linhaA, linhaB, colunaDin, medida]);

  // A tabela dinâmica é montada no navegador: trocar linhas/colunas não recarrega.
  const consultaDaTela = React.useMemo(() => {
    const q = parametros();
    q.delete('din_linhas'); q.delete('din_coluna'); q.delete('din_medida');
    return `/api/relatorios/vendas?${q}`;
  }, [parametros]);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch(consultaDaTela);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível montar o relatório.');
      setDados(j);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível montar o relatório.');
      setEstado('erro');
    }
  }, [consultaDaTela]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const linhas = dados?.linhas ?? [];
  const colunas = React.useMemo(() => (dados?.colunas ?? []).map(colunaDaTabela), [dados?.colunas]);
  const visiveis = new Set((dados?.colunas ?? []).map(c => c.id));
  const totais = (dados?.colunas ?? []).filter(c => c.tipo === 'dinheiro').map(c => ({ colunaId: c.id, valor: Number(dados?.totais[c.id] ?? 0) / 100, rotulo: 'Total' }));

  const registros = React.useMemo(() => (relatorio === 'dinamica' ? registrosDaDinamica(linhas, medida) : []), [relatorio, linhas, medida]);
  const camposLinha = [linhaA, linhaB].filter((c, i, a) => c && a.indexOf(c) === i && c !== colunaDin);
  const tabela = React.useMemo(() => montarTabelaDinamica(registros, camposLinha, colunaDin ? [colunaDin] : []), [registros, camposLinha.join('|'), colunaDin]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternarColuna = (id: string) => {
    const atuais = escolhidas[relatorio]?.length ? escolhidas[relatorio] : (dados?.colunas ?? []).map(c => c.id);
    const prox = atuais.includes(id) ? atuais.filter(x => x !== id) : [...atuais, id];
    setEscolhidas(e => ({ ...e, [relatorio]: prox.length ? prox : atuais }));
  };
  const mudar = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setFiltros(f => ({ ...f, [k]: v }));
  const temFiltro = (Object.keys(SEM_FILTRO) as Array<keyof Filtros>).some(k => filtros[k] !== SEM_FILTRO[k]) || buscaDigitada !== '';
  const limpar = () => { setFiltros(SEM_FILTRO); setBuscaDigitada(''); };

  const opcoes = dados?.opcoes ?? { fornecedores: [], vendedores: [], unidades: [], tipos: [] };
  const nomeDe = (lista: { valor: string; rotulo: string }[], v: string) => lista.find(o => o.valor === v)?.rotulo ?? v.replace(/^(id|nome):/, '');
  const resumoDosFiltros = [
    ROTULO_RELATORIO[relatorio],
    filtros.data_base !== 'venda' ? `período pela ${ROTULO_DATA_BASE[filtros.data_base].toLowerCase()}` : '',
    situacao !== 'todas' ? `vendas ${situacao}` : '',
    canceladas ? 'com as canceladas' : '',
    filtros.vendedor ? `vendedor ${nomeDe(opcoes.vendedores, filtros.vendedor)}` : '',
    filtros.fornecedor ? `fornecedor ${nomeDe(opcoes.fornecedores, filtros.fornecedor)}` : '',
    filtros.tipo ? nomeDe(opcoes.tipos, filtros.tipo) : '',
    filtros.produto ? `produto com "${filtros.produto}"` : '',
    filtros.unidade ? `unidade ${filtros.unidade}` : '',
    filtros.situacao_produto !== 'todos' ? `só produtos ${filtros.situacao_produto}` : '',
    ordem === 'receita' && AGRUPADOS.includes(relatorio) ? 'ordem pela receita' : '',
    soLiquidados && relatorio === 'pagamentos' ? 'só pagamentos liquidados' : '',
  ].filter(Boolean).join(' · ');

  const abrirAgendamento = () => {
    setAgendando(true);
    if (crmLigado === null) {
      fetch('/api/relatorios/agendados').then(r => (r.ok ? r.json() : null)).then(j => setCrmLigado(j ? Boolean(j.crm_ligado) : null)).catch(() => undefined);
    }
  };

  const barras = dados && estado === 'ok' ? barrasDoRelatorio(dados) : null;

  return (
    <MolduraDaPagina>
      <PageHeader
        empresas
        icone={ShoppingCart}
        titulo="Relatórios de vendas"
        subtitulo="Faturamento e receita da agência, aberta por componente. Clique numa linha para abrir a venda."
        acoesSecundarias={[{ rotulo: 'Envios agendados', href: '/relatorios/envios' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <div className="overflow-x-auto">
        <Segmentado<TipoDeRelatorio> rotulo="Relatório" valor={relatorio} onChange={setRelatorio}
          opcoes={RELATORIOS.map(r => ({ valor: r, rotulo: ROTULO_CURTO[r] }))} />
      </div>

      <section aria-label="Filtros" className="flex flex-col gap-[var(--fin-s-3)]">
        <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
          <label className="flex flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Período pela</span>
            <select className={CAMPO} value={filtros.data_base} onChange={e => mudar('data_base', e.target.value as DataBase)}>
              {DATAS_BASE.map(b => <option key={b} value={b}>{ROTULO_DATA_BASE[b].toLowerCase()}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="fin-t-caption font-medium text-[var(--fin-text-2)]">De</span><input type="date" className={CAMPO} value={de} onChange={e => setDe(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Até</span><input type="date" className={CAMPO} value={ate} onChange={e => setAte(e.target.value)} /></label>
          <label className="flex flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Vendas</span>
            <select className={CAMPO} value={situacao} onChange={e => setSituacao(e.target.value)}>
              <option value="todas">Todas</option><option value="abertas">Abertas</option><option value="fechadas">Fechadas</option>
            </select>
          </label>
          <label className="flex h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:h-10">
            <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={canceladas} onChange={e => setCanceladas(e.target.checked)} />
            Incluir canceladas
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
          <label className="flex min-w-[10rem] flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Vendedor</span>
            <select className={CAMPO} value={filtros.vendedor} onChange={e => mudar('vendedor', e.target.value)} disabled={dados?.so_as_suas}>
              <option value="">Todos</option>
              {opcoes.vendedores.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex min-w-[10rem] flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Fornecedor</span>
            <select className={CAMPO} value={filtros.fornecedor} onChange={e => mudar('fornecedor', e.target.value)}>
              <option value="">Todos</option>
              {opcoes.fornecedores.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex min-w-[9rem] flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Produto</span>
            <select className={CAMPO} value={filtros.tipo} onChange={e => mudar('tipo', e.target.value)}>
              <option value="">Todos</option>
              {opcoes.tipos.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Buscar no produto</span>
            <input type="search" className={cn(CAMPO, 'w-48')} value={buscaDigitada} placeholder="Hotel, localizador…" onChange={e => setBuscaDigitada(e.target.value)} />
          </label>
          <label className="flex min-w-[9rem] flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Unidade</span>
            <select className={CAMPO} value={filtros.unidade} onChange={e => mudar('unidade', e.target.value)}>
              <option value="">Todas</option>
              {opcoes.unidades.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Situação do produto</span>
            <select className={CAMPO} value={filtros.situacao_produto} onChange={e => mudar('situacao_produto', e.target.value as Filtros['situacao_produto'])}>
              <option value="todos">Todos</option><option value="ativos">Ativos</option><option value="cancelados">Cancelados</option>
            </select>
          </label>
          {temFiltro ? (
            <Button type="button" variant="ghost" size="sm" onClick={limpar} className="h-11 gap-1.5 lg:h-10">
              <X aria-hidden="true" className="size-4" /> Limpar filtros
            </Button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
        {AGRUPADOS.includes(relatorio) && dados?.ver_receita ? (
          <Segmentado<OrdemDoRanking> rotulo="Ordenar por" valor={ordem} onChange={setOrdem}
            opcoes={[{ valor: 'faturamento', rotulo: 'Faturamento' }, { valor: 'receita', rotulo: 'Receita' }]} />
        ) : null}
        {relatorio === 'pagamentos' ? (
          <label className="flex h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:h-10">
            <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={soLiquidados} onChange={e => setSoLiquidados(e.target.checked)} />
            Só os já recebidos por inteiro
          </label>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-[var(--fin-s-2)]">
          {relatorio !== 'dinamica' && relatorio !== 'forma' && dados ? (
            <details className="relative">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[13px] font-medium text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)] lg:h-9">
                <Columns3 aria-hidden="true" className="size-4" /> Colunas
              </summary>
              <div className="absolute right-0 z-[var(--fin-z-popover)] mt-1 flex max-h-80 w-64 flex-col gap-1 overflow-y-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-2)] shadow-[var(--fin-e1)]">
                {dados.catalogo.map(c => (
                  <label key={c.id} className="flex h-9 shrink-0 cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]">
                    <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={visiveis.has(c.id)} onChange={() => alternarColuna(c.id)} />
                    {c.rotulo}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <BotaoExportar origem="relatorios_vendas" podeExportar={podeExportar} desabilitado={!dados}
            endereco={formato => { const q = parametros(); q.set('formato', formato); return `/api/relatorios/vendas?${q}`; }} />
          {podeExportar ? (
            <Button type="button" variant="outline" size="sm" onClick={abrirAgendamento} className="h-11 gap-[var(--fin-s-2)] lg:h-9">
              <CalendarClock aria-hidden="true" className="size-4" /> Agendar envio
            </Button>
          ) : null}
        </div>
      </div>

      <div className={RITMO_DA_PAGINA}>
        {dados?.so_as_suas ? <Callout tom="info">Mostrando só as suas vendas.</Callout> : null}
        {dados && !dados.ver_receita ? <Callout tom="info">A receita da agência e os componentes não aparecem para o seu acesso.</Callout> : null}

        {barras && barras.linhas.length > 1 ? (
          <GraficoMoldura
            titulo={barras.titulo}
            sublinha={barras.sublinha}
            estado="ok"
            descricao={`${barras.titulo}: ${barras.linhas.slice(0, 3).map(l => `${l.nome} ${brl(Number(l.valor ?? 0))}`).join(', ')}.`}
            tabela={{ colunas: ['Nome', 'Valor'], linhas: barras.linhas.map(l => [l.nome, brl(Number(l.valor ?? 0))]) }}
          >
            <BarrasNomeadas linhas={barras.linhas} formatar={brl} ordenacao="dada" />
          </GraficoMoldura>
        ) : null}

        {relatorio === 'dinamica' ? (
          <DataState estado={estado} erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
            esqueleto={<div className="h-96 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}>
            <section aria-label="Montagem da tabela" className="flex flex-wrap items-end gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
              {([['Linhas', linhaA, setLinhaA], ['Depois', linhaB, setLinhaB], ['Colunas', colunaDin, setColunaDin]] as const).map(([rot, val, set]) => (
                <label key={rot} className="flex flex-col gap-1">
                  <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">{rot}</span>
                  <select className={CAMPO} value={val} onChange={e => set(e.target.value)}>
                    <option value="">Nenhum</option>
                    {CAMPOS_DA_DINAMICA.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Somar</span>
                <select className={CAMPO} value={medida} onChange={e => setMedida(e.target.value)}>
                  {(dados?.medidas ?? []).map(m => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
                </select>
              </label>
            </section>
            <div className="mt-[var(--fin-s-4)]">
              {registros.length ? (
                <GradeDinamica tabela={tabela} onAbrirCelula={(caminho, coluna, titulo) => {
                  const regs = registrosDaCelula(registros, tabela, caminho, coluna);
                  const porVenda = new Map<string, { venda_id: string; venda_numero: string; centavos: number }>();
                  for (const r of regs) {
                    const v = porVenda.get(r.ref!.venda_id) ?? { ...r.ref!, centavos: 0 };
                    v.centavos += r.centavos;
                    porVenda.set(r.ref!.venda_id, v);
                  }
                  setCelula({ titulo, vendas: [...porVenda.values()] });
                }} />
              ) : <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma venda no período.</p>}
            </div>
          </DataState>
        ) : (
          <FinTable<LinhaDoRelatorio>
            linhas={linhas}
            colunas={colunas}
            chave={l => `${l.venda_id ?? ''}|${String(l.grupo ?? '')}|${String(l.descricao ?? '')}|${String(l.data_venda ?? '')}|${String(l.forma ?? '')}|${linhas.indexOf(l)}`}
            estado={estado}
            erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
            vazio={temFiltro
              ? { motivo: 'sem-resultado', titulo: 'Nada com esses filtros', oQueE: 'Nenhuma venda do período passa em todos os filtros escolhidos.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar } }
              : { motivo: 'sem-resultado', titulo: 'Nenhuma venda no período', oQueE: `${ROTULO_RELATORIO[relatorio]} soma as vendas lançadas e as que chegam do CRM.`, acaoSecundaria: { rotulo: 'Ver o ano inteiro', onClick: () => setDe(`${hoje.slice(0, 4)}-01-01`) } }}
            onLinhaClick={relatorio === 'produto' || relatorio === 'pagamentos' ? l => { if (l.venda_id) abrirVenda(String(l.venda_id)); } : undefined}
            totais={totais}
            rodape={dados ? <p className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">{dados.quantidade_vendas} {dados.quantidade_vendas === 1 ? 'venda' : 'vendas'} de {dataBR(de) || 'sempre'} a {dataBR(ate) || 'hoje'}{filtros.data_base !== 'venda' ? `, pela ${ROTULO_DATA_BASE[filtros.data_base].toLowerCase()}` : ''}.</p> : null}
          />
        )}
      </div>

      {celula ? (
        <RecordSheet aberto onOpenChange={o => { if (!o) setCelula(null); }} largura={480} titulo={celula.titulo}
          descricao={`${celula.vendas.length} ${celula.vendas.length === 1 ? 'venda' : 'vendas'}`}
          acaoPrimaria={{ rotulo: 'Fechar janela', onClick: () => setCelula(null) }} acaoSecundaria={null}>
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {celula.vendas.map(v => (
              <li key={v.venda_id} className={cn('flex items-center justify-between gap-[var(--fin-s-3)] py-[var(--fin-s-2)]')}>
                <Link href={`/vendas/${encodeURIComponent(v.venda_id)}/ficha`} className="fin-t-body text-[var(--fin-accent)] underline-offset-4 hover:underline">{v.venda_numero || 'Venda'}</Link>
                <span className="fin-t-body tabular-nums text-[var(--fin-text)]">{brl(v.centavos / 100)}</span>
              </li>
            ))}
          </ul>
        </RecordSheet>
      ) : null}

      {agendando ? (
        <FormularioDeEnvio
          aberto
          onFechar={() => setAgendando(false)}
          onSalvo={() => setAgendando(false)}
          consulta={parametros(false).toString()}
          nomeSugerido={ROTULO_RELATORIO[relatorio]}
          resumoDosFiltros={resumoDosFiltros}
          crmLigado={crmLigado}
        />
      ) : null}
    </MolduraDaPagina>
  );
}
