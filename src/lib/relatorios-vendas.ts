/**
 * RELATÓRIOS DE VENDAS (E5, parte F): Vendas por produto (colunas
 * escolhíveis, receita aberta por componente), por vendedor, por unidade
 * (centro de custo), por forma de pagamento, ranking de clientes e os
 * registros da tabela dinâmica de vendas.
 *
 * Arquivo puro. Tudo sai da MESMA venda do modelo (vendas-leitura.ts) e da
 * mesma conta de cada produto (`totaisDoProduto`) e da receita
 * (`receitaDaVenda`), por isso os totais batem com a ficha de cada venda.
 * Dinheiro em centavos de real; a tela e a exportação convertem.
 *
 * E7 (frente C): empresa (relatório, filtro, coluna e campo da dinâmica só
 * com duas ou mais empresas), as colunas novas de Vendas por produto, a
 * viagem corporativa (venda e passageiro) e a conciliação do cartão
 * corporativo do cliente (`linhasDoCartaoCorporativo`).
 *
 * Colunas "sensíveis" (o ganho da agência: componentes, custo do fornecedor,
 * repasse, receita) só saem para quem tem o direito de ver comissão e receita
 * (`ver_colunas_comissao`); quem não tem nem recebe o número.
 */
import {
  COMPONENTES, FORMAS, ROTULO_TIPO_PRODUTO, TIPOS_COMPONENTE, TIPOS_PRODUTO, diariasEntre, emReais, pagoComCartaoCorporativo, textoDosCampos, totaisDoProduto,
  type Centavos, type FormaDaVenda, type PagamentoDaVenda, type ProdutoDaVenda, type TipoProduto, type Venda,
} from './venda-modelo';
import { CONFIG_RECEITA_PADRAO, receitaDaVenda, type ConfigReceita } from './venda-receita';
import type { VendaLida } from './vendas-leitura';
import type { RegistroDinamico } from './tabela-dinamica';

export type TipoDaColuna = 'texto' | 'data' | 'dinheiro' | 'numero' | 'percentual';

export interface ColunaDoRelatorio {
  id: string;
  rotulo: string;
  tipo: TipoDaColuna;
  /** O ganho da agência: só com o direito de ver comissão e receita. */
  sensivel?: boolean;
  /** Aparece sem a pessoa escolher. */
  padrao?: boolean;
  /** Só existe quando a agência tem duas ou mais empresas (E7, G2). */
  so_multiempresa?: boolean;
}

export type ValorDaCelula = string | number | null;
export type LinhaDoRelatorio = Record<string, ValorDaCelula> & { venda_id?: string };

export const RELATORIOS = ['produto', 'vendedor', 'unidade', 'empresa', 'fornecedor', 'forma', 'pagamentos', 'clientes', 'dinamica', 'cartao_corporativo'] as const;
export type TipoDeRelatorio = (typeof RELATORIOS)[number];

export const ROTULO_RELATORIO: Record<TipoDeRelatorio, string> = {
  produto: 'Vendas por produto',
  vendedor: 'Vendas por vendedor',
  unidade: 'Vendas por unidade',
  empresa: 'Vendas por empresa',
  fornecedor: 'Vendas por fornecedor',
  forma: 'Vendas por forma de pagamento',
  pagamentos: 'Pagamentos das vendas',
  clientes: 'Ranking de clientes',
  dinamica: 'Tabela dinâmica de vendas',
  cartao_corporativo: 'Conciliação do cartão corporativo do cliente',
};

/** Relatórios que só existem com duas ou mais empresas. */
export const RELATORIOS_MULTIEMPRESA: ReadonlySet<TipoDeRelatorio> = new Set(['empresa']);

const col = (id: string, rotulo: string, tipo: TipoDaColuna, o: Partial<ColunaDoRelatorio> = {}): ColunaDoRelatorio => ({ id, rotulo, tipo, ...o });
const colunasDeComponente = (): ColunaDoRelatorio[] =>
  TIPOS_COMPONENTE.map(t => col(`comp_${t}`, COMPONENTES[t].rotulo, 'dinheiro', { sensivel: true, padrao: t === 'COMISSAO' || t === 'TAXA_DU' || t === 'RAV' || t === 'FEE' }));

/**
 * Colunas de Vendas por produto (uma linha por produto vendido). As de
 * sempre continuam com o mesmo id e a mesma escolha padrão; as da E7 (datas
 * e dados do serviço, passageiros e documentos, taxas separadas, valores na
 * moeda de origem, forma de pagamento, empresa e a viagem corporativa) só
 * aparecem quando a pessoa escolhe em "Colunas".
 */
export const COLUNAS_POR_PRODUTO: ColunaDoRelatorio[] = [
  col('venda_numero', 'Venda', 'texto', { padrao: true }),
  col('data_venda', 'Data da venda', 'data', { padrao: true }),
  col('empresa', 'Empresa', 'texto', { so_multiempresa: true }),
  col('situacao', 'Situação', 'texto'),
  col('situacao_produto', 'Situação do produto', 'texto'),
  col('data_cancelamento', 'Cancelado em', 'data'),
  col('origem', 'Origem da venda', 'texto'),
  col('operacao_propria', 'Operação própria', 'texto'),
  col('cliente', 'Cliente', 'texto', { padrao: true }),
  col('cliente_documento', 'CPF/CNPJ do cliente', 'texto'),
  col('pagante', 'Pagante', 'texto'),
  col('vendedor', 'Vendedor', 'texto', { padrao: true }),
  col('intermediario', 'Intermediário', 'texto'),
  col('unidade', 'Unidade', 'texto'),
  col('tipo', 'Tipo de produto', 'texto', { padrao: true }),
  col('descricao', 'Produto', 'texto', { padrao: true }),
  col('fornecedor', 'Fornecedor', 'texto', { padrao: true }),
  col('representante', 'Representante', 'texto'),
  col('quem_cobra', 'Quem cobra', 'texto'),
  col('localizador', 'Localizador', 'texto'),
  col('documentos', 'Bilhetes e documentos', 'texto'),
  col('cia', 'Companhia aérea', 'texto'),
  col('trechos', 'Trechos (origem e destino)', 'texto'),
  col('destino', 'Destino', 'texto'),
  col('hotel', 'Hotel', 'texto'),
  col('acomodacao', 'Acomodação', 'texto'),
  col('categoria', 'Categoria', 'texto'),
  col('regime', 'Regime', 'texto'),
  col('navio', 'Navio', 'texto'),
  col('cabine', 'Cabine', 'texto'),
  col('pacote', 'Pacote', 'texto'),
  col('transporte', 'Transporte', 'texto'),
  col('plano', 'Plano do seguro', 'texto'),
  col('retirada', 'Retirada', 'texto'),
  col('devolucao', 'Devolução', 'texto'),
  col('reserva', 'Número da reserva', 'texto'),
  col('data_inicio', 'Início', 'data'),
  col('data_fim', 'Fim', 'data'),
  col('diarias', 'Diárias', 'numero'),
  col('data_pagamento_fornecedor', 'Pagar o fornecedor em', 'data'),
  col('moeda', 'Moeda', 'texto'),
  col('cambio', 'Câmbio', 'numero'),
  col('passageiros', 'Passageiros', 'numero'),
  col('adultos', 'Adultos', 'numero'),
  col('criancas', 'Crianças', 'numero'),
  col('bebes', 'Bebês', 'numero'),
  col('nomes_passageiros', 'Nomes dos passageiros', 'texto'),
  col('quantidade', 'Quantidade', 'numero'),
  col('valor_unitario', 'Valor unitário', 'dinheiro'),
  col('tarifa', 'Tarifa', 'dinheiro'),
  col('taxas', 'Taxas', 'dinheiro'),
  col('taxa_embarque', 'Taxa de embarque', 'dinheiro'),
  col('outras_taxas', 'Outras taxas', 'dinheiro'),
  ...colunasDeComponente(),
  col('percentual_comissao', 'Comissão (% da tarifa)', 'percentual', { sensivel: true }),
  col('faturamento', 'Faturamento', 'dinheiro', { padrao: true }),
  col('valor_fornecedor', 'Custo do fornecedor', 'dinheiro', { sensivel: true }),
  col('repasse', 'Repasse ao intermediário', 'dinheiro', { sensivel: true }),
  col('receita', 'Receita da agência', 'dinheiro', { sensivel: true, padrao: true }),
  col('percentual_receita', '% de receita', 'percentual', { sensivel: true, padrao: true }),
  col('tarifa_moeda', 'Tarifa na moeda de origem', 'numero'),
  col('faturamento_moeda', 'Faturamento na moeda de origem', 'numero'),
  col('valor_fornecedor_moeda', 'Custo na moeda de origem', 'numero', { sensivel: true }),
  col('formas', 'Formas de pagamento', 'texto'),
  col('cartao_corporativo', 'Pago com cartão corporativo do cliente', 'texto'),
  col('cc_cliente', 'Centro de custo do cliente', 'texto'),
  col('solicitante', 'Solicitante', 'texto'),
  col('aprovador', 'Aprovador', 'texto'),
  col('matricula', 'Matrícula', 'texto'),
  col('motivo', 'Motivo da viagem', 'texto'),
  col('projeto', 'Projeto', 'texto'),
  col('requisicao', 'Requisição', 'texto'),
  col('crm', 'Negócio no CRM', 'texto'),
];

