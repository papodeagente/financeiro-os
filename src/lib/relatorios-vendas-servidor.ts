/**
 * RELATÓRIOS DE VENDAS no servidor (E7, G3): um só caminho para a tela
 * (GET /api/relatorios/vendas), a exportação (Excel, PDF, Imprimir, CSV) e o
 * envio agendado por e-mail / link de leitura. A consulta vira parâmetros de
 * URL e volta (`lerConsulta` / `paramsDaConsulta`), e é assim que os filtros
 * ficam salvos no agendamento.
 *
 * Direitos (quem chama decide e passa em `acesso`): o ganho da agência só com
 * `verReceita`; quem não vê as vendas da equipe passa `vendedorId`.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { lerVendas, type VendaLida } from './vendas-leitura';
import { lerConfigVenda } from './venda-servidor';
import { reaisParaCentavos } from './venda-modelo';
import { montarTabelaDinamica } from './tabela-dinamica';
import {
  CAMPOS_DA_DINAMICA, COLUNAS_CARTAO_CORPORATIVO, COLUNAS_DOS_PAGAMENTOS, COLUNAS_POR_FORMA, COLUNAS_POR_PRODUTO, COLUNAS_RANKING, DATAS_BASE, MEDIDAS_DA_DINAMICA,
  RELATORIOS, RELATORIOS_MULTIEMPRESA, ROTULO_DATA_BASE, ROTULO_RELATORIO, chaveDoPagamento, colunasAgrupadas, colunasPermitidas, filtrarLinhas,
  linhasDoCartaoCorporativo, linhasDosPagamentos, linhasPorEmpresa, linhasPorForma, linhasPorFornecedor, linhasPorProduto, linhasPorUnidade, linhasPorVendedor, opcoesDosFiltros,
  rankingDeClientes, registrosDaDinamica, semColunasSensiveis, seriePorMes, temFiltroDeProduto, totaisDasLinhas,
  type ColunaDoRelatorio, type DataBase, type FiltroDoRelatorio, type LinhaDoRelatorio, type LiquidacaoDoPagamento,
  type NomesDeEmpresa, type OpcoesDosFiltros, type OrdemDoRanking, type TipoDeRelatorio,
} from './relatorios-vendas';
import { rotuloDoPeriodo, type DocumentoExportado, type FiltroAplicado } from './exportacao/documento';
import { documentoDaTabelaDinamica } from './exportacao/tabela-dinamica';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface ConsultaDeVendas {
  relatorio: TipoDeRelatorio;
  de: string;
  ate: string;
  situacao: 'todas' | 'abertas' | 'fechadas';
  canceladas: boolean;
  colunas: string[];
  filtro: Omit<FiltroDoRelatorio, 'de' | 'ate'>;
  ordem: OrdemDoRanking;
  so_liquidados: boolean;
  /** Tabela dinâmica: campos das linhas, da coluna e o número somado. */
  dinamica: { linhas: string[]; coluna: string; medida: string };
}

export const CONSULTA_PADRAO: ConsultaDeVendas = {
  relatorio: 'produto', de: '', ate: '', situacao: 'todas', canceladas: false, colunas: [], filtro: { data_base: 'venda', situacao_produto: 'todos' },
  ordem: 'faturamento', so_liquidados: false, dinamica: { linhas: ['Vendedor', 'Tipo de produto'], coluna: 'Mês', medida: 'faturamento' },
};

const campoDaDinamica = (v: string | null) => ((CAMPOS_DA_DINAMICA as readonly string[]).includes(v ?? '') ? v! : '');

