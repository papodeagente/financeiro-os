/**
 * DRE da agência — conta pura, sem React e sem
 * banco (05/11/2026).
 *
 * Até aqui a conta morava dentro da tela /financeiro-ag/dre. Ela saiu para cá
 * SEM mudar uma linha da regra: no regime de competência o resultado é
 * exatamente o de antes (mesmas linhas, mesmos nomes, mesmos valores), e o
 * teste scripts/test-demonstrativo-resultado.ts congela isso.
 *
 * Três acréscimos (05/11/2026):
 *  1. Regime de CAIXA, pela data da baixa:
 *     - receitas próprias (comissão de fornecedor, fee, outras) pelo valor
 *       recebido (valorMovimentado) no mês do recebimento;
 *     - a margem de cada venda entra na proporção do que o cliente pagou no
 *       mês (recebido das contas da venda ÷ valor da venda × margem). Venda
 *       paga em duas vezes reconhece a margem em dois meses;
 *     - comissão não capturada pela margem entra proporcional ao recebido;
 *     - despesas pelas contas a pagar pagas no mês, nos mesmos grupos de
 *       categoria, e o repasse da venda continua fora;
 *     - taxa da plataforma pela taxa já retida das contas recebidas no mês.
 *     Limite conhecido: a baixa parcial guarda o ACUMULADO e a data da última
 *     baixa, então duas parciais em meses diferentes caem no mês da última.
 *  2. Cada linha leva os lançamentos que a formam (clique no número).
 *  3. Orçado: as metas do plano do mês (planejamento) casadas por linha.
 */
import type { ContaPagar, ContaReceber, PlanoContas, VendaCRM } from './crm-types';
import { divSegura, mesDe, num, round2, soma, somaPor } from './money';
import { valorMovimentado } from './saldo-bancario';
import { taxaRealizada } from './taxa-plataforma';
import {
  ajusteDoValor, CATEGORIAS_PADRAO_ENCARGOS, classificarEncargos,
  type ChaveEncargo, type EncargosDoTitulo, type RotulosEncargos,
} from './encargos-categorias';

export type RegimeDRE = 'competencia' | 'caixa';

export type TipoLinhaDRE = 'header' | 'item' | 'subtotal' | 'total';

/** Um lançamento que forma o número de uma linha. Valor sempre positivo. */
export interface LancamentoDRE {
  tabela: 'contas_receber' | 'contas_pagar' | 'vendas_crm';
  id: string;
  descricao: string;
  pessoa: string;
  data: string;
  valor: number;
}

export interface LinhaDRE {
  codigo: string;
  nome: string;
  valor: number;
  tipo: TipoLinhaDRE;
  indent: number;
  /** Só linhas de grupo e de conta: subtotais e margens não têm lançamento próprio. */
  lancamentos?: LancamentoDRE[];
}

const PCT = (v: number) => `${v.toFixed(1)}%`;

type VendaDRE = Pick<VendaCRM, 'id' | 'status' | 'valor_final' | 'valor_total_custo' | 'data_venda'> & { numero?: string };

/**
 * Quanto de cada conta de comissão AINDA NÃO está representado na margem da
 * sua venda. A margem de cada venda é consumida pelas suas comissões na ordem
 * de vencimento; o que sobrar é receita própria a reconhecer. Cópia fiel do
 * que a tela fazia.
 */
export function comissaoNaoCapturadaPorConta(
  receber: readonly ContaReceber[],
  vendasComLastro: readonly VendaDRE[],
): Map<string, number> {
  const restante = new Map<string, number>();
  for (const v of vendasComLastro) {
    if (v.status === 'CANCELADO') continue;
    restante.set(v.id, Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0));
  }
  const fora = new Map<string, number>();
  const comissoes = receber
    .filter(cr => cr.origem === 'COMISSAO_FORNECEDOR')
    .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)));
  for (const cr of comissoes) {
    const vendaId = cr.origem_venda_id || cr.venda_id || '';
    const valor = round2(num(cr.valor_final));
    const margem = vendaId ? (restante.get(vendaId) ?? 0) : 0;
    const capturado = Math.min(margem, valor);
    if (vendaId && restante.has(vendaId)) restante.set(vendaId, round2(margem - capturado));
    fora.set(cr.id, round2(valor - capturado));
  }
  return fora;
}