/** Colunas dos relatórios agrupados (vendedor, unidade). */
export function colunasAgrupadas(rotuloDoGrupo: string): ColunaDoRelatorio[] {
  return [
    col('grupo', rotuloDoGrupo, 'texto', { padrao: true }),
    col('vendas', 'Vendas', 'numero', { padrao: true }),
    col('produtos', 'Produtos', 'numero', { padrao: true }),
    col('passageiros', 'Passageiros', 'numero'),
    col('tarifa', 'Tarifa', 'dinheiro'),
    col('taxas', 'Taxas', 'dinheiro'),
    ...colunasDeComponente(),
    col('faturamento', 'Faturamento', 'dinheiro', { padrao: true }),
    col('valor_fornecedor', 'Custo do fornecedor', 'dinheiro', { sensivel: true }),
    col('repasse', 'Repasse ao intermediário', 'dinheiro', { sensivel: true }),
    col('receita', 'Receita da agência', 'dinheiro', { sensivel: true, padrao: true }),
    col('percentual_receita', '% de receita', 'percentual', { sensivel: true, padrao: true }),
    col('ticket_medio', 'Ticket médio', 'dinheiro', { padrao: true }),
  ];
}

export const COLUNAS_POR_FORMA: ColunaDoRelatorio[] = [
  col('grupo', 'Forma de pagamento', 'texto', { padrao: true }),
  col('vendas', 'Vendas', 'numero', { padrao: true }),
  col('parcelas', 'Parcelas', 'numero', { padrao: true }),
  col('valor', 'Valor', 'dinheiro', { padrao: true }),
  col('percentual', '% do total', 'percentual', { padrao: true }),
];

export const COLUNAS_RANKING: ColunaDoRelatorio[] = [
  col('posicao', 'Posição', 'numero', { padrao: true }),
  col('grupo', 'Cliente', 'texto', { padrao: true }),
  col('vendas', 'Vendas', 'numero', { padrao: true }),
  col('passageiros', 'Passageiros', 'numero'),
  col('faturamento', 'Faturamento', 'dinheiro', { padrao: true }),
  col('receita', 'Receita da agência', 'dinheiro', { sensivel: true, padrao: true }),
  col('ticket_medio', 'Ticket médio', 'dinheiro', { padrao: true }),
  col('primeira_compra', 'Primeira compra', 'data'),
  col('ultima_compra', 'Última compra', 'data', { padrao: true }),
];

// ============================================================
// Vendas por produto
// ============================================================

const SEM = (s: string, falta: string) => (s && s.trim() ? s.trim() : falta);
const pct = (receita: number, faturamento: number) => (faturamento ? Math.round((receita / faturamento) * 10000) / 100 : 0);

/** Nome de cada empresa (id → nome), para a coluna e o filtro de empresa. */
export type NomesDeEmpresa = ReadonlyMap<string, string>;

/** O nome da empresa da venda (sem cadastro: a principal ou o próprio id). */
export function nomeDaEmpresa(id: string | undefined, empresas?: NomesDeEmpresa): string {
  const k = id || 'principal';
  return empresas?.get(k) ?? (k === 'principal' ? 'Empresa principal' : k);
}

const ROTULO_ORIGEM: Record<Venda['origem'], string> = { manual: 'Lançada aqui', crm: 'CRM', mudanca: 'Sistema anterior' };
const juntar = (xs: ReadonlyArray<string | undefined>) => [...new Set(xs.map(x => (x ?? '').trim()).filter(Boolean))].join(', ');
const detalhe = (p: ProdutoDaVenda, ...chaves: string[]) => juntar(chaves.map(k => p.detalhes?.[k]));

/** Diárias do produto: a digitada, senão pelas datas (check-in/out, retirada/devolução). */
function diariasDoProduto(p: ProdutoDaVenda): number {
  const d = Number(p.detalhes?.diarias);
  if (Number.isFinite(d) && d > 0) return Math.floor(d);
  if (p.tipo === 'HOSPEDAGEM') return diariasEntre(p.detalhes?.checkin || p.data_inicio, p.detalhes?.checkout || p.data_fim);
  if (p.tipo === 'LOCACAO') return diariasEntre(p.detalhes?.retirada_data || p.data_inicio, p.detalhes?.devolucao_data || p.data_fim);
  return 0;
}

/** Taxa de embarque e outras taxas do produto, na moeda dele (passageiros ativos). */
function taxasSeparadas(p: ProdutoDaVenda): { embarque: Centavos; outras: Centavos } {
  if (p.cancelado_em) return { embarque: 0, outras: 0 };
  if (!p.passageiros.length) return { embarque: p.taxas_centavos, outras: 0 };
  const ativos = p.passageiros.filter(x => !x.cancelado_em);
  return { embarque: ativos.reduce((a, x) => a + x.taxas_centavos, 0), outras: ativos.reduce((a, x) => a + x.outras_taxas_centavos, 0) };
}