/** Parâmetros da URL → consulta (o que não vale cai no padrão). */
export function lerConsulta(u: URLSearchParams): { ok: true; consulta: ConsultaDeVendas } | { ok: false; erro: string } {
  const de = u.get('de') ?? '';
  const ate = u.get('ate') ?? '';
  if ((de && !ISO.test(de)) || (ate && !ISO.test(ate))) return { ok: false, erro: 'Data inválida.' };
  const relatorio = (RELATORIOS as readonly string[]).includes(u.get('relatorio') ?? '') ? (u.get('relatorio') as TipoDeRelatorio) : 'produto';
  const sit = u.get('situacao');
  const sp = u.get('situacao_produto');
  const base = u.get('data_base');
  const linhasDin = (u.get('din_linhas') ?? '').split(',').map(campoDaDinamica).filter(Boolean);
  return {
    ok: true,
    consulta: {
      relatorio, de, ate,
      situacao: sit === 'abertas' || sit === 'fechadas' ? sit : 'todas',
      canceladas: u.get('canceladas') === '1',
      colunas: (u.get('colunas') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 120),
      filtro: {
        data_base: (DATAS_BASE as readonly string[]).includes(base ?? '') ? (base as DataBase) : 'venda',
        fornecedor: (u.get('fornecedor') ?? '').slice(0, 200) || undefined,
        vendedor: (u.get('vendedor') ?? '').slice(0, 200) || undefined,
        tipo: (u.get('tipo') ?? '').slice(0, 40) || undefined,
        produto: (u.get('produto') ?? '').slice(0, 120) || undefined,
        unidade: (u.get('unidade') ?? '').slice(0, 200) || undefined,
        empresa: (u.get('empresa') ?? '').slice(0, 80) || undefined,
        situacao_produto: sp === 'ativos' || sp === 'cancelados' ? sp : 'todos',
      },
      ordem: u.get('ordem') === 'receita' ? 'receita' : 'faturamento',
      so_liquidados: u.get('so_liquidados') === '1',
      dinamica: {
        linhas: linhasDin.length ? linhasDin.slice(0, 3) : CONSULTA_PADRAO.dinamica.linhas,
        coluna: u.has('din_coluna') ? campoDaDinamica(u.get('din_coluna')) : CONSULTA_PADRAO.dinamica.coluna,
        medida: (u.get('din_medida') ?? '').replace(/[^a-z_A-Z]/g, '') || 'faturamento',
      },
    },
  };
}

/** Consulta → parâmetros (só o que difere do padrão). */
export function paramsDaConsulta(c: ConsultaDeVendas): URLSearchParams {
  const q = new URLSearchParams({ relatorio: c.relatorio });
  if (c.de) q.set('de', c.de);
  if (c.ate) q.set('ate', c.ate);
  if (c.situacao !== 'todas') q.set('situacao', c.situacao);
  if (c.canceladas) q.set('canceladas', '1');
  if (c.colunas.length) q.set('colunas', c.colunas.join(','));
  const f = c.filtro;
  if (f.data_base && f.data_base !== 'venda') q.set('data_base', f.data_base);
  for (const k of ['fornecedor', 'vendedor', 'tipo', 'produto', 'unidade', 'empresa'] as const) if (f[k]) q.set(k, String(f[k]));
  if (f.situacao_produto && f.situacao_produto !== 'todos') q.set('situacao_produto', f.situacao_produto);
  if (c.ordem !== 'faturamento') q.set('ordem', c.ordem);
  if (c.so_liquidados) q.set('so_liquidados', '1');
  if (c.relatorio === 'dinamica') {
    q.set('din_linhas', c.dinamica.linhas.join(','));
    q.set('din_coluna', c.dinamica.coluna);
    q.set('din_medida', c.dinamica.medida);
  }
  return q;
}

/** Janela de datas da venda a ler quando o período é pela data do serviço. */
export function janelaDaLeitura(c: Pick<ConsultaDeVendas, 'de' | 'ate' | 'filtro'>): { de?: string; ate?: string } {
  if ((c.filtro.data_base ?? 'venda') === 'venda') return { de: c.de || undefined, ate: c.ate || undefined };
  const desloca = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
  // Venda costuma vir antes do serviço: até 2 anos antes do início do período, até 1 ano depois do fim.
  return { de: c.de ? desloca(c.de, -730) : undefined, ate: c.ate ? desloca(c.ate, 366) : undefined };
}

export interface AcessoAoRelatorio {
  verReceita: boolean;
  /** Só as vendas desta pessoa (quem não vê as da equipe). */
  vendedorId?: string;
  /** Várias empresas (E7): só as vendas destas. null/ausente = todas. */
  empresas?: readonly string[] | null;
  /**
   * Duas ou mais empresas na agência (E7, G2): a coluna, o filtro, o
   * relatório e o campo da dinâmica "Empresa" aparecem. Com uma empresa só,
   * nada disso existe (a tela é a de sempre).
   */
  multiempresa?: boolean;
  /** Nome de cada empresa (id → nome). */
  nomesDasEmpresas?: NomesDeEmpresa;
}

export interface ResultadoDoRelatorio {
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
  /** Duas ou mais empresas: a tela mostra o filtro e o relatório por empresa. */
  multiempresa: boolean;
}