export interface EntradaDRE {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  /** Vendas que têm pelo menos um lançamento (apenasVendasComLastro). */
  vendasComLastro: readonly VendaDRE[];
  planoContas: readonly PlanoContas[];
  comissaoNaoCapturada: Map<string, number>;
  /** 'YYYY-MM'. */
  mes: string;
  regime?: RegimeDRE;
  /**
   * Juros, multa, desconto e taxa registrados na liquidação, por título
   * (chave `${tabela}:${id}`, ver encargos-categorias.ts). Ausente ou vazio =
   * o DRE de antes, número por número.
   */
  encargos?: ReadonlyMap<string, EncargosDoTitulo>;
  /** Nome e código das linhas dos encargos (categorias escolhidas). */
  rotulosEncargos?: RotulosEncargos;
  /**
   * Variação cambial das liquidações (05/11/2026, E6), por título (chave
   * `${tabela}:${id}`): quanto a liquidação somou ao valor em reais. Sai da
   * linha de origem e vai para a linha "Variação cambial". Ausente ou vazio =
   * o DRE de antes, número por número.
   */
  variacoes?: ReadonlyMap<string, number>;
}

/** Um componente da conta: o valor e os lançamentos que o formam. */
interface Parte {
  valor: number;
  lancamentos: LancamentoDRE[];
}

function parte(itens: Array<{ l: LancamentoDRE }>): Parte {
  const lancamentos = itens.map(i => i.l).filter(l => l.valor !== 0);
  return { valor: somaPor(itens, i => i.l.valor), lancamentos };
}

function deCR(cr: ContaReceber, valor: number, data: string): { l: LancamentoDRE } {
  return { l: { tabela: 'contas_receber', id: cr.id, descricao: String(cr.descricao ?? ''), pessoa: String(cr.cliente_nome ?? ''), data, valor } };
}

function deCP(cp: ContaPagar, valor: number, data: string): { l: LancamentoDRE } {
  return { l: { tabela: 'contas_pagar', id: cp.id, descricao: String(cp.descricao ?? ''), pessoa: String(cp.fornecedor_nome ?? ''), data, valor } };
}

function deVenda(v: VendaDRE, valor: number, data: string): { l: LancamentoDRE } {
  return { l: { tabela: 'vendas_crm', id: v.id, descricao: v.numero ? `Venda ${v.numero}` : 'Venda', pessoa: '', data, valor } };
}

const juntar = (...partes: Parte[]): LancamentoDRE[] => partes.flatMap(p => p.lancamentos);

/** Repasse ao fornecedor: CP auto-gerada da venda. Não é despesa da agência. */
const ehRepasseDeVenda = (cp: ContaPagar) => !!cp.auto_gerado && cp.origem === 'VENDA';
const vivo = (s: string | undefined) => String(s ?? '') !== 'CANCELADO';

/**
 * DRE para agência de viagens, CNAE 7911-2/00, regime de intermediação: a
 * receita é a comissão; o que vai ao fornecedor é repasse (CMV = 0).
 */