/** Uma linha por produto, com a receita aberta por componente. */
export function linhasPorProduto(vendas: VendaLida[], cfg: ConfigReceita = CONFIG_RECEITA_PADRAO, empresas?: NomesDeEmpresa): LinhaDoRelatorio[] {
  const linhas: LinhaDoRelatorio[] = [];
  for (const lida of vendas) {
    const v = lida.venda;
    const rec = receitaDaVenda(v, cfg);
    const pagante = paganteDaVenda(v);
    const formas = juntar(lida.pagamentos.map(g => FORMAS[g.forma]?.rotulo));
    const corporativo = lida.pagamentos.some(pagoComCartaoCorporativo);
    const corp = v.corporativo ?? {};
    for (const p of v.produtos) {
      const t = totaisDoProduto(p);
      const receita = rec.por_produto.find(x => x.produto_id === p.id)?.receita ?? 0;
      const ativos = p.cancelado_em ? [] : p.passageiros.filter(x => !x.cancelado_em);
      const tx = taxasSeparadas(p);
      const r = (c: Centavos) => emReais(c, p.moeda, p.cambio);
      const linha: LinhaDoRelatorio = {
        venda_id: v.id,
        venda_numero: v.numero, data_venda: v.data_venda,
        situacao: lida.cancelada ? 'Cancelada' : lida.situacao === 'FECHADA' ? 'Fechada' : 'Aberta',
        cliente: SEM(v.cliente.nome, 'Sem cliente'), vendedor: SEM(v.vendedor?.nome ?? '', 'Sem vendedor'),
        intermediario: v.intermediario?.nome ?? '', unidade: SEM(v.centro_custo, 'Sem unidade'),
        tipo: ROTULO_TIPO_PRODUTO[p.tipo], descricao: p.descricao, fornecedor: SEM(p.fornecedor?.nome ?? '', 'Sem fornecedor'),
        representante: p.representante?.nome ?? '', quem_cobra: p.quem_cobra === 'FORNECEDOR' ? 'Fornecedor' : 'Agência',
        localizador: p.localizador, data_inicio: p.data_inicio, data_fim: p.data_fim, moeda: p.moeda, cambio: p.cambio,
        passageiros: t.passageiros_ativos, tarifa: t.brl.tarifa, taxas: t.brl.taxas,
        faturamento: t.brl.valor_cliente, valor_fornecedor: t.brl.valor_fornecedor, repasse: t.brl.repasse,
        receita, percentual_receita: pct(receita, t.brl.valor_cliente),
        // Para os filtros e a tabela dinâmica (não são colunas do catálogo).
        situacao_produto: p.cancelado_em ? 'Cancelado' : 'Ativo', destino: SEM(p.detalhes?.destino ?? '', 'Sem destino'), pagante,
        ano: /^\d{4}/.test(v.data_venda) ? v.data_venda.slice(0, 4) : 'Sem data',
        vendedor_chave: chaveDaParte(v.vendedor), fornecedor_chave: chaveDaParte(p.fornecedor), tipo_codigo: p.tipo,
        // E7: empresa, serviço, passageiros, taxas separadas, moeda de origem, pagamento e viagem corporativa.
        empresa_id: lida.empresa_id || 'principal', empresa: nomeDaEmpresa(lida.empresa_id, empresas),
        data_cancelamento: p.cancelado_em ?? '', origem: ROTULO_ORIGEM[v.origem] ?? '', operacao_propria: v.operacao_propria ? 'Sim' : '',
        cliente_documento: v.cliente.documento ?? '',
        documentos: juntar(ativos.map(x => x.documento)), nomes_passageiros: juntar(ativos.map(x => x.nome)),
        adultos: ativos.filter(x => x.tipo === 'ADT').length, criancas: ativos.filter(x => x.tipo === 'CHD').length, bebes: ativos.filter(x => x.tipo === 'INF').length,
        cia: detalhe(p, 'cia'), trechos: detalhe(p, 'trechos'), hotel: detalhe(p, 'hotel'), acomodacao: detalhe(p, 'acomodacao'),
        categoria: detalhe(p, 'categoria', 'cabine_categoria'), regime: detalhe(p, 'regime'), navio: detalhe(p, 'navio'),
        cabine: [p.detalhes?.cabine, p.detalhes?.cabine_tipo].filter(Boolean).join(' · '), pacote: detalhe(p, 'pacote'),
        transporte: detalhe(p, 'transporte'), plano: detalhe(p, 'plano'), retirada: detalhe(p, 'retirada'), devolucao: detalhe(p, 'devolucao'),
        reserva: detalhe(p, 'reserva'), diarias: diariasDoProduto(p), data_pagamento_fornecedor: p.data_pagamento_fornecedor,
        quantidade: p.passageiros.length ? t.passageiros_ativos : p.quantidade,
        valor_unitario: p.passageiros.length ? null : r(p.valor_unitario_centavos),
        taxa_embarque: r(tx.embarque), outras_taxas: r(tx.outras),
        percentual_comissao: pct(t.componentes.COMISSAO, t.tarifa),
        tarifa_moeda: t.tarifa / 100, faturamento_moeda: t.valor_cliente / 100, valor_fornecedor_moeda: t.valor_fornecedor / 100,
        formas, cartao_corporativo: corporativo ? 'Sim' : '',
        cc_cliente: juntar([corp.centro_custo, ...ativos.map(x => x.corporativo?.centro_custo)]),
        solicitante: corp.solicitante ?? '', aprovador: corp.aprovador ?? '',
        matricula: juntar([corp.matricula, ...ativos.map(x => x.corporativo?.matricula)]),
        motivo: corp.motivo ?? '', projeto: corp.projeto ?? '',
        requisicao: juntar([corp.requisicao, ...lida.pagamentos.map(g => g.campos?.requisicao)]),
        crm: v.crm_venda_id,
      };
      for (const c of TIPOS_COMPONENTE) linha[`comp_${c}`] = t.brl.componentes[c];
      linhas.push(linha);
    }
  }
  return linhas;
}

/** Quem paga a venda: os pagantes dos pagamentos, ou o cliente. */
export function paganteDaVenda(v: Pick<Venda, 'cliente' | 'pagamentos'>): string {
  const nomes = [...new Set(v.pagamentos.map(p => p.pagante?.nome?.trim()).filter((n): n is string => Boolean(n)))];
  return nomes.length ? nomes.join(', ') : SEM(v.cliente.nome, 'Sem cliente');
}

/** Chave estável de uma parte (o cadastro, ou o nome quando não há cadastro). */
export function chaveDaParte(p: { id: string; nome: string } | null | undefined): string {
  if (!p) return '';
  return p.id ? `id:${p.id}` : p.nome.trim() ? `nome:${p.nome.trim().toLowerCase()}` : '';
}

// ============================================================
// Filtros (fornecedor, vendedor, produto, unidade, situação, data)
// ============================================================

export const DATAS_BASE = ['venda', 'inicio', 'fim'] as const;
export type DataBase = (typeof DATAS_BASE)[number];
export const ROTULO_DATA_BASE: Record<DataBase, string> = { venda: 'Data da venda', inicio: 'Início do serviço', fim: 'Fim do serviço' };