export function catalogoDoRelatorio(r: TipoDeRelatorio): ColunaDoRelatorio[] {
  if (r === 'vendedor') return colunasAgrupadas('Vendedor');
  if (r === 'unidade') return colunasAgrupadas('Unidade');
  if (r === 'empresa') return colunasAgrupadas('Empresa');
  if (r === 'cartao_corporativo') return COLUNAS_CARTAO_CORPORATIVO;
  if (r === 'fornecedor') return colunasAgrupadas('Fornecedor');
  if (r === 'forma') return COLUNAS_POR_FORMA;
  if (r === 'pagamentos') return COLUNAS_DOS_PAGAMENTOS;
  if (r === 'clientes') return COLUNAS_RANKING;
  return COLUNAS_POR_PRODUTO;
}

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** O que entrou de cada pagamento das vendas (contas a receber nascidas dele). */
export async function lerLiquidacoes(exec: ExecutorSQL, tenantId: string, vendas: VendaLida[]): Promise<Map<string, LiquidacaoDoPagamento>> {
  const mapa = new Map<string, LiquidacaoDoPagamento>();
  const ids = vendas.map(v => v.venda.id);
  if (!ids.length) return mapa;
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(venda_id, ''), data->>'origem_venda_id', data->>'venda_id') AS venda, data FROM contas_receber
      WHERE tenant_id = $1 AND COALESCE(NULLIF(venda_id, ''), data->>'origem_venda_id', data->>'venda_id') = ANY($2::text[])`,
    [tenantId, ids],
  ).catch(() => ({ rows: [] as Linha[] }));
  const umPagamento = new Map(vendas.filter(v => v.pagamentos.length === 1).map(v => [v.venda.id, v.pagamentos[0].id]));
  for (const r of rows) {
    const d = (r.data ?? {}) as Linha;
    if (txt(d.status).toUpperCase() === 'CANCELADO') continue;
    const origem = txt(d.origem) || 'VENDA';
    if (origem === 'COMISSAO_FORNECEDOR' || origem === 'OUTROS') continue;
    const venda = txt(r.venda);
    const pag = txt(d.venda_pagamento_id) || umPagamento.get(venda) || '';
    if (!pag) continue;
    const k = chaveDoPagamento(venda, pag);
    const atual = mapa.get(k) ?? { valor_centavos: 0, liquidado_centavos: 0, ultima_liquidacao: '', conta_bancaria_id: '', contas: 0 };
    atual.contas += 1;
    atual.valor_centavos += reaisParaCentavos(d.valor_final ?? d.valor_original);
    const pago = reaisParaCentavos(d.valor_pago);
    const st = txt(d.status).toUpperCase();
    if (pago > 0 && (st === 'RECEBIDO' || st === 'PARCIAL' || st === 'PAGO')) {
      atual.liquidado_centavos += pago;
      const dp = txt(d.data_pagamento).slice(0, 10);
      if (dp > atual.ultima_liquidacao) { atual.ultima_liquidacao = dp; atual.conta_bancaria_id = txt(d.conta_bancaria_id) || atual.conta_bancaria_id; }
    }
    if (!atual.conta_bancaria_id) atual.conta_bancaria_id = txt(d.conta_bancaria_id);
    mapa.set(k, atual);
  }
  return mapa;
}

/**
 * As empresas da agência para o relatório (E7): duas ou mais ativas liga o
 * que é de empresa. Serve o envio agendado, que não tem sessão (a tela usa o
 * escopo da sessão, com as empresas liberadas para a pessoa).
 */
export async function empresasDoRelatorio(exec: ExecutorSQL, tenantId: string): Promise<{ multiempresa: boolean; nomesDasEmpresas: NomesDeEmpresa }> {
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.empresas') IS NOT NULL AS ok`).catch(() => ({ rows: [] as Linha[] }));
  if (!tem[0]?.ok) return { multiempresa: false, nomesDasEmpresas: new Map() };
  const { rows } = await exec.query(`SELECT id, nome FROM empresas WHERE tenant_id = $1 AND ativa`, [tenantId]).catch(() => ({ rows: [] as Linha[] }));
  return { multiempresa: rows.length >= 2, nomesDasEmpresas: new Map(rows.map(r => [txt(r.id), txt(r.nome)])) };
}