export function montarDRE(e: EntradaDRE): LinhaDRE[] {
  const { mes: month, planoContas, comissaoNaoCapturada } = e;
  if (!month) return [];
  const regime: RegimeDRE = e.regime ?? 'competencia';

  const idsDoPrefixo = (prefixo: string) =>
    planoContas.filter(p => p.codigo?.startsWith(prefixo)).map(p => p.id);

  // ── O que entra no mês, pelo regime ───────────────────────────────────────
  // Competência: tudo que não foi cancelado, pelo vencimento (inclusive
  // ATRASADO e PARCIAL), pelo valor da conta. Caixa: o que se moveu, pela data
  // da baixa, pelo valor movimentado.
  const dataCR = (cr: ContaReceber) => (regime === 'caixa' ? String(cr.data_recebimento ?? '') : String(cr.data_vencimento ?? ''));
  const dataCP = (cp: ContaPagar) => (regime === 'caixa' ? String(cp.data_pagamento ?? '') : String(cp.data_vencimento ?? ''));
  const valorCR = (cr: ContaReceber) => (regime === 'caixa' ? valorMovimentado(cr, 'valor_recebido') : num(cr.valor_final));
  const valorCP = (cp: ContaPagar) => (regime === 'caixa' ? valorMovimentado(cp, 'valor_pago') : num(cp.valor_final));

  // Encargos da liquidação (05/11/2026): saem da linha de origem da conta e
  // vão para linhas próprias. Sem encargo, o ajuste é zero e o valor é o
  // mesmo número de antes (sem nem passar por round2).
  const encDe = (tabela: 'contas_receber' | 'contas_pagar', id: string) => e.encargos?.get(`${tabela}:${id}`);
  const semEncargos = (v: number, aj: number) => (aj === 0 ? v : round2(v - aj));
  // A variação cambial também sai da linha de origem (vai para a linha dela).
  const varDe = (tabela: 'contas_receber' | 'contas_pagar', id: string) => e.variacoes?.get(`${tabela}:${id}`) ?? 0;
  const comVariacao = (aj: number, v: number) => (v === 0 ? aj : round2(aj + v));
  const ajusteCR = (cr: ContaReceber) => comVariacao(ajusteDoValor(encDe('contas_receber', cr.id)), varDe('contas_receber', cr.id));
  const ajusteCP = (cp: ContaPagar) => comVariacao(ajusteDoValor(encDe('contas_pagar', cp.id)), varDe('contas_pagar', cp.id));
  const valorCRBase = (cr: ContaReceber) => semEncargos(valorCR(cr), ajusteCR(cr));
  const valorCPBase = (cp: ContaPagar) => semEncargos(valorCP(cp), ajusteCP(cp));

  const monthReceber = e.receber.filter(cr =>
    mesDe(dataCR(cr)) === month && vivo(cr.status) && (regime === 'competencia' || valorCR(cr) > 0),
  );
  const monthPagar = e.pagar.filter(cp =>
    mesDe(dataCP(cp)) === month && vivo(cp.status) && (regime === 'competencia' || valorCP(cp) > 0),
  );

  // ── Volume e margem das vendas ────────────────────────────────────────────
  let volume: Parte;
  let comissaoVendas: Parte;
  if (regime === 'competencia') {
    const monthVendas = e.vendasComLastro.filter(v => mesDe(v.data_venda) === month && v.status !== 'CANCELADO');
    volume = parte(monthVendas.map(v => deVenda(v, num(v.valor_final), v.data_venda)));
    comissaoVendas = parte(monthVendas.map(v =>
      deVenda(v, Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0), v.data_venda)));
  } else {
    // Caixa: o que o cliente pagou no mês pelas contas da venda (origem
    // VENDA; origem ausente conta como VENDA) e a margem na mesma proporção.
    const recebidoPorVenda = new Map<string, number>();
    for (const cr of monthReceber) {
      // Fatura do cliente (E5, parte B): o recebido se divide entre as vendas
      // da fatura, na proporção de cada uma (os itens ficam dentro dela).
      const daFatura = (cr as unknown as { origem?: string; fatura_vendas?: Array<{ venda_id?: string; valor?: number }> });
      if (daFatura.origem === 'FATURA' && Array.isArray(daFatura.fatura_vendas) && daFatura.fatura_vendas.length) {
        const pesos = daFatura.fatura_vendas.map(v => Math.max(0, num(v.valor)));
        const totalPesos = pesos.reduce((a, b) => a + b, 0);
        if (totalPesos > 0) {
          const recebido = valorCRBase(cr);
          daFatura.fatura_vendas.forEach((v, i) => {
            const id = String(v.venda_id ?? '').trim();
            if (id) recebidoPorVenda.set(id, round2((recebidoPorVenda.get(id) ?? 0) + recebido * pesos[i] / totalPesos));
          });
        }
        continue;
      }
      if ((cr.origem ?? 'VENDA') !== 'VENDA') continue;
      const vendaId = String(cr.origem_venda_id || cr.venda_id || '').trim();
      if (!vendaId) continue;
      recebidoPorVenda.set(vendaId, round2((recebidoPorVenda.get(vendaId) ?? 0) + valorCRBase(cr)));
    }
    const vendasPagas = e.vendasComLastro.filter(v => v.status !== 'CANCELADO' && (recebidoPorVenda.get(v.id) ?? 0) > 0);
    volume = parte(vendasPagas.map(v => deVenda(v, recebidoPorVenda.get(v.id) ?? 0, month)));
    comissaoVendas = parte(vendasPagas.map(v => {
      const margem = Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0);
      const fracao = Math.min(1, divSegura(recebidoPorVenda.get(v.id) ?? 0, num(v.valor_final)));
      return deVenda(v, round2(margem * fracao), month);
    }));
  }

  // FONTE ÚNICA, por DEDUÇÃO: a comissão de uma venda entra na receita bruta
  // uma vez só. Quando a margem já a contém, a CR espelho não soma de novo.
  const receitaComissoes = parte(monthReceber.filter(cr => cr.origem === 'COMISSAO_FORNECEDOR').map(cr => {
    const naoCapturada = round2(num(comissaoNaoCapturada.get(cr.id) ?? num(cr.valor_final)));
    const valor = regime === 'caixa'
      ? round2(naoCapturada * Math.min(1, divSegura(valorCR(cr), num(cr.valor_final))))
      : naoCapturada;
    const aj = ajusteCR(cr);
    return deCR(cr, aj === 0 ? valor : Math.max(0, round2(valor - aj)), dataCR(cr));
  }));
  const receitaFee = parte(monthReceber.filter(cr => cr.origem === 'FEE').map(cr => deCR(cr, valorCRBase(cr), dataCR(cr))));
  const receitaOutras = parte(monthReceber.filter(cr => cr.origem === 'OUTROS').map(cr => deCR(cr, valorCRBase(cr), dataCR(cr))));

  const receitaBruta = soma([comissaoVendas.valor, receitaComissoes.valor, receitaFee.valor, receitaOutras.valor]);

  function porCategoria(prefix: string): Parte {
    const catIds = new Set(idsDoPrefixo(prefix));
    return parte(monthPagar.filter(cp => catIds.has(cp.categoria_id)).map(cp => deCP(cp, valorCPBase(cp), dataCP(cp))));
  }

  const despOperacionais = porCategoria('2.2');
  const despComerciais = porCategoria('2.6');
  const despTaxas = porCategoria('2.3');
  const despFinanceirasCat = porCategoria('2.4');
  // A taxa da plataforma é despesa financeira retida da conta a receber, fora
  // de qualquer conta a pagar. Competência: conta viva do mês, baixada ou não.
  // Caixa: a taxa já retida das contas recebidas no mês.
  // A taxa registrada na liquidação nova sai daqui e vai para a linha de
  // taxas (encargos); a taxa de antes continua nesta linha.
  const taxaDaPlataforma = (cr: ContaReceber) => {
    const t = regime === 'caixa' ? taxaRealizada(cr) : Math.max(0, num(cr.taxa));
    const daBaixa = encDe('contas_receber', cr.id)?.taxa ?? 0;
    return daBaixa > 0 ? Math.max(0, round2(t - daBaixa)) : t;
  };
  const taxasDePlataforma = parte(monthReceber.map(cr => deCR(cr, taxaDaPlataforma(cr), dataCR(cr))));

  // ── Encargos da liquidação, por linha ─────────────────────────────────────
  // Seguem a conta: entram no mês em que a conta entra (vencimento na
  // competência, baixa no caixa). Repasse de venda também: o juro pago ao
  // fornecedor por atraso é despesa da agência.
  const porChave: Record<ChaveEncargo, Array<{ l: LancamentoDRE }>> = {
    receita_financeira: [], despesa_financeira: [], descontos_concedidos: [], taxas: [],
  };
  if (e.encargos && e.encargos.size > 0) {
    for (const cr of monthReceber) {
      const c = classificarEncargos('contas_receber', encDe('contas_receber', cr.id));
      for (const k of Object.keys(c) as ChaveEncargo[]) if (c[k] > 0) porChave[k].push(deCR(cr, c[k], dataCR(cr)));
    }
    for (const cp of monthPagar) {
      const c = classificarEncargos('contas_pagar', encDe('contas_pagar', cp.id));
      for (const k of Object.keys(c) as ChaveEncargo[]) if (c[k] > 0) porChave[k].push(deCP(cp, c[k], dataCP(cp)));
    }
  }
  const enc = {
    receita_financeira: parte(porChave.receita_financeira),
    despesa_financeira: parte(porChave.despesa_financeira),
    descontos_concedidos: parte(porChave.descontos_concedidos),
    taxas: parte(porChave.taxas),
  };
  const despEncargos = soma([enc.despesa_financeira.valor, enc.descontos_concedidos.valor, enc.taxas.valor]);
  const receitaFinanceira = enc.receita_financeira.valor;
  const rotulo = (k: ChaveEncargo) => e.rotulosEncargos?.[k] ?? { codigo: CATEGORIAS_PADRAO_ENCARGOS[k].codigo, nome: CATEGORIAS_PADRAO_ENCARGOS[k].nome };
  const linhaEncargo = (k: ChaveEncargo): LinhaDRE[] => (enc[k].valor > 0
    ? [{ codigo: rotulo(k).codigo, nome: rotulo(k).nome, valor: enc[k].valor, tipo: 'item', indent: 1, lancamentos: enc[k].lancamentos }]
    : []);

  // ── Variação cambial (linha própria; + ganho, − perda) ─────────────────────
  // Segue a conta, como os encargos. Receber: câmbio que subiu é ganho.
  // Pagar: câmbio que subiu é perda.
  const variacaoItens: Array<{ l: LancamentoDRE }> = [];
  if (e.variacoes && e.variacoes.size > 0) {
    for (const cr of monthReceber) {
      const v = varDe('contas_receber', cr.id);
      if (v !== 0) variacaoItens.push(deCR(cr, v, dataCR(cr)));
    }
    for (const cp of monthPagar) {
      const v = varDe('contas_pagar', cp.id);
      if (v !== 0) variacaoItens.push(deCP(cp, round2(-v), dataCP(cp)));
    }
  }
  const variacaoCambial = parte(variacaoItens);

  const despFinanceiras = despEncargos > 0
    ? round2(despFinanceirasCat.valor + taxasDePlataforma.valor + despEncargos)
    : round2(despFinanceirasCat.valor + taxasDePlataforma.valor);
  const despOutras = porCategoria('2.5');

  // 2.1 sem o repasse auto-gerado da venda é despesa real.
  const idsCMV = new Set(idsDoPrefixo('2.1'));
  const despCMV = parte(monthPagar.filter(cp => idsCMV.has(cp.categoria_id) && !ehRepasseDeVenda(cp)).map(cp => deCP(cp, valorCPBase(cp), dataCP(cp))));

  // Categoria fora de qualquer grupo da DRE (apagada, órfã ou vazia).
  const PREFIXOS_DRE = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6'];
  const idsConhecidos = new Set(PREFIXOS_DRE.flatMap(idsDoPrefixo));
  const uncategorized = parte(monthPagar.filter(cp => !idsConhecidos.has(cp.categoria_id) && !ehRepasseDeVenda(cp)).map(cp => deCP(cp, valorCPBase(cp), dataCP(cp))));

  const totalDespesas = soma([despOperacionais.valor, despComerciais.valor, despTaxas.valor, despFinanceiras, despOutras.valor, despCMV.valor, uncategorized.valor]);
  const outrasDespesas = soma([despOutras.valor, despCMV.valor, uncategorized.valor]);
  const receitaLiquida = round2(receitaBruta - despTaxas.valor);
  const resultadoOperacional = round2(receitaLiquida - despOperacionais.valor - despComerciais.valor);
  const lucroAntesDoCambio = receitaFinanceira > 0
    ? round2(receitaBruta + receitaFinanceira - totalDespesas)
    : round2(receitaBruta - totalDespesas);
  const lucroLiquido = variacaoCambial.valor === 0 ? lucroAntesDoCambio : round2(lucroAntesDoCambio + variacaoCambial.valor);
  const margemLiquida = round2(divSegura(lucroLiquido, receitaBruta) * 100);
  const margemSobreVolume = round2(divSegura(receitaBruta, volume.valor) * 100);

  const lines: LinhaDRE[] = [];

  if (volume.valor > 0) {
    lines.push({ codigo: '', nome: 'VOLUME INTERMEDIADO (informativo)', valor: volume.valor, tipo: 'header', indent: 0, lancamentos: volume.lancamentos });
    lines.push({ codigo: '0.1', nome: 'Total transacionado (passagens, hotéis, etc.)', valor: volume.valor, tipo: 'item', indent: 1, lancamentos: volume.lancamentos });
  }

  lines.push(
    { codigo: '', nome: 'RECEITA BRUTA (comissão + serviços)', valor: receitaBruta, tipo: 'header', indent: 0, lancamentos: juntar(comissaoVendas, receitaComissoes, receitaFee, receitaOutras) },
    { codigo: '1.1', nome: 'Comissão sobre vendas', valor: comissaoVendas.valor, tipo: 'item', indent: 1, lancamentos: comissaoVendas.lancamentos },
    { codigo: '1.2', nome: 'Comissões de fornecedores', valor: receitaComissoes.valor, tipo: 'item', indent: 1, lancamentos: receitaComissoes.lancamentos },
    { codigo: '1.3', nome: 'Fee de serviço', valor: receitaFee.valor, tipo: 'item', indent: 1, lancamentos: receitaFee.lancamentos },
    { codigo: '1.5', nome: 'Outras receitas', valor: receitaOutras.valor, tipo: 'item', indent: 1, lancamentos: receitaOutras.lancamentos },

    { codigo: '', nome: '(-) IMPOSTOS SOBRE A RECEITA', valor: -despTaxas.valor, tipo: 'header', indent: 0, lancamentos: despTaxas.lancamentos },
    { codigo: '2.3', nome: 'ISS, PIS, COFINS e outros', valor: despTaxas.valor, tipo: 'item', indent: 1, lancamentos: despTaxas.lancamentos },

    { codigo: '', nome: 'RECEITA LÍQUIDA', valor: receitaLiquida, tipo: 'subtotal', indent: 0 },

    { codigo: '', nome: '(-) DESPESAS OPERACIONAIS', valor: -(despOperacionais.valor + despComerciais.valor), tipo: 'header', indent: 0, lancamentos: juntar(despOperacionais, despComerciais) },
    { codigo: '2.2', nome: 'Despesas operacionais (aluguel, salários, etc.)', valor: despOperacionais.valor, tipo: 'item', indent: 1, lancamentos: despOperacionais.lancamentos },
    { codigo: '2.6', nome: 'Despesas comerciais (marketing, comissão vendedor)', valor: despComerciais.valor, tipo: 'item', indent: 1, lancamentos: despComerciais.lancamentos },

    { codigo: '', nome: 'RESULTADO OPERACIONAL', valor: resultadoOperacional, tipo: 'subtotal', indent: 0 },

    { codigo: '', nome: '(-) DESPESAS FINANCEIRAS', valor: -despFinanceiras, tipo: 'header', indent: 0, lancamentos: juntar(despFinanceirasCat, taxasDePlataforma, enc.despesa_financeira, enc.descontos_concedidos, enc.taxas) },
    { codigo: '2.4', nome: 'Juros, tarifas bancárias', valor: despEncargos > 0 ? despFinanceirasCat.valor : round2(despFinanceiras - taxasDePlataforma.valor), tipo: 'item', indent: 1, lancamentos: despFinanceirasCat.lancamentos },
    ...(taxasDePlataforma.valor > 0
      ? [{ codigo: '2.4', nome: 'Taxas de plataformas de pagamento', valor: taxasDePlataforma.valor, tipo: 'item' as const, indent: 1, lancamentos: taxasDePlataforma.lancamentos }]
      : []),
    ...linhaEncargo('despesa_financeira'),
    ...linhaEncargo('descontos_concedidos'),
    ...linhaEncargo('taxas'),
  );

  if (receitaFinanceira > 0) {
    lines.push(
      { codigo: '', nome: '(+) RECEITAS FINANCEIRAS', valor: receitaFinanceira, tipo: 'header', indent: 0, lancamentos: enc.receita_financeira.lancamentos },
      ...linhaEncargo('receita_financeira'),
    );
  }

  if (variacaoCambial.lancamentos.length > 0) {
    lines.push(
      { codigo: '', nome: '(+/-) VARIAÇÃO CAMBIAL', valor: variacaoCambial.valor, tipo: 'header', indent: 0, lancamentos: variacaoCambial.lancamentos },
      { codigo: '', nome: 'Variação cambial (ganhos e perdas na liquidação)', valor: variacaoCambial.valor, tipo: 'item', indent: 1, lancamentos: variacaoCambial.lancamentos },
    );
  }

  if (outrasDespesas !== 0) {
    lines.push({ codigo: '', nome: '(-) OUTRAS DESPESAS', valor: -outrasDespesas, tipo: 'header', indent: 0, lancamentos: juntar(despOutras, despCMV, uncategorized) });
    if (despOutras.valor !== 0) lines.push({ codigo: '2.5', nome: 'Outras despesas', valor: despOutras.valor, tipo: 'item', indent: 1, lancamentos: despOutras.lancamentos });
    if (despCMV.valor !== 0) lines.push({ codigo: '2.1', nome: 'Custos diretos (CMV)', valor: despCMV.valor, tipo: 'item', indent: 1, lancamentos: despCMV.lancamentos });
    if (uncategorized.valor !== 0) lines.push({ codigo: '', nome: 'Não categorizadas', valor: uncategorized.valor, tipo: 'item', indent: 1, lancamentos: uncategorized.lancamentos });
  }

  lines.push(
    { codigo: '', nome: 'LUCRO LÍQUIDO', valor: lucroLiquido, tipo: 'total', indent: 0 },
    { codigo: '', nome: `Margem líquida (sobre receita): ${PCT(margemLiquida)}`, valor: margemLiquida, tipo: 'item', indent: 0 },
    { codigo: '', nome: `Margem sobre volume intermediado: ${PCT(margemSobreVolume)}`, valor: margemSobreVolume, tipo: 'item', indent: 0 },
  );

  return lines;
}

/** 'YYYY-MM' do mês anterior. */
export function mesAnterior(ym: string): string {
  const [a, m] = String(ym).split('-').map(Number);
  if (!a || !m) return '';
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** O que o plano do mês prevê, nas mesmas grandezas do planejamento. */
export interface OrcamentoDoMes {
  receitaMeta: number;
  custoFixoTotal: number;
  marketingTotal: number;
  lucroProjetado: number;
}

/**
 * Orçado por linha, casado pelo NOME da linha da DRE (o mesmo casamento do
 * comparativo). Só as linhas que o plano mede têm orçado; as demais ficam de
 * fora, nunca zero inventado.
 */
export function orcadoPorLinha(o: OrcamentoDoMes | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!o) return m;
  m.set('RECEITA BRUTA (comissão + serviços)', round2(o.receitaMeta));
  m.set('(-) DESPESAS OPERACIONAIS', -round2(o.custoFixoTotal + o.marketingTotal));
  m.set('Despesas operacionais (aluguel, salários, etc.)', round2(o.custoFixoTotal));
  m.set('Despesas comerciais (marketing, comissão vendedor)', round2(o.marketingTotal));
  m.set('LUCRO LÍQUIDO', round2(o.lucroProjetado));
  return m;
}