export interface FiltroDoRelatorio {
  de?: string;
  ate?: string;
  data_base?: DataBase;
  fornecedor?: string;
  vendedor?: string;
  tipo?: string;
  /** Texto do produto (descrição ou localizador). */
  produto?: string;
  unidade?: string;
  situacao_produto?: 'todos' | 'ativos' | 'cancelados';
  /** Empresa da venda (E7, várias empresas). */
  empresa?: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** A data da linha que vale para o período escolhido. */
export function dataDaLinha(l: LinhaDoRelatorio, base: DataBase = 'venda'): string {
  const v = base === 'inicio' ? l.data_inicio : base === 'fim' ? l.data_fim : l.data_venda;
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

/** Linhas por produto que passam no filtro. Sem filtro, todas. */
export function filtrarLinhas(linhas: LinhaDoRelatorio[], f: FiltroDoRelatorio): LinhaDoRelatorio[] {
  const base = f.data_base ?? 'venda';
  const texto = f.produto ? semAcento(f.produto.trim()) : '';
  return linhas.filter(l => {
    if (base !== 'venda' && (f.de || f.ate)) {
      const d = dataDaLinha(l, base);
      if (!d) return false;
      if (f.de && d < f.de) return false;
      if (f.ate && d > f.ate) return false;
    }
    if (f.fornecedor && l.fornecedor_chave !== f.fornecedor) return false;
    if (f.vendedor && l.vendedor_chave !== f.vendedor) return false;
    if (f.tipo && l.tipo_codigo !== f.tipo) return false;
    if (f.unidade && l.unidade !== f.unidade) return false;
    if (f.empresa && l.empresa_id !== f.empresa) return false;
    if (f.situacao_produto === 'ativos' && l.situacao_produto !== 'Ativo') return false;
    if (f.situacao_produto === 'cancelados' && l.situacao_produto !== 'Cancelado') return false;
    if (texto && !semAcento(`${l.descricao ?? ''} ${l.localizador ?? ''}`).includes(texto)) return false;
    return true;
  });
}

/** Algum filtro além do período? */
export function temFiltroDeProduto(f: FiltroDoRelatorio): boolean {
  return Boolean(f.fornecedor || f.vendedor || f.tipo || f.produto?.trim() || f.unidade || f.empresa || (f.situacao_produto && f.situacao_produto !== 'todos') || (f.data_base && f.data_base !== 'venda'));
}

export interface OpcaoDoFiltro { valor: string; rotulo: string }
export interface OpcoesDosFiltros { fornecedores: OpcaoDoFiltro[]; vendedores: OpcaoDoFiltro[]; unidades: OpcaoDoFiltro[]; tipos: OpcaoDoFiltro[]; empresas?: OpcaoDoFiltro[] }

/** As escolhas dos filtros, tiradas das vendas do período (só o que existe). */
export function opcoesDosFiltros(linhas: LinhaDoRelatorio[]): OpcoesDosFiltros {
  const junta = (chave: string, rotulo: string) => {
    const m = new Map<string, string>();
    for (const l of linhas) { const k = String(l[chave] ?? ''); if (k && !m.has(k)) m.set(k, String(l[rotulo] ?? k)); }
    return [...m.entries()].map(([valor, r]) => ({ valor, rotulo: r })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  };
  const tipos = new Set(linhas.map(l => String(l.tipo_codigo ?? '')));
  return {
    fornecedores: junta('fornecedor_chave', 'fornecedor'),
    vendedores: junta('vendedor_chave', 'vendedor'),
    unidades: junta('unidade', 'unidade'),
    tipos: TIPOS_PRODUTO.filter(t => tipos.has(t)).map(t => ({ valor: t, rotulo: ROTULO_TIPO_PRODUTO[t as TipoProduto] })),
    empresas: junta('empresa_id', 'empresa'),
  };
}

// ============================================================
// Agrupados: vendedor, unidade, fornecedor, cliente
// ============================================================

const SOMAVEIS = ['passageiros', 'tarifa', 'taxas', 'faturamento', 'valor_fornecedor', 'repasse', 'receita', ...TIPOS_COMPONENTE.map(t => `comp_${t}`)];

function agrupar(linhas: LinhaDoRelatorio[], chave: (l: LinhaDoRelatorio) => string): LinhaDoRelatorio[] {
  const grupos = new Map<string, { linha: LinhaDoRelatorio; vendas: Set<string>; datas: string[] }>();
  for (const l of linhas) {
    const k = chave(l);
    let g = grupos.get(k);
    if (!g) {
      const base: LinhaDoRelatorio = { grupo: k, vendas: 0, produtos: 0 };
      for (const s of SOMAVEIS) base[s] = 0;
      g = { linha: base, vendas: new Set(), datas: [] };
      grupos.set(k, g);
    }
    g.vendas.add(String(l.venda_id));
    g.datas.push(String(l.data_venda ?? ''));
    g.linha.produtos = Number(g.linha.produtos) + 1;
    for (const s of SOMAVEIS) g.linha[s] = Number(g.linha[s]) + Number(l[s] ?? 0);
  }
  return [...grupos.values()].map(({ linha, vendas, datas }) => {
    const qtd = vendas.size;
    const fat = Number(linha.faturamento);
    const ordenadas = datas.filter(Boolean).sort();
    return {
      ...linha, vendas: qtd, percentual_receita: pct(Number(linha.receita), fat),
      ticket_medio: qtd ? Math.round(fat / qtd) : 0,
      primeira_compra: ordenadas[0] ?? '', ultima_compra: ordenadas[ordenadas.length - 1] ?? '',
    };
  });
}

/** Ordem dos agrupados e do ranking: por faturamento (padrão) ou pela receita da agência. */
export type OrdemDoRanking = 'faturamento' | 'receita';
const ordenarPor = (m: OrdemDoRanking) => (a: LinhaDoRelatorio, b: LinhaDoRelatorio) =>
  Number(b[m] ?? 0) - Number(a[m] ?? 0) || Number(b.faturamento) - Number(a.faturamento) || String(a.grupo).localeCompare(String(b.grupo), 'pt-BR');

export function linhasPorVendedor(produtos: LinhaDoRelatorio[], ordem: OrdemDoRanking = 'faturamento'): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.vendedor)).sort(ordenarPor(ordem));
}

export function linhasPorUnidade(produtos: LinhaDoRelatorio[], ordem: OrdemDoRanking = 'faturamento'): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.unidade)).sort(ordenarPor(ordem));
}

/** Vendas por empresa (E7, várias empresas). */
export function linhasPorEmpresa(produtos: LinhaDoRelatorio[], ordem: OrdemDoRanking = 'faturamento'): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.empresa ?? 'Empresa principal')).sort(ordenarPor(ordem));
}

export function linhasPorFornecedor(produtos: LinhaDoRelatorio[], ordem: OrdemDoRanking = 'faturamento'): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.fornecedor)).sort(ordenarPor(ordem));
}

/** Ranking de clientes: por faturamento ou pela receita da agência, com a posição. */
export function rankingDeClientes(produtos: LinhaDoRelatorio[], ordem: OrdemDoRanking = 'faturamento'): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.cliente)).sort(ordenarPor(ordem)).map((l, i) => ({ ...l, posicao: i + 1 }));
}

