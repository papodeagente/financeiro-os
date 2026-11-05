/**
 * Relatórios "Por categoria", "Por centro de custo" e "Por rateio"
 * (05/11/2026). Regras puras: filtros, linhas, totais, grupos,
 * ordem, página e planilha. A consulta ao banco fica em
 * lancamentos-por-dimensao-servidor.ts.
 *
 * Os filtros e colunas que o mercado usa, mais: regime de caixa
 * proporcional ao que já foi pago quando a data é de movimentação, centro em
 * árvore (filtrar um centro traz os de baixo), agrupar e ordenar, tags.
 */
import { auditCsvCell } from './audit-query';
import {
  dataMovimentoDaConta,
  dimensoesDoLancamento,
  type CategoriaDoContexto,
  type FatiaDoLancamento,
} from './dimensoes';
import { num, round2, soma } from './money';

export type Visao = 'categoria' | 'centro' | 'rateio';
export type DataDe = 'EMISSAO' | 'VENCIMENTO' | 'LIQUIDACAO' | 'MOVIMENTACAO';
export type Situacao = 'TODAS' | 'EM_ABERTO' | 'EM_ATRASO' | 'LIQUIDADO' | 'EXCLUIDO';
export type TipoFiltro = 'TODOS' | 'DESPESA' | 'RECEITA';
export type CampoPesquisa = 'TUDO' | 'PESSOA' | 'DESCRICAO' | 'CATEGORIA' | 'CENTRO' | 'DOCUMENTO' | 'NUMERO' | 'TAG';
export type Agrupar = '' | 'categoria' | 'grupo' | 'centro' | 'pessoa' | 'mes' | 'tipo';

export interface FiltrosLancamentos {
  visao: Visao;
  data_de: DataDe;
  de: string;
  ate: string;
  situacao: Situacao;
  tipo: TipoFiltro;
  incluir_repasse: boolean;
  centro_custo_id: string;
  categoria_id: string;
  tag: string;
  pesquisar: string;
  em: CampoPesquisa;
  agrupar: Agrupar;
  ordenar: string;
  direcao: 'asc' | 'desc';
  pagina: number;
  por_pagina: number;
}

export const ROTULO_DATA_DE: Record<DataDe, string> = {
  EMISSAO: 'Emissão',
  VENCIMENTO: 'Vencimento',
  LIQUIDACAO: 'Liquidação',
  MOVIMENTACAO: 'Movimentação',
};

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  TODAS: 'Todas',
  EM_ABERTO: 'Em aberto',
  EM_ATRASO: 'Em atraso',
  LIQUIDADO: 'Pago/Recebido',
  EXCLUIDO: 'Cancelado',
};

/** Na linha, a palavra de cada lado: Pago (a pagar) ou Recebido (a receber). */
export function rotuloDaSituacaoNaLinha(s: Situacao, lado: 'pagar' | 'receber'): string {
  if (s === 'LIQUIDADO') return lado === 'pagar' ? 'Pago' : 'Recebido';
  return ROTULO_SITUACAO[s];
}

export const ROTULO_EM: Record<CampoPesquisa, string> = {
  TUDO: 'Todos os campos',
  PESSOA: 'Pessoa',
  DESCRICAO: 'Descrição',
  CATEGORIA: 'Categoria',
  CENTRO: 'Centro de custo',
  DOCUMENTO: 'Documento',
  NUMERO: 'Número',
  TAG: 'Tag',
};

export const ROTULO_AGRUPAR: Record<Exclude<Agrupar, ''>, string> = {
  categoria: 'Categoria',
  grupo: 'Grupo',
  centro: 'Centro de custo',
  pessoa: 'Pessoa',
  mes: 'Mês',
  tipo: 'Tipo',
};