async function nomesDasContas(exec: ExecutorSQL, tenantId: string): Promise<Map<string, string>> {
  const { rows } = await exec.query(`SELECT id, data->>'nome' AS nome FROM contas_bancarias WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] as Linha[] }));
  return new Map(rows.map(r => [txt(r.id), txt(r.nome)]));
}

/** Monta o relatório inteiro (a tela, o arquivo e o envio agendado leem daqui). */
export async function montarRelatorioDeVendas(exec: ExecutorSQL, tenantId: string, c: ConsultaDeVendas, acesso: AcessoAoRelatorio): Promise<ResultadoDoRelatorio> {
  const janela = janelaDaLeitura(c);
  const [lidasTodas, cfg] = await Promise.all([
    lerVendas(exec, tenantId, { ...janela, incluir_canceladas: c.canceladas, vendedor_id: acesso.vendedorId, empresas: acesso.empresas ?? undefined }),
    lerConfigVenda(exec, tenantId),
  ]);
  const lidas = lidasTodas.filter(v => c.situacao === 'abertas' ? v.situacao === 'ABERTA' && !v.cancelada : c.situacao === 'fechadas' ? v.situacao === 'FECHADA' : true);
  const multi = acesso.multiempresa === true;
  const todasAsLinhas = linhasPorProduto(lidas, cfg.receita, acesso.nomesDasEmpresas);
  // Com uma empresa só, o filtro de empresa não existe (um link antigo não esconde nada).
  const filtro: FiltroDoRelatorio = { ...c.filtro, ...(multi ? {} : { empresa: undefined }), de: c.de || undefined, ate: c.ate || undefined };
  // Relatório por empresa pedido numa agência de uma empresa só: o por produto de sempre.
  const relatorio: TipoDeRelatorio = !multi && RELATORIOS_MULTIEMPRESA.has(c.relatorio) ? 'produto' : c.relatorio;
  const produtos = filtrarLinhas(todasAsLinhas, filtro);
  // Só pode ordenar pela receita quem pode vê-la (a ordem já contaria o segredo).
  const ordem: OrdemDoRanking = acesso.verReceita ? c.ordem : 'faturamento';
  const vendasDoFiltro = temFiltroDeProduto(filtro) ? new Set(produtos.map(l => String(l.venda_id))) : null;
  const lidasDoFiltro = vendasDoFiltro ? lidas.filter(v => vendasDoFiltro.has(v.venda.id)) : lidas;

  let linhas: LinhaDoRelatorio[];
  if (relatorio === 'vendedor') linhas = linhasPorVendedor(produtos, ordem);
  else if (relatorio === 'unidade') linhas = linhasPorUnidade(produtos, ordem);
  else if (relatorio === 'empresa') linhas = linhasPorEmpresa(produtos, ordem);
  else if (relatorio === 'fornecedor') linhas = linhasPorFornecedor(produtos, ordem);
  else if (relatorio === 'clientes') linhas = rankingDeClientes(produtos, ordem);
  else if (relatorio === 'forma') linhas = linhasPorForma(lidasDoFiltro);
  else if (relatorio === 'pagamentos') {
    const [liq, contas] = await Promise.all([lerLiquidacoes(exec, tenantId, lidasDoFiltro), nomesDasContas(exec, tenantId)]);
    linhas = linhasDosPagamentos(lidasDoFiltro, liq, contas, { soLiquidados: c.so_liquidados, empresas: acesso.nomesDasEmpresas });
  } else if (relatorio === 'cartao_corporativo') {
    // Os bilhetes das vendas do recorte; os filtros de produto valem para o bilhete também.
    linhas = filtrarLinhas(linhasDoCartaoCorporativo(lidasDoFiltro, acesso.nomesDasEmpresas), { ...filtro, data_base: 'venda', de: undefined, ate: undefined });
  } else linhas = produtos;

  const catalogo = catalogoDoRelatorio(relatorio).filter(k => multi || !k.so_multiempresa);
  const colunas = colunasPermitidas(catalogo, acesso.verReceita, c.colunas, multi);
  linhas = semColunasSensiveis(linhas, catalogo, acesso.verReceita);
  const medidaDaSerie = ordem === 'receita' ? 'receita' : 'faturamento';
  return {
    relatorio, titulo: ROTULO_RELATORIO[relatorio], colunas,
    catalogo: catalogo.filter(k => acesso.verReceita || !k.sensivel),
    medidas: relatorio === 'dinamica' ? MEDIDAS_DA_DINAMICA.filter(k => acesso.verReceita || !k.sensivel) : [],
    linhas, totais: totaisDasLinhas(linhas, colunas), opcoes: opcoesSemEmpresa(opcoesDosFiltros(todasAsLinhas), multi),
    serie: seriePorMes(semColunasSensiveis(produtos, COLUNAS_POR_PRODUTO, acesso.verReceita), medidaDaSerie, c.filtro.data_base ?? 'venda'),
    ver_receita: acesso.verReceita, so_as_suas: Boolean(acesso.vendedorId), ordem,
    quantidade_vendas: relatorio === 'forma' || relatorio === 'pagamentos' ? lidasDoFiltro.length
      : new Set((relatorio === 'cartao_corporativo' ? linhas : produtos).map(l => String(l.venda_id))).size,
    multiempresa: multi,
  };
}

/** Com uma empresa só, a lista de empresas nem vai para a tela. */
function opcoesSemEmpresa(o: OpcoesDosFiltros, multi: boolean): OpcoesDosFiltros {
  if (multi) return o;
  const { empresas: _fora, ...resto } = o;
  void _fora;
  return resto;
}

/** Os filtros por extenso (topo do arquivo, nome do arquivo e o e-mail do envio agendado). */
export function filtrosAplicados(c: ConsultaDeVendas, opcoes: OpcoesDosFiltros): FiltroAplicado[] {
  const f = c.filtro;
  const nome = (lista: { valor: string; rotulo: string }[], v?: string) => (v ? lista.find(o => o.valor === v)?.rotulo ?? v.replace(/^(id|nome):/, '') : '');
  const saida: FiltroAplicado[] = [{ rotulo: ROTULO_DATA_BASE[f.data_base ?? 'venda'], valor: rotuloDoPeriodo(c.de, c.ate) }];
  if (c.situacao !== 'todas') saida.push({ rotulo: 'Vendas', valor: c.situacao === 'abertas' ? 'Abertas' : 'Fechadas' });
  if (c.canceladas) saida.push({ rotulo: 'Canceladas', valor: 'incluídas' });
  if (f.fornecedor) saida.push({ rotulo: 'Fornecedor', valor: nome(opcoes.fornecedores, f.fornecedor) });
  if (f.vendedor) saida.push({ rotulo: 'Vendedor', valor: nome(opcoes.vendedores, f.vendedor) });
  if (f.tipo) saida.push({ rotulo: 'Produto', valor: nome(opcoes.tipos, f.tipo) });
  if (f.produto) saida.push({ rotulo: 'Busca', valor: f.produto });
  if (f.unidade) saida.push({ rotulo: 'Unidade', valor: f.unidade });
  if (f.empresa && opcoes.empresas) saida.push({ rotulo: 'Empresa', valor: nome(opcoes.empresas, f.empresa) });
  if (f.situacao_produto && f.situacao_produto !== 'todos') saida.push({ rotulo: 'Situação do produto', valor: f.situacao_produto === 'ativos' ? 'Ativos' : 'Cancelados' });
  if (c.ordem === 'receita' && ['vendedor', 'unidade', 'empresa', 'fornecedor', 'clientes'].includes(c.relatorio)) saida.push({ rotulo: 'Ordem', valor: 'pela receita' });
  if (c.so_liquidados && c.relatorio === 'pagamentos') saida.push({ rotulo: 'Pagamentos', valor: 'só liquidados' });
  return saida;
}

/** O relatório como documento de exportação (dinheiro em centavos). */
export function documentoDoRelatorio(r: ResultadoDoRelatorio, c: ConsultaDeVendas): DocumentoExportado {
  const filtros = filtrosAplicados(c, r.opcoes);
  if (r.relatorio === 'dinamica') {
    const medida = r.medidas.find(m => m.id === c.dinamica.medida) ?? r.medidas.find(m => m.id === 'faturamento') ?? MEDIDAS_DA_DINAMICA[0];
    const camposLinha = c.dinamica.linhas.filter((x, i, a) => x && a.indexOf(x) === i && x !== c.dinamica.coluna);
    const tabela = montarTabelaDinamica(registrosDaDinamica(r.linhas, medida.id), camposLinha, c.dinamica.coluna ? [c.dinamica.coluna] : []);
    return documentoDaTabelaDinamica(tabela, { titulo: r.titulo, subtitulo: `Soma de ${medida.rotulo.toLowerCase()}`, filtros, rotuloDoValorUnico: medida.rotulo });
  }
  const tipo = (t: ColunaDoRelatorio['tipo']) => (t === 'numero' ? 'numero' : t);
  return {
    titulo: r.titulo,
    filtros,
    colunas: r.colunas.map(k => ({ id: k.id, rotulo: k.rotulo, tipo: tipo(k.tipo), ...(k.sensivel ? { sensivel: true } : {}) })),
    linhas: r.linhas.map(l => Object.fromEntries(r.colunas.map(k => [k.id, l[k.id] ?? null]))),
    totais: r.linhas.length ? Object.fromEntries(r.colunas.map(k => [k.id, r.totais[k.id] ?? null])) : null,
    dinheiro_em: 'centavos',
    nota: r.so_as_suas ? 'Só as vendas de quem gerou o arquivo.' : undefined,
  };
}