// ============================================================
// Forma de pagamento
// ============================================================

/** Forma do cabeçalho antigo (rótulo ou código) → forma do modelo. */
export function formaDoCabecalho(v: unknown): FormaDaVenda {
  const s = (v === null || v === undefined ? '' : String(v).trim()).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.includes('PIX') || s === 'AVISTA_PIX') return 'PIX';
  if (s.includes('BOLETO')) return 'BOLETO';
  if (s.includes('CARTAO')) return 'CARTAO';
  if (s.includes('FATUR')) return 'FATURAR';
  if (s.includes('DINHEIRO')) return 'DINHEIRO';
  if (s.includes('CHEQUE')) return 'CHEQUE';
  if (s.includes('DEPOSITO') || s.includes('TED') || s.includes('TRANSFER')) return 'DEPOSITO';
  if (s.includes('CREDITO DO CLIENTE')) return 'CREDITO_CLIENTE';
  if (s.includes('INTERMEDIARIO')) return 'RETIDO_INTERMEDIARIO';
  if (s.includes('DIRETO')) return 'PAGO_DIRETO_FORNECEDOR';
  return 'OUTROS';
}


export function linhasPorForma(vendas: VendaLida[]): LinhaDoRelatorio[] {
  const grupos = new Map<FormaDaVenda, { vendas: Set<string>; parcelas: number; valor: Centavos }>();
  let total = 0;
  for (const lida of vendas) {
    for (const p of lida.pagamentos) {
      const g = grupos.get(p.forma) ?? { vendas: new Set<string>(), parcelas: 0, valor: 0 };
      g.vendas.add(lida.venda.id);
      g.parcelas += p.parcelas;
      g.valor += p.valor_centavos;
      total += p.valor_centavos;
      grupos.set(p.forma, g);
    }
  }
  return [...grupos.entries()]
    .map(([forma, g]) => ({ grupo: FORMAS[forma].rotulo, forma, vendas: g.vendas.size, parcelas: g.parcelas, valor: g.valor, percentual: pct(g.valor, total) }))
    .sort((a, b) => b.valor - a.valor);
}

// ============================================================
// Pagamentos das vendas (forma detalhada, pagamento a pagamento)
// ============================================================

/** O que já entrou de um pagamento: as contas a receber que nasceram dele. */
export interface LiquidacaoDoPagamento {
  /** Total das contas a receber do pagamento (sem as canceladas). */
  valor_centavos: Centavos;
  /** O que já foi recebido nelas. */
  liquidado_centavos: Centavos;
  /** Data do último recebimento (AAAA-MM-DD) ou vazio. */
  ultima_liquidacao: string;
  /** Conta bancária onde caiu (a última) ou a prevista. */
  conta_bancaria_id: string;
  /** Quantas contas a receber o pagamento gerou. */
  contas: number;
}

/** Chave da liquidação: a venda e o pagamento dela. */
export const chaveDoPagamento = (vendaId: string, pagamentoId: string) => `${vendaId}|${pagamentoId}`;

export const SITUACOES_DO_PAGAMENTO = ['Liquidado', 'Parcial', 'Em aberto', 'Compensado'] as const;
export type SituacaoDoPagamento = (typeof SITUACOES_DO_PAGAMENTO)[number];

export const COLUNAS_DOS_PAGAMENTOS: ColunaDoRelatorio[] = [
  col('venda_numero', 'Venda', 'texto', { padrao: true }),
  col('data_venda', 'Data da venda', 'data', { padrao: true }),
  col('cliente', 'Cliente', 'texto'),
  col('pagante', 'Pagante', 'texto', { padrao: true }),
  col('vendedor', 'Vendedor', 'texto'),
  col('grupo', 'Forma de pagamento', 'texto', { padrao: true }),
  col('cartao_cheque', 'Cartão / cheque', 'texto', { padrao: true }),
  col('parcelas', 'Parcelas', 'numero', { padrao: true }),
  col('primeiro_vencimento', '1º vencimento', 'data'),
  col('valor', 'Valor', 'dinheiro', { padrao: true }),
  col('conta', 'Conta', 'texto', { padrao: true }),
  col('liquidado', 'Recebido', 'dinheiro', { padrao: true }),
  col('liquidacao', 'Liquidação', 'data', { padrao: true }),
  col('situacao_pagamento', 'Situação', 'texto', { padrao: true }),
  col('fornecedor', 'Fornecedor que recebeu', 'texto'),
  col('venda_origem_credito', 'Venda de origem do crédito', 'texto'),
  col('empresa', 'Empresa', 'texto', { so_multiempresa: true }),
  col('cartao_corporativo', 'Cartão corporativo do cliente', 'texto'),
  col('dados_da_forma', 'Bandeira, final e autorização', 'texto'),
  col('requisicao', 'Requisição', 'texto'),
];

function rotuloDoCartaoOuCheque(forma: FormaDaVenda, cartao: 'credito' | 'debito' | null, detalhe: string): string {
  const partes: string[] = [];
  if (forma === 'CARTAO') partes.push(cartao === 'debito' ? 'Débito' : 'Crédito');
  if ((forma === 'CARTAO' || forma === 'CHEQUE') && detalhe.trim()) partes.push(detalhe.trim());
  return partes.join(' · ');
}

/**
 * Uma linha por pagamento de cada venda: quem pagou, a forma (cartão crédito
 * ou débito, o cheque), a conta, o que já entrou e quando, a venda que gerou
 * o crédito usado. `soLiquidados` deixa só o que já foi recebido por inteiro.
 */
export function linhasDosPagamentos(
  vendas: VendaLida[], liquidacoes: Map<string, LiquidacaoDoPagamento>, nomesDeConta: Map<string, string>,
  opcoes: { soLiquidados?: boolean; empresas?: NomesDeEmpresa } = {},
): LinhaDoRelatorio[] {
  const linhas: LinhaDoRelatorio[] = [];
  for (const lida of vendas) {
    const v = lida.venda;
    for (const p of lida.pagamentos) {
      const info = FORMAS[p.forma];
      const liq = liquidacoes.get(chaveDoPagamento(v.id, p.id));
      const compensa = info.efeito === 'credito_do_cliente' || info.efeito === 'abate_do_fornecedor';
      const liquidado = liq?.liquidado_centavos ?? 0;
      const devido = liq && liq.valor_centavos > 0 ? liq.valor_centavos : p.valor_centavos;
      const situacao: SituacaoDoPagamento = compensa ? 'Compensado' : liquidado >= devido && devido > 0 ? 'Liquidado' : liquidado > 0 ? 'Parcial' : 'Em aberto';
      if (opcoes.soLiquidados && situacao !== 'Liquidado') continue;
      const contaId = liq?.conta_bancaria_id || p.conta_bancaria_id || '';
      linhas.push({
        venda_id: v.id, venda_numero: v.numero, data_venda: v.data_venda,
        cliente: SEM(v.cliente.nome, 'Sem cliente'), pagante: SEM(p.pagante?.nome ?? '', SEM(v.cliente.nome, 'Sem cliente')),
        vendedor: SEM(v.vendedor?.nome ?? '', 'Sem vendedor'), vendedor_chave: chaveDaParte(v.vendedor),
        grupo: info.rotulo, forma: p.forma, cartao_cheque: rotuloDoCartaoOuCheque(p.forma, p.cartao_tipo, p.detalhe),
        parcelas: p.parcelas, primeiro_vencimento: p.primeiro_vencimento, valor: p.valor_centavos,
        conta: contaId ? (nomesDeConta.get(contaId) ?? '') : '', liquidado: compensa ? p.valor_centavos : liquidado,
        liquidacao: compensa ? v.data_venda : liq?.ultima_liquidacao ?? '', situacao_pagamento: situacao,
        fornecedor: p.fornecedor?.nome ?? '', venda_origem_credito: p.venda_origem_credito,
        unidade: SEM(v.centro_custo, 'Sem unidade'),
        empresa_id: lida.empresa_id || 'principal', empresa: nomeDaEmpresa(lida.empresa_id, opcoes.empresas),
        cartao_corporativo: pagoComCartaoCorporativo(p) ? 'Sim' : '', dados_da_forma: textoDosCampos(p.campos), requisicao: p.campos?.requisicao ?? '',
      });
    }
  }
  return linhas;
}

