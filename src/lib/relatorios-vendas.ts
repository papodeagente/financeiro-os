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
 * Colunas "sensíveis" (o ganho da agência: componentes, custo do fornecedor,
 * repasse, receita) só saem para quem tem o direito de ver comissão e receita
 * (`ver_colunas_comissao`); quem não tem nem recebe o número.
 */
import {
  COMPONENTES, FORMAS, ROTULO_TIPO_PRODUTO, TIPOS_COMPONENTE, totaisDoProduto,
  type Centavos, type FormaDaVenda,
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
}

export type ValorDaCelula = string | number | null;
export type LinhaDoRelatorio = Record<string, ValorDaCelula> & { venda_id?: string };

export const RELATORIOS = ['produto', 'vendedor', 'unidade', 'forma', 'clientes', 'dinamica'] as const;
export type TipoDeRelatorio = (typeof RELATORIOS)[number];

export const ROTULO_RELATORIO: Record<TipoDeRelatorio, string> = {
  produto: 'Vendas por produto',
  vendedor: 'Vendas por vendedor',
  unidade: 'Vendas por unidade',
  forma: 'Vendas por forma de pagamento',
  clientes: 'Ranking de clientes',
  dinamica: 'Tabela dinâmica de vendas',
};

const col = (id: string, rotulo: string, tipo: TipoDaColuna, o: Partial<ColunaDoRelatorio> = {}): ColunaDoRelatorio => ({ id, rotulo, tipo, ...o });
const colunasDeComponente = (): ColunaDoRelatorio[] =>
  TIPOS_COMPONENTE.map(t => col(`comp_${t}`, COMPONENTES[t].rotulo, 'dinheiro', { sensivel: true, padrao: t === 'COMISSAO' || t === 'TAXA_DU' || t === 'RAV' || t === 'FEE' }));

/** Colunas de Vendas por produto (uma linha por produto vendido). */
export const COLUNAS_POR_PRODUTO: ColunaDoRelatorio[] = [
  col('venda_numero', 'Venda', 'texto', { padrao: true }),
  col('data_venda', 'Data da venda', 'data', { padrao: true }),
  col('situacao', 'Situação', 'texto'),
  col('cliente', 'Cliente', 'texto', { padrao: true }),
  col('vendedor', 'Vendedor', 'texto', { padrao: true }),
  col('intermediario', 'Intermediário', 'texto'),
  col('unidade', 'Unidade', 'texto'),
  col('tipo', 'Tipo de produto', 'texto', { padrao: true }),
  col('descricao', 'Produto', 'texto', { padrao: true }),
  col('fornecedor', 'Fornecedor', 'texto', { padrao: true }),
  col('representante', 'Representante', 'texto'),
  col('quem_cobra', 'Quem cobra', 'texto'),
  col('localizador', 'Localizador', 'texto'),
  col('data_inicio', 'Início', 'data'),
  col('data_fim', 'Fim', 'data'),
  col('moeda', 'Moeda', 'texto'),
  col('cambio', 'Câmbio', 'numero'),
  col('passageiros', 'Passageiros', 'numero'),
  col('tarifa', 'Tarifa', 'dinheiro'),
  col('taxas', 'Taxas', 'dinheiro'),
  ...colunasDeComponente(),
  col('faturamento', 'Faturamento', 'dinheiro', { padrao: true }),
  col('valor_fornecedor', 'Custo do fornecedor', 'dinheiro', { sensivel: true }),
  col('repasse', 'Repasse ao intermediário', 'dinheiro', { sensivel: true }),
  col('receita', 'Receita da agência', 'dinheiro', { sensivel: true, padrao: true }),
  col('percentual_receita', '% de receita', 'percentual', { sensivel: true, padrao: true }),
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

/** Uma linha por produto, com a receita aberta por componente. */
export function linhasPorProduto(vendas: VendaLida[], cfg: ConfigReceita = CONFIG_RECEITA_PADRAO): LinhaDoRelatorio[] {
  const linhas: LinhaDoRelatorio[] = [];
  for (const lida of vendas) {
    const v = lida.venda;
    const rec = receitaDaVenda(v, cfg);
    for (const p of v.produtos) {
      const t = totaisDoProduto(p);
      const receita = rec.por_produto.find(x => x.produto_id === p.id)?.receita ?? 0;
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
      };
      for (const c of TIPOS_COMPONENTE) linha[`comp_${c}`] = t.brl.componentes[c];
      linhas.push(linha);
    }
  }
  return linhas;
}

// ============================================================
// Agrupados: vendedor, unidade, cliente
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

const porFaturamento = (a: LinhaDoRelatorio, b: LinhaDoRelatorio) => Number(b.faturamento) - Number(a.faturamento) || String(a.grupo).localeCompare(String(b.grupo), 'pt-BR');

export function linhasPorVendedor(produtos: LinhaDoRelatorio[]): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.vendedor)).sort(porFaturamento);
}

export function linhasPorUnidade(produtos: LinhaDoRelatorio[]): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.unidade)).sort(porFaturamento);
}

/** Ranking de clientes: por faturamento, com a posição. */
export function rankingDeClientes(produtos: LinhaDoRelatorio[]): LinhaDoRelatorio[] {
  return agrupar(produtos, l => String(l.cliente)).sort(porFaturamento).map((l, i) => ({ ...l, posicao: i + 1 }));
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
// Tabela dinâmica
// ============================================================

export const CAMPOS_DA_DINAMICA = ['Mês', 'Vendedor', 'Tipo de produto', 'Fornecedor', 'Cliente', 'Unidade', 'Situação'] as const;

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
      'Mês': rotuloDoMesDaVenda(String(l.data_venda ?? '')), 'Vendedor': String(l.vendedor), 'Tipo de produto': String(l.tipo),
      'Fornecedor': String(l.fornecedor), 'Cliente': String(l.cliente), 'Unidade': String(l.unidade), 'Situação': String(l.situacao),
    },
    centavos: Math.round(Number(l[medida] ?? 0)),
    ref: { venda_id: String(l.venda_id), venda_numero: String(l.venda_numero) },
  }));
}

// ============================================================
// Direitos, colunas e exportação
// ============================================================

/** As colunas que a pessoa pode ver (e, se escolheu, só as escolhidas, na ordem do catálogo). */
export function colunasPermitidas(catalogo: ColunaDoRelatorio[], verReceita: boolean, escolhidas?: string[]): ColunaDoRelatorio[] {
  const podem = catalogo.filter(c => verReceita || !c.sensivel);
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

export function totaisDasLinhas(linhas: LinhaDoRelatorio[], colunas: ColunaDoRelatorio[]): LinhaDoRelatorio {
  const t: LinhaDoRelatorio = {};
  for (const c of colunas) {
    if (c.tipo === 'dinheiro' || (c.tipo === 'numero' && c.id !== 'cambio' && c.id !== 'posicao')) t[c.id] = linhas.reduce((a, l) => a + Number(l[c.id] ?? 0), 0);
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