export class ErroFiltro extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const umDe = <T extends string>(v: string | null, lista: readonly T[], padrao: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : padrao;

/** Primeiro e último dia do mês de `hoje` (AAAA-MM-DD). */
function mesDe(hoje: string): { de: string; ate: string } {
  const [a, m] = hoje.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${hoje.slice(0, 7)}-01`, ate: `${hoje.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` };
}

/** Lê e valida os filtros da URL. Nada daqui vira SQL sem parâmetro. */
export function lerFiltros(params: URLSearchParams, hoje: string): FiltrosLancamentos {
  const mes = mesDe(hoje);
  const de = params.get('de') || mes.de;
  const ate = params.get('ate') || mes.ate;
  if (!ISO.test(de) || !ISO.test(ate)) throw new ErroFiltro('Período inválido: use datas no formato AAAA-MM-DD.');
  if (de > ate) throw new ErroFiltro('A data inicial do período vem depois da final.');
  const porPagina = Math.min(200, Math.max(1, Math.floor(Number(params.get('por_pagina')) || 50)));
  return {
    visao: umDe(params.get('visao'), ['categoria', 'centro', 'rateio'] as const, 'categoria'),
    data_de: umDe(params.get('data_de'), ['EMISSAO', 'VENCIMENTO', 'LIQUIDACAO', 'MOVIMENTACAO'] as const, 'VENCIMENTO'),
    de,
    ate,
    situacao: umDe(params.get('situacao'), ['TODAS', 'EM_ABERTO', 'EM_ATRASO', 'LIQUIDADO', 'EXCLUIDO'] as const, 'TODAS'),
    tipo: umDe(params.get('tipo'), ['TODOS', 'DESPESA', 'RECEITA'] as const, 'TODOS'),
    incluir_repasse: params.get('incluir_repasse') === '1',
    centro_custo_id: (params.get('centro_custo_id') ?? '').slice(0, 200),
    categoria_id: (params.get('categoria_id') ?? '').slice(0, 200),
    tag: (params.get('tag') ?? '').trim().slice(0, 40),
    pesquisar: (params.get('pesquisar') ?? '').trim().slice(0, 120),
    em: umDe(params.get('em'), ['TUDO', 'PESSOA', 'DESCRICAO', 'CATEGORIA', 'CENTRO', 'DOCUMENTO', 'NUMERO', 'TAG'] as const, 'TUDO'),
    agrupar: umDe(params.get('agrupar'), ['', 'categoria', 'grupo', 'centro', 'pessoa', 'mes', 'tipo'] as const, ''),
    ordenar: (params.get('ordenar') ?? '').slice(0, 40),
    direcao: params.get('direcao') === 'desc' ? 'desc' : 'asc',
    pagina: Math.max(1, Math.floor(Number(params.get('pagina')) || 1)),
    por_pagina: porPagina,
  };
}

/** Regime do valor: caixa (proporcional ao movimentado) quando a data é de movimentação. */
export function regimeDosFiltros(f: Pick<FiltrosLancamentos, 'data_de'>): 'caixa' | 'competencia' {
  return f.data_de === 'MOVIMENTACAO' ? 'caixa' : 'competencia';
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

export interface ContaDoRelatorio {
  id: string;
  lado: 'pagar' | 'receber';
  data: Record<string, unknown>;
}

export interface ContextoRelatorio {
  categorias: readonly CategoriaDoContexto[];
  centros: ReadonlyArray<{ id: string; nome?: string; codigo?: string; centro_pai_id?: string | null }>;
  contasBancarias: ReadonlyMap<string, string>;
  vendas: ReadonlyMap<string, string>;
}

export interface LinhaLancamento {
  chave: string;
  conta_id: string;
  lado: 'pagar' | 'receber';
  tipo: 'Despesa' | 'Receita';
  numero: string;
  venda_numero: string;
  emissao: string;
  vencimento: string;
  liquidacao: string;
  movimentacao: string;
  pessoa: string;
  moeda: string;
  descricao: string;
  documento: string;
  conta_bancaria: string;
  situacao: Exclude<Situacao, 'TODAS'>;
  valor_lancamento: number;
  valor_movimentacao: number;
  categoria_id: string;
  categoria_codigo: string;
  categoria_nome: string;
  grupo_nome: string;
  centro_custo_id: string;
  centro_custo_nome: string;
  percentual: number;
  /** Valor da categoria/centro/linha neste regime. */
  valor: number;
  tags: string[];
  repasse: boolean;
  rateado: boolean;
}

const str = (v: unknown) => (v == null ? '' : String(v));

/** Situação de hoje, no vocabulário do mercado. */
export function situacaoDaConta(data: Record<string, unknown>, hoje: string): Exclude<Situacao, 'TODAS'> {
  const status = str(data.status).toUpperCase();
  if (status === 'CANCELADO') return 'EXCLUIDO';
  if (status === 'PAGO' || status === 'RECEBIDO') return 'LIQUIDADO';
  if (status === 'ATRASADO' || status === 'VENCIDO') return 'EM_ATRASO';
  const venc = str(data.data_vencimento).slice(0, 10);
  return venc && venc < hoje ? 'EM_ATRASO' : 'EM_ABERTO';
}

function passaSituacao(s: Exclude<Situacao, 'TODAS'>, filtro: Situacao): boolean {
  if (filtro === 'TODAS') return s !== 'EXCLUIDO';
  if (filtro === 'EM_ABERTO') return s === 'EM_ABERTO' || s === 'EM_ATRASO';
  return s === filtro;
}

/** Data da conta na base escolhida ('' quando a conta não tem essa data). */
export function dataDaBase(conta: ContaDoRelatorio, base: DataDe): string {
  const d = conta.data;
  if (base === 'EMISSAO') return str(d.data_emissao || d.data_vencimento).slice(0, 10);
  if (base === 'VENCIMENTO') return str(d.data_vencimento).slice(0, 10);
  const status = str(d.status).toUpperCase();
  if (base === 'LIQUIDACAO') {
    return status === 'PAGO' || status === 'RECEBIDO' ? dataMovimentoDaConta(d, conta.lado) : '';
  }
  return ['PAGO', 'RECEBIDO', 'PARCIAL'].includes(status) ? dataMovimentoDaConta(d, conta.lado) : '';
}

/** Ids do centro e de todos os que estão abaixo dele. */
export function centroEDescendentes(
  id: string,
  centros: ReadonlyArray<{ id: string; centro_pai_id?: string | null }>,
): Set<string> {
  const saida = new Set<string>([id]);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const c of centros) {
      if (c.centro_pai_id && saida.has(c.centro_pai_id) && !saida.has(c.id)) { saida.add(c.id); cresceu = true; }
    }
  }
  return saida;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function juntarFatias(fatias: FatiaDoLancamento[], chave: (f: FatiaDoLancamento) => string): FatiaDoLancamento[] {
  const mapa = new Map<string, FatiaDoLancamento>();
  for (const f of fatias) {
    const k = chave(f);
    const atual = mapa.get(k);
    if (!atual) { mapa.set(k, { ...f }); continue; }
    atual.percentual = round2(atual.percentual + f.percentual);
    atual.valor = round2(atual.valor + f.valor);
    atual.valor_caixa = round2(atual.valor_caixa + f.valor_caixa);
  }
  return [...mapa.values()];
}

/**
 * Transforma as contas (já recortadas pelo período no banco) nas linhas do
 * relatório, aplicando o resto dos filtros. Categoria: uma linha por
 * categoria da conta. Centro: uma por centro. Rateio: uma por linha do
 * rateio, só das contas rateadas.
 */
export function montarLinhas(
  contas: readonly ContaDoRelatorio[],
  ctx: ContextoRelatorio,
  f: FiltrosLancamentos,
  hoje: string,
): LinhaLancamento[] {
  const caixa = regimeDosFiltros(f) === 'caixa';
  const centrosAceitos = f.centro_custo_id ? centroEDescendentes(f.centro_custo_id, ctx.centros) : null;
  const termo = semAcento(f.pesquisar);
  const tagFiltro = semAcento(f.tag);
  const linhas: LinhaLancamento[] = [];

  for (const conta of contas) {
    const d = conta.data;
    if (f.tipo === 'DESPESA' && conta.lado !== 'pagar') continue;
    if (f.tipo === 'RECEITA' && conta.lado !== 'receber') continue;
    const base = dataDaBase(conta, f.data_de);
    if (!base || base < f.de || base > f.ate) continue;
    const situacao = situacaoDaConta(d, hoje);
    if (!passaSituacao(situacao, f.situacao)) continue;

    const dim = dimensoesDoLancamento(d, { categorias: ctx.categorias, centros: ctx.centros, lado: conta.lado });
    if (f.visao === 'rateio' && !dim.rateado) continue;
    if (caixa && dim.valor_movimentado === 0) continue;

    const fatias = f.visao === 'categoria'
      ? juntarFatias(dim.fatias, x => x.categoria_id)
      : f.visao === 'centro'
        ? juntarFatias(dim.fatias, x => x.centro_custo_id || `nome:${x.centro_custo_nome}`)
        : dim.fatias;

    const comum = {
      conta_id: conta.id,
      lado: conta.lado,
      tipo: conta.lado === 'pagar' ? 'Despesa' as const : 'Receita' as const,
      numero: str(d.numero) || (num(d.total_parcelas) > 1 ? `${num(d.parcela_numero) || 1}/${num(d.total_parcelas)}` : ''),
      venda_numero: ctx.vendas.get(str(d.venda_id) || str(d.origem_venda_id)) ?? '',
      emissao: str(d.data_emissao).slice(0, 10),
      vencimento: str(d.data_vencimento).slice(0, 10),
      liquidacao: situacao === 'LIQUIDADO' ? dataMovimentoDaConta(d, conta.lado) : '',
      movimentacao: dim.valor_movimentado > 0 ? dataMovimentoDaConta(d, conta.lado) : '',
      pessoa: conta.lado === 'pagar' ? str(d.fornecedor_nome) : str(d.cliente_nome),
      moeda: str(d.moeda) || 'BRL',
      descricao: str(d.descricao),
      documento: str(d.documento) || str(d.boleto_codigo) || str(d.plataforma_transacao),
      conta_bancaria: ctx.contasBancarias.get(str(d.conta_bancaria_id)) ?? '',
      situacao,
      valor_lancamento: dim.valor_total,
      valor_movimentacao: dim.valor_movimentado,
      rateado: dim.rateado,
    };

    fatias.forEach((fatia, i) => {
      if (fatia.repasse && !f.incluir_repasse) return;
      if (centrosAceitos && !centrosAceitos.has(fatia.centro_custo_id)) return;
      if (f.categoria_id && fatia.categoria_id !== f.categoria_id && fatia.grupo_id !== f.categoria_id) return;
      if (tagFiltro && !fatia.tags.some(t => semAcento(t) === tagFiltro)) return;
      const linha: LinhaLancamento = {
        ...comum,
        chave: `${conta.lado}:${conta.id}:${i}`,
        categoria_id: fatia.categoria_id,
        categoria_codigo: fatia.categoria_codigo,
        categoria_nome: fatia.categoria_nome,
        grupo_nome: fatia.grupo_nome,
        centro_custo_id: fatia.centro_custo_id,
        centro_custo_nome: fatia.centro_custo_nome,
        percentual: fatia.percentual,
        valor: caixa ? fatia.valor_caixa : fatia.valor,
        tags: fatia.tags,
        repasse: fatia.repasse,
      };
      if (termo && !casaPesquisa(linha, f.em, termo)) return;
      linhas.push(linha);
    });
  }
  return linhas;
}

function casaPesquisa(l: LinhaLancamento, em: CampoPesquisa, termo: string): boolean {
  const campos: Record<Exclude<CampoPesquisa, 'TUDO'>, string[]> = {
    PESSOA: [l.pessoa],
    DESCRICAO: [l.descricao],
    CATEGORIA: [l.categoria_nome, l.categoria_codigo, l.grupo_nome],
    CENTRO: [l.centro_custo_nome],
    DOCUMENTO: [l.documento],
    NUMERO: [l.numero, l.venda_numero],
    TAG: l.tags,
  };
  const alvo = em === 'TUDO' ? Object.values(campos).flat() : campos[em];
  return alvo.some(v => semAcento(v).includes(termo));
}

// ---------------------------------------------------------------------------
// Ordem, grupos, totais, página
// ---------------------------------------------------------------------------

const COLUNAS_ORDENAVEIS: Record<string, (l: LinhaLancamento) => string | number> = {
  numero: l => l.numero,
  venda: l => l.venda_numero,
  emissao: l => l.emissao,
  vencimento: l => l.vencimento,
  liquidacao: l => l.liquidacao,
  movimentacao: l => l.movimentacao,
  pessoa: l => l.pessoa,
  descricao: l => l.descricao,
  categoria: l => `${l.categoria_codigo} ${l.categoria_nome}`,
  grupo: l => l.grupo_nome,
  centro: l => l.centro_custo_nome,
  tipo: l => l.tipo,
  conta: l => l.conta_bancaria,
  percentual: l => l.percentual,
  valor: l => l.valor,
  valor_lancamento: l => l.valor_lancamento,
  valor_movimentacao: l => l.valor_movimentacao,
};

export function chaveDoGrupo(l: LinhaLancamento, agrupar: Agrupar, f: Pick<FiltrosLancamentos, 'data_de'>): { chave: string; rotulo: string } {
  switch (agrupar) {
    case 'categoria': return { chave: l.categoria_id, rotulo: l.categoria_nome ? `${l.categoria_codigo} ${l.categoria_nome}`.trim() : 'Sem categoria' };
    case 'grupo': return { chave: l.grupo_nome, rotulo: l.grupo_nome || 'Sem grupo' };
    case 'centro': return { chave: l.centro_custo_id || l.centro_custo_nome, rotulo: l.centro_custo_nome || 'Sem centro de custo' };
    case 'pessoa': return { chave: l.pessoa, rotulo: l.pessoa || 'Sem pessoa' };
    case 'tipo': return { chave: l.tipo, rotulo: l.tipo };
    case 'mes': {
      const d = f.data_de === 'EMISSAO' ? l.emissao : f.data_de === 'VENCIMENTO' ? l.vencimento
        : f.data_de === 'LIQUIDACAO' ? l.liquidacao : l.movimentacao;
      const mes = d.slice(0, 7);
      return { chave: mes, rotulo: mes ? `${mes.slice(5, 7)}/${mes.slice(0, 4)}` : 'Sem data' };
    }
    default: return { chave: '', rotulo: '' };
  }
}

export function ordenarLinhas(linhas: LinhaLancamento[], f: FiltrosLancamentos): LinhaLancamento[] {
  const padrao = f.data_de === 'EMISSAO' ? 'emissao' : f.data_de === 'VENCIMENTO' ? 'vencimento'
    : f.data_de === 'LIQUIDACAO' ? 'liquidacao' : 'movimentacao';
  const acessor = COLUNAS_ORDENAVEIS[f.ordenar] ?? COLUNAS_ORDENAVEIS[padrao];
  const fator = f.direcao === 'desc' ? -1 : 1;
  const cmp = (a: string | number, b: string | number) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  return [...linhas].sort((a, b) => {
    if (f.agrupar) {
      const g = cmp(chaveDoGrupo(a, f.agrupar, f).rotulo, chaveDoGrupo(b, f.agrupar, f).rotulo);
      if (g !== 0) return g;
    }
    return cmp(acessor(a), acessor(b)) * fator || a.chave.localeCompare(b.chave);
  });
}

export interface GrupoDoRelatorio { chave: string; rotulo: string; quantidade: number; valor: number }

export function agruparLinhas(linhas: readonly LinhaLancamento[], f: FiltrosLancamentos): GrupoDoRelatorio[] {
  if (!f.agrupar) return [];
  const mapa = new Map<string, GrupoDoRelatorio>();
  for (const l of linhas) {
    const { chave, rotulo } = chaveDoGrupo(l, f.agrupar, f);
    const g = mapa.get(chave) ?? { chave, rotulo, quantidade: 0, valor: 0 };
    g.quantidade += 1;
    g.valor = round2(g.valor + l.valor);
    mapa.set(chave, g);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

export interface TotaisDoRelatorio {
  /** Linhas do relatório. */
  quantidade: number;
  /** Lançamentos distintos (uma conta rateada conta uma vez). */
  lancamentos: number;
  /** Soma do valor da dimensão no regime escolhido. */
  valor: number;
  /** Soma do valor dos lançamentos distintos. */
  valor_lancamento: number;
  /** Soma do que já foi pago/recebido nos lançamentos distintos. */
  valor_movimentacao: number;
}

export function totalizar(linhas: readonly LinhaLancamento[]): TotaisDoRelatorio {
  const vistas = new Map<string, LinhaLancamento>();
  for (const l of linhas) vistas.set(`${l.lado}:${l.conta_id}`, l);
  const distintas = [...vistas.values()];
  return {
    quantidade: linhas.length,
    lancamentos: distintas.length,
    valor: round2(soma(linhas.map(l => l.valor))),
    valor_lancamento: round2(soma(distintas.map(l => l.valor_lancamento))),
    valor_movimentacao: round2(soma(distintas.map(l => l.valor_movimentacao))),
  };
}

export function paginar<T>(linhas: readonly T[], pagina: number, porPagina: number): { itens: T[]; pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  return { itens: linhas.slice((p - 1) * porPagina, p * porPagina), pagina: p, paginas };
}

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

const numeroBR = (n: number) => round2(n).toFixed(2).replace('.', ',');
const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

type ColunaCsv = [string, (l: LinhaLancamento) => string];

const COMUNS_INICIO: ColunaCsv[] = [
  ['Número', l => l.numero],
  ['Nº da venda', l => l.venda_numero],
  ['Emissão', l => dataBR(l.emissao)],
  ['Vencimento', l => dataBR(l.vencimento)],
  ['Liquidação', l => dataBR(l.liquidacao)],
  ['Movimentação', l => dataBR(l.movimentacao)],
  ['Pessoa', l => l.pessoa],
];

const COLUNAS_CSV: Record<Visao, ColunaCsv[]> = {
  categoria: [
    ...COMUNS_INICIO,
    ['Moeda', l => l.moeda],
    ['Valor', l => numeroBR(l.valor)],
    ['Grupo', l => l.grupo_nome],
    ['Código', l => l.categoria_codigo],
    ['Categoria', l => l.categoria_nome],
    ['Tipo', l => l.tipo],
    ['Descrição', l => l.descricao],
    ['Documento', l => l.documento],
    ['Conta', l => l.conta_bancaria],
    ['Situação', l => rotuloDaSituacaoNaLinha(l.situacao, l.lado)],
    ['Tags', l => l.tags.join(', ')],
  ],
  centro: [
    ...COMUNS_INICIO,
    ['Descrição', l => l.descricao],
    ['Centro de custo', l => l.centro_custo_nome],
    ['Valor do lançamento', l => numeroBR(l.valor_lancamento)],
    ['Pago/recebido', l => numeroBR(l.valor_movimentacao)],
    ['% no centro', l => numeroBR(l.percentual)],
    ['Valor no centro', l => numeroBR(l.valor)],
    ['Tipo', l => l.tipo],
    ['Conta', l => l.conta_bancaria],
    ['Situação', l => rotuloDaSituacaoNaLinha(l.situacao, l.lado)],
  ],
  rateio: [
    ['Tipo', l => l.tipo],
    ...COMUNS_INICIO.slice(2),
    ['Descrição', l => l.descricao],
    ['Conta', l => l.conta_bancaria],
    ['Centro de custo', l => l.centro_custo_nome],
    ['Categoria', l => `${l.categoria_codigo} ${l.categoria_nome}`.trim()],
    ['Valor do lançamento', l => numeroBR(l.valor_lancamento)],
    ['% da parte', l => numeroBR(l.percentual)],
    ['Valor da parte', l => numeroBR(l.valor)],
    ['Pago/recebido', l => numeroBR(l.valor_movimentacao)],
  ],
};

/**
 * Planilha que o Excel abre (separador ";", BOM, vírgula decimal). Toda
 * célula passa por `auditCsvCell`: texto que começa com =, +, - ou @ não
 * vira fórmula.
 */
export function planilhaDasLinhas(visao: Visao, linhas: readonly LinhaLancamento[]): string {
  const colunas = COLUNAS_CSV[visao];
  const cabecalho = colunas.map(([nome]) => auditCsvCell(nome)).join(';');
  const corpo = linhas.map(l => colunas.map(([, valor]) => auditCsvCell(valor(l))).join(';'));
  return '﻿' + [cabecalho, ...corpo].join('\r\n');
}