// ============================================================
// Série por mês (o gráfico de barras do período)
// ============================================================

/** Soma da medida por mês da venda (ou da data escolhida), em ordem de mês. */
export function seriePorMes(linhas: LinhaDoRelatorio[], medida: string, base: DataBase = 'venda'): Array<{ mes: string; rotulo: string; centavos: number }> {
  const m = new Map<string, number>();
  for (const l of linhas) {
    const d = dataDaLinha(l, base);
    const k = /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : 'sem-data';
    m.set(k, (m.get(k) ?? 0) + Math.round(Number(l[medida] ?? 0)));
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, centavos]) => ({
    mes, centavos, rotulo: mes === 'sem-data' ? 'Sem data' : `${MESES[Number(mes.slice(5, 7)) - 1] ?? ''}/${mes.slice(0, 4)}`,
  }));
}

// ============================================================
// Tabela dinâmica
// ============================================================

export const CAMPOS_DA_DINAMICA = ['Mês', 'Ano', 'Vendedor', 'Tipo de produto', 'Fornecedor', 'Representante', 'Destino', 'Cliente', 'Pagante', 'Unidade', 'Situação', 'Situação do produto', 'Empresa', 'Centro de custo do cliente', 'Projeto'] as const;
/** Campos da dinâmica que só existem com duas ou mais empresas. */
export const CAMPOS_DA_DINAMICA_MULTIEMPRESA: ReadonlySet<string> = new Set(['Empresa']);

export const MEDIDAS_DA_DINAMICA: ColunaDoRelatorio[] = [
  col('faturamento', 'Faturamento', 'dinheiro'),
  col('tarifa', 'Tarifa', 'dinheiro'),
  col('receita', 'Receita da agência', 'dinheiro', { sensivel: true }),
  col('valor_fornecedor', 'Custo do fornecedor', 'dinheiro', { sensivel: true }),
  ...TIPOS_COMPONENTE.map(t => col(`comp_${t}`, COMPONENTES[t].rotulo, 'dinheiro', { sensivel: true })),
];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function rotuloDoMesDaVenda(data: string): string {
  if (!/^\d{4}-\d{2}/.test(data)) return 'Sem data';
  return `${data.slice(0, 4)}-${data.slice(5, 7)} ${MESES[Number(data.slice(5, 7)) - 1] ?? ''}`.trim();
}

/** Registros para `montarTabelaDinamica`: uma por produto, com a medida escolhida. */
export function registrosDaDinamica(produtos: LinhaDoRelatorio[], medida: string): RegistroDinamico<{ venda_id: string; venda_numero: string }>[] {
  return produtos.map(l => ({
    campos: {
      'Mês': rotuloDoMesDaVenda(String(l.data_venda ?? '')), 'Ano': String(l.ano ?? (String(l.data_venda ?? '').slice(0, 4) || 'Sem data')),
      'Vendedor': String(l.vendedor), 'Tipo de produto': String(l.tipo),
      'Fornecedor': String(l.fornecedor), 'Representante': SEM(String(l.representante ?? ''), 'Sem representante'),
      'Destino': String(l.destino ?? 'Sem destino'), 'Cliente': String(l.cliente), 'Pagante': String(l.pagante ?? l.cliente),
      'Unidade': String(l.unidade), 'Situação': String(l.situacao), 'Situação do produto': String(l.situacao_produto ?? 'Ativo'),
      'Empresa': String(l.empresa ?? 'Empresa principal'), 'Centro de custo do cliente': SEM(String(l.cc_cliente ?? ''), 'Sem centro de custo'),
      'Projeto': SEM(String(l.projeto ?? ''), 'Sem projeto'),
    },
    centavos: Math.round(Number(l[medida] ?? 0)),
    ref: { venda_id: String(l.venda_id), venda_numero: String(l.venda_numero) },
  }));
}

// ============================================================
// Direitos, colunas e exportação
// ============================================================

/** As colunas que a pessoa pode ver (e, se escolheu, só as escolhidas, na ordem do catálogo). */
export function colunasPermitidas(catalogo: ColunaDoRelatorio[], verReceita: boolean, escolhidas?: string[], multiempresa = false): ColunaDoRelatorio[] {
  const podem = catalogo.filter(c => (verReceita || !c.sensivel) && (multiempresa || !c.so_multiempresa));
  if (!escolhidas?.length) return podem.filter(c => c.padrao);
  const quer = new Set(escolhidas);
  const filtradas = podem.filter(c => quer.has(c.id));
  return filtradas.length ? filtradas : podem.filter(c => c.padrao);
}

/** Tira das linhas o que a pessoa não pode ver (o número nem sai do servidor). */
export function semColunasSensiveis(linhas: LinhaDoRelatorio[], catalogo: ColunaDoRelatorio[], verReceita: boolean): LinhaDoRelatorio[] {
  if (verReceita) return linhas;
  const fora = catalogo.filter(c => c.sensivel).map(c => c.id);
  return linhas.map(l => {
    const copia: LinhaDoRelatorio = { ...l };
    for (const k of fora) delete copia[k];
    return copia;
  });
}

/** Números que não se somam no total (câmbio, posição, valores em moedas diferentes). */
const NAO_SOMAM = new Set(['cambio', 'posicao', 'tarifa_moeda', 'faturamento_moeda', 'valor_fornecedor_moeda']);

export function totaisDasLinhas(linhas: LinhaDoRelatorio[], colunas: ColunaDoRelatorio[]): LinhaDoRelatorio {
  const t: LinhaDoRelatorio = {};
  for (const c of colunas) {
    if (c.tipo === 'dinheiro' || (c.tipo === 'numero' && !NAO_SOMAM.has(c.id))) t[c.id] = linhas.reduce((a, l) => a + Number(l[c.id] ?? 0), 0);
  }
  if (colunas.some(c => c.id === 'percentual_receita')) t.percentual_receita = pct(Number(t.receita ?? linhas.reduce((a, l) => a + Number(l.receita ?? 0), 0)), Number(t.faturamento ?? linhas.reduce((a, l) => a + Number(l.faturamento ?? 0), 0)));
  if (colunas.some(c => c.id === 'percentual')) t.percentual = linhas.length ? 100 : 0;
  if (colunas.some(c => c.id === 'ticket_medio')) {
    const vendas = linhas.reduce((a, l) => a + Number(l.vendas ?? 0), 0);
    const fat = linhas.reduce((a, l) => a + Number(l.faturamento ?? 0), 0);
    t.ticket_medio = vendas ? Math.round(fat / vendas) : 0;
  }
  return t;
}

const dataBR = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s);

/** Valor da célula para exportar: dinheiro em reais (número), data em dd/mm/aaaa. */
export function valorParaExportar(c: ColunaDoRelatorio, v: ValorDaCelula): string | number {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'dinheiro') return Math.round(Number(v)) / 100;
  if (c.tipo === 'percentual' || c.tipo === 'numero') return Number(v);
  if (c.tipo === 'data') return dataBR(String(v));
  return String(v);
}

/** A planilha em matriz (cabeçalho + linhas + total), igual para CSV e XLSX. */
export function matrizParaExportar(colunas: ColunaDoRelatorio[], linhas: LinhaDoRelatorio[], comTotal = true): Array<Array<string | number>> {
  const m: Array<Array<string | number>> = [colunas.map(c => c.rotulo)];
  for (const l of linhas) m.push(colunas.map(c => valorParaExportar(c, l[c.id] ?? null)));
  if (comTotal && linhas.length) {
    const t = totaisDasLinhas(linhas, colunas);
    m.push(colunas.map((c, i) => (i === 0 ? 'Total' : t[c.id] === undefined ? '' : valorParaExportar(c, t[c.id]))));
  }
  return m;
}

/** CSV com ponto e vírgula e vírgula decimal (o Excel brasileiro abre direto). */
export function csvDaMatriz(m: Array<Array<string | number>>): string {
  const cel = (v: string | number) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + m.map(l => l.map(cel).join(';')).join('\r\n');
}

// ============================================================
// Conciliação do cartão corporativo do cliente (E7)
// ============================================================

/**
 * O arquivo que a administradora do cartão de viagem da empresa cliente pede
 * para conciliar a fatura: uma linha por bilhete (passageiro de cada
 * produto) pago com o cartão corporativo do cliente, com o valor da
 * transação, a tarifa e as taxas abertas, o cartão (bandeira, os 4 últimos
 * dígitos e a autorização, nunca o número) e os dados que a empresa usa para
 * ratear (centro de custo, matrícula, solicitante, aprovador, projeto,
 * motivo, requisição). A última coluna diz o que falta para a linha valer.
 */
export const COLUNAS_CARTAO_CORPORATIVO: ColunaDoRelatorio[] = [
  col('data_venda', 'Data da venda', 'data', { padrao: true }),
  col('venda_numero', 'Venda', 'texto', { padrao: true }),
  col('empresa', 'Empresa', 'texto', { so_multiempresa: true }),
  col('pagante', 'Pagante', 'texto', { padrao: true }),
  col('pagante_documento', 'CNPJ do pagante', 'texto', { padrao: true }),
  col('fornecedor', 'Fornecedor', 'texto', { padrao: true }),
  col('tipo', 'Tipo de produto', 'texto'),
  col('cia', 'Companhia aérea', 'texto', { padrao: true }),
  col('localizador', 'Localizador', 'texto', { padrao: true }),
  col('bilhete', 'Bilhete ou documento', 'texto', { padrao: true }),
  col('passageiro', 'Passageiro', 'texto', { padrao: true }),
  col('trechos', 'Trechos', 'texto', { padrao: true }),
  col('destino', 'Destino', 'texto'),
  col('data_inicio', 'Saída', 'data', { padrao: true }),
  col('data_fim', 'Retorno', 'data', { padrao: true }),
  col('moeda', 'Moeda de origem', 'texto'),
  col('tarifa', 'Tarifa', 'dinheiro', { padrao: true }),
  col('taxa_embarque', 'Taxa de embarque', 'dinheiro', { padrao: true }),
  col('outras_taxas', 'Outras taxas', 'dinheiro', { padrao: true }),
  col('taxa_du', 'Taxa DU', 'dinheiro', { sensivel: true, padrao: true }),
  col('rav', 'RAV', 'dinheiro', { sensivel: true, padrao: true }),
  col('fee', 'Fee', 'dinheiro', { sensivel: true, padrao: true }),
  col('desconto', 'Desconto', 'dinheiro', { sensivel: true, padrao: true }),
  col('valor_bilhete', 'Valor do bilhete', 'dinheiro', { padrao: true }),
  col('valor_transacao', 'Valor da transação', 'dinheiro', { padrao: true }),
  col('forma', 'Como foi pago', 'texto'),
  col('bandeira', 'Bandeira', 'texto', { padrao: true }),
  col('final_cartao', 'Final do cartão', 'texto', { padrao: true }),
  col('autorizacao', 'Autorização', 'texto', { padrao: true }),
  col('parcelas', 'Parcelas', 'numero'),
  col('requisicao', 'Requisição', 'texto', { padrao: true }),
  col('cc_cliente', 'Centro de custo do cliente', 'texto', { padrao: true }),
  col('matricula', 'Matrícula', 'texto', { padrao: true }),
  col('solicitante', 'Solicitante', 'texto', { padrao: true }),
  col('aprovador', 'Aprovador', 'texto', { padrao: true }),
  col('projeto', 'Projeto', 'texto'),
  col('motivo', 'Motivo da viagem', 'texto'),
  col('vendedor', 'Vendedor', 'texto'),
  col('pendencias', 'O que falta', 'texto', { padrao: true }),
];

/** Divide `total` pelos pesos, centavo por centavo (maiores restos). Peso zero em tudo: partes iguais. */
export function dividirPelosPesos(total: Centavos, pesos: readonly number[]): Centavos[] {
  if (!pesos.length) return [];
  const usar = pesos.some(p => p > 0) ? pesos.map(p => Math.max(0, p)) : pesos.map(() => 1);
  const soma = usar.reduce((a, p) => a + p, 0);
  const brutas = usar.map(p => (total * p) / soma);
  const partes = brutas.map(b => Math.floor(b));
  let falta = total - partes.reduce((a, p) => a + p, 0);
  const ordem = brutas.map((b, i) => ({ i, resto: b - Math.floor(b) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let k = 0; falta > 0 && ordem.length; k = (k + 1) % ordem.length, falta--) partes[ordem[k].i] += 1;
  return partes;
}

interface BilheteDoCartao {
  produto: ProdutoDaVenda;
  passageiro: string;
  bilhete: string;
  cc: string;
  matricula: string;
  tarifa: Centavos;
  embarque: Centavos;
  outras: Centavos;
  du: Centavos;
  rav: Centavos;
  fee: Centavos;
  desconto: Centavos;
  /** O que o cliente paga por este bilhete, em centavos de real. */
  valor: Centavos;
}

/** Os bilhetes de um produto ativo, com o que cada um custa ao cliente (em reais). */
function bilhetesDoProduto(p: ProdutoDaVenda): BilheteDoCartao[] {
  if (p.cancelado_em) return [];
  const t = totaisDoProduto(p);
  const r = (c: Centavos) => emReais(c, p.moeda, p.cambio);
  const ativos = p.passageiros.filter(x => !x.cancelado_em);
  const SOMA = ['TAXA_DU', 'RAV', 'FEE', 'MARKUP', 'COBRADO_NO_CANCELAMENTO'] as const;
  const TIRA = ['DESCONTO', 'ABATIMENTO'] as const;
  if (!ativos.length) {
    if (p.passageiros.length) return [];
    const c = t.componentes;
    return [{
      produto: p, passageiro: '', bilhete: '', cc: '', matricula: '',
      tarifa: r(t.tarifa), embarque: r(p.taxas_centavos), outras: 0,
      du: r(c.TAXA_DU), rav: r(c.RAV), fee: r(c.FEE), desconto: r(c.DESCONTO + c.ABATIMENTO), valor: t.brl.valor_cliente,
    }];
  }
  // Componente de um passageiro fica com ele; o do produto se divide pela tarifa.
  const pesos = ativos.map(x => x.tarifa_centavos);
  const porPax = ativos.map(() => ({ TAXA_DU: 0, RAV: 0, FEE: 0, MARKUP: 0, COBRADO_NO_CANCELAMENTO: 0, DESCONTO: 0, ABATIMENTO: 0 } as Record<string, number>));
  for (const k of [...SOMA, ...TIRA]) {
    const doProduto = p.componentes.filter(c => c.tipo === k && !c.passageiro_id).reduce((a, c) => a + c.valor_centavos, 0);
    const partes = dividirPelosPesos(doProduto, pesos);
    ativos.forEach((x, i) => {
      porPax[i][k] += partes[i] + p.componentes.filter(c => c.tipo === k && c.passageiro_id === x.id).reduce((a, c) => a + c.valor_centavos, 0);
    });
  }
  return ativos.map((x, i) => {
    const c = porPax[i];
    const naMoeda = x.tarifa_centavos + x.taxas_centavos + x.outras_taxas_centavos
      + SOMA.reduce((a, k) => a + c[k], 0) - TIRA.reduce((a, k) => a + c[k], 0);
    return {
      produto: p, passageiro: x.nome, bilhete: x.documento, cc: x.corporativo?.centro_custo ?? '', matricula: x.corporativo?.matricula ?? '',
      tarifa: r(x.tarifa_centavos), embarque: r(x.taxas_centavos), outras: r(x.outras_taxas_centavos),
      du: r(c.TAXA_DU), rav: r(c.RAV), fee: r(c.FEE), desconto: r(c.DESCONTO + c.ABATIMENTO), valor: r(naMoeda),
    };
  });
}

/** O produto foi comprado deste fornecedor (ou por este representante)? */
function produtoDoFornecedor(p: ProdutoDaVenda, f: PagamentoDaVenda['fornecedor']): boolean {
  if (!f) return true;
  const k = chaveDaParte(f);
  return chaveDaParte(p.fornecedor) === k || chaveDaParte(p.representante) === k;
}

/**
 * Uma linha por bilhete pago com o cartão corporativo do cliente. O valor de
 * cada pagamento no cartão se divide pelos bilhetes da venda na proporção do
 * que cada um custa ao cliente (centavo por centavo: a soma das linhas é o
 * valor do pagamento). Pago direto no fornecedor: só os produtos dele.
 */
export function linhasDoCartaoCorporativo(vendas: VendaLida[], empresas?: NomesDeEmpresa): LinhaDoRelatorio[] {
  const linhas: LinhaDoRelatorio[] = [];
  for (const lida of vendas) {
    const v = lida.venda;
    const corp = v.corporativo ?? {};
    const todos = v.produtos.flatMap(bilhetesDoProduto);
    for (const pg of lida.pagamentos.filter(pagoComCartaoCorporativo)) {
      const doPagamento = pg.forma === 'PAGO_DIRETO_FORNECEDOR' ? todos.filter(b => produtoDoFornecedor(b.produto, pg.fornecedor)) : todos;
      const bilhetes = doPagamento.length ? doPagamento : todos;
      const partes = dividirPelosPesos(pg.valor_centavos, bilhetes.map(b => b.valor));
      const campos = pg.campos ?? {};
      const pagante = pg.pagante ?? v.cliente;
      bilhetes.forEach((b, i) => {
        const p = b.produto;
        const aereo = p.tipo === 'AEREO' || p.tipo === 'AEREO_AGENCIA';
        const cc = b.cc || corp.centro_custo || '';
        const falta: string[] = [];
        if (aereo && !p.localizador) falta.push('localizador');
        if (aereo && b.passageiro && !b.bilhete) falta.push('bilhete');
        if (!campos.final_cartao) falta.push('final do cartão');
        if (!campos.autorizacao) falta.push('autorização');
        if (!cc) falta.push('centro de custo');
        linhas.push({
          venda_id: v.id, venda_numero: v.numero, data_venda: v.data_venda,
          empresa_id: lida.empresa_id || 'principal', empresa: nomeDaEmpresa(lida.empresa_id, empresas),
          pagante: SEM(pagante?.nome ?? '', 'Sem pagante'), pagante_documento: pagante?.documento ?? '',
          fornecedor: SEM(p.representante?.nome || p.fornecedor?.nome || '', 'Sem fornecedor'),
          tipo: ROTULO_TIPO_PRODUTO[p.tipo], cia: p.detalhes?.cia ?? '', localizador: p.localizador, bilhete: b.bilhete,
          passageiro: b.passageiro || p.descricao, trechos: p.detalhes?.trechos ?? '', destino: p.detalhes?.destino ?? '',
          data_inicio: p.data_inicio, data_fim: p.data_fim, moeda: p.moeda,
          tarifa: b.tarifa, taxa_embarque: b.embarque, outras_taxas: b.outras, taxa_du: b.du, rav: b.rav, fee: b.fee, desconto: b.desconto,
          valor_bilhete: b.valor, valor_transacao: partes[i],
          forma: pg.forma === 'PAGO_DIRETO_FORNECEDOR' ? 'Direto no fornecedor' : 'Recebido pela agência',
          bandeira: campos.bandeira ?? '', final_cartao: campos.final_cartao ?? '', autorizacao: campos.autorizacao ?? '', parcelas: pg.parcelas,
          requisicao: campos.requisicao || corp.requisicao || '', cc_cliente: cc, matricula: b.matricula || corp.matricula || '',
          solicitante: corp.solicitante ?? '', aprovador: corp.aprovador ?? '', projeto: corp.projeto ?? '', motivo: corp.motivo ?? '',
          vendedor: SEM(v.vendedor?.nome ?? '', 'Sem vendedor'), vendedor_chave: chaveDaParte(v.vendedor),
          fornecedor_chave: chaveDaParte(p.fornecedor), tipo_codigo: p.tipo, unidade: SEM(v.centro_custo, 'Sem unidade'),
          situacao_produto: 'Ativo', descricao: p.descricao,
          pendencias: falta.length ? `Falta ${falta.join(', ')}` : 'Pronto',
        });
      });
    }
  }
  return linhas;
}
