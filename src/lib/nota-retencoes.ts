/**
 * RETENÇÕES NA FONTE (Lei 9.430) por cliente × produto (E5, parte E).
 *
 * Órgão público e algumas empresas pagam a agência já retendo tributos
 * federais (IR, CSLL, PIS e COFINS) e recolhem eles mesmos à Receita. Para a
 * agência isso tem três efeitos, que o sistema mostra juntos:
 *  1. a nota fiscal declara o que foi retido;
 *  2. a fatura mostra o bruto, a retenção e o líquido;
 *  3. a conta a receber é LÍQUIDA: o cliente paga o valor menos a retenção.
 *
 * Cada cliente tem, por tipo de produto (ou para todos), os percentuais de
 * cada tributo sobre cada base: valor do produto, taxa de serviço (Fee), Taxa
 * DU e RAV, e taxas/embarque, separados em nacional e internacional. Os
 * percentuais vêm do contrato com o cliente ou do contador: o sistema não
 * sugere número nenhum.
 *
 * Arquivo puro (sem banco). Valores em centavos de real; percentuais com até
 * quatro casas.
 */

import {
  ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO, totaisDoProduto,
  type Centavos, type ParteDaVenda, type ProdutoDaVenda, type TipoProduto, type Venda,
} from './venda-modelo';

export const TRIBUTOS_RETIDOS = ['IR', 'CSLL', 'PIS', 'COFINS'] as const;
export type TributoRetido = (typeof TRIBUTOS_RETIDOS)[number];

export const BASES_DE_RETENCAO = ['VALOR', 'TAXA_SERVICO', 'DU_RAV', 'EMBARQUE'] as const;
export type BaseDeRetencao = (typeof BASES_DE_RETENCAO)[number];

export const ROTULO_BASE_DE_RETENCAO: Record<BaseDeRetencao, string> = {
  VALOR: 'Valor do produto',
  TAXA_SERVICO: 'Taxa de serviço (Fee)',
  DU_RAV: 'Taxa DU e RAV',
  EMBARQUE: 'Taxas e embarque',
};

export const AMBITOS = ['NACIONAL', 'INTERNACIONAL'] as const;
export type Ambito = (typeof AMBITOS)[number];
export const ROTULO_AMBITO: Record<Ambito, string> = { NACIONAL: 'Nacional', INTERNACIONAL: 'Internacional' };

export type Aliquotas = Record<TributoRetido, number>;
export type AliquotasPorBase = Record<BaseDeRetencao, Aliquotas>;

export interface RetencaoDoCliente {
  id: string;
  cliente: ParteDaVenda;
  /** null = vale para todos os produtos do cliente (a de produto vence). */
  tipo_produto: TipoProduto | null;
  /** O cliente também retém o ISS (vai para a nota). */
  reter_iss: boolean;
  nacional: AliquotasPorBase;
  internacional: AliquotasPorBase;
  observacao: string;
}

export function aliquotasZeradas(): Aliquotas {
  return { IR: 0, CSLL: 0, PIS: 0, COFINS: 0 };
}
export function aliquotasPorBaseZeradas(): AliquotasPorBase {
  return { VALOR: aliquotasZeradas(), TAXA_SERVICO: aliquotasZeradas(), DU_RAV: aliquotasZeradas(), EMBARQUE: aliquotasZeradas() };
}

export interface ErroDaRetencao { campo: string; mensagem: string }

function txt(v: unknown, max = 300): string {
  return v === null || v === undefined ? '' : String(v).trim().slice(0, max);
}

function lerPorBase(v: unknown, ambito: Ambito, erros: ErroDaRetencao[]): AliquotasPorBase {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const r = aliquotasPorBaseZeradas();
  for (const b of BASES_DE_RETENCAO) {
    const x = (o[b] && typeof o[b] === 'object' ? o[b] : {}) as Record<string, unknown>;
    for (const t of TRIBUTOS_RETIDOS) {
      const bruto = x[t];
      if (bruto === null || bruto === undefined || bruto === '') continue;
      const n = Number(typeof bruto === 'string' ? bruto.replace(',', '.') : bruto);
      if (!Number.isFinite(n)) {
        erros.push({ campo: `${ambito}.${b}.${t}`, mensagem: `${t} sobre ${ROTULO_BASE_DE_RETENCAO[b].toLowerCase()} (${ROTULO_AMBITO[ambito].toLowerCase()}) não é um número.` });
        continue;
      }
      if (n < 0) {
        erros.push({ campo: `${ambito}.${b}.${t}`, mensagem: `Percentual negativo não existe: ${t} sobre ${ROTULO_BASE_DE_RETENCAO[b].toLowerCase()} (${ROTULO_AMBITO[ambito].toLowerCase()}).` });
        continue;
      }
      if (n > 100) {
        erros.push({ campo: `${ambito}.${b}.${t}`, mensagem: `${t} acima de 100% sobre ${ROTULO_BASE_DE_RETENCAO[b].toLowerCase()} (${ROTULO_AMBITO[ambito].toLowerCase()}).` });
        continue;
      }
      r[b][t] = Math.round(n * 10000) / 10000;
    }
  }
  return r;
}

/** Lê a retenção da tela ou do banco. Devolve os erros que impedem gravar. */
export function normalizarRetencao(v: unknown): { retencao: RetencaoDoCliente; erros: ErroDaRetencao[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDaRetencao[] = [];
  const c = (o.cliente && typeof o.cliente === 'object' ? o.cliente : {}) as Record<string, unknown>;
  const cliente: ParteDaVenda = { id: txt(c.id, 200), nome: txt(c.nome, 200) };
  if (txt(c.documento, 40)) cliente.documento = txt(c.documento, 40);
  if (!cliente.id) erros.push({ campo: 'cliente', mensagem: 'Escolha o cliente que retém.' });
  const tipo = txt(o.tipo_produto).toUpperCase();
  const tipo_produto = (TIPOS_PRODUTO as readonly string[]).includes(tipo) ? (tipo as TipoProduto) : null;
  const retencao: RetencaoDoCliente = {
    id: txt(o.id, 80),
    cliente,
    tipo_produto,
    reter_iss: o.reter_iss === true,
    nacional: lerPorBase(o.nacional, 'NACIONAL', erros),
    internacional: lerPorBase(o.internacional, 'INTERNACIONAL', erros),
    observacao: txt(o.observacao, 500),
  };
  return { retencao, erros };
}

/** Rótulo curto da combinação (para listas e mensagens). */
export function rotuloDaRetencao(r: Pick<RetencaoDoCliente, 'cliente' | 'tipo_produto'>): string {
  return `${r.cliente.nome || 'Cliente'} · ${r.tipo_produto ? ROTULO_TIPO_PRODUTO[r.tipo_produto] : 'Todos os produtos'}`;
}

/** Soma dos percentuais (o "total" de uma base). */
export function totalDasAliquotas(a: Aliquotas): number {
  return Math.round(TRIBUTOS_RETIDOS.reduce((s, t) => s + a[t], 0) * 10000) / 10000;
}

/** A retenção vale para este cliente e produto? A de produto vence a de todos. */
export function retencaoAplicavel(regras: RetencaoDoCliente[], clienteId: string, tipo: TipoProduto): RetencaoDoCliente | null {
  if (!clienteId) return null;
  const doCliente = regras.filter(r => r.cliente.id === clienteId);
  return doCliente.find(r => r.tipo_produto === tipo) ?? doCliente.find(r => r.tipo_produto === null) ?? null;
}

/**
 * Nacional ou internacional. Vale o que a venda disser (detalhes.ambito, que
 * o CRM já manda por linha); sem isso, moeda estrangeira é internacional.
 */
export function ambitoDoProduto(p: Pick<ProdutoDaVenda, 'detalhes' | 'moeda'>): Ambito {
  const dito = String(p.detalhes?.ambito ?? '').trim().toLowerCase();
  if (dito.startsWith('inter')) return 'INTERNACIONAL';
  if (dito.startsWith('nac')) return 'NACIONAL';
  return p.moeda && p.moeda !== 'BRL' ? 'INTERNACIONAL' : 'NACIONAL';
}

/**
 * As quatro bases de um produto, em centavos de real:
 *  - Valor do produto = tarifa + Markup − Desconto (o preço do produto em si);
 *  - Taxa de serviço = Fee;
 *  - Taxa DU e RAV;
 *  - Taxas e embarque.
 */
export function basesDoProduto(p: ProdutoDaVenda): Record<BaseDeRetencao, Centavos> {
  const t = totaisDoProduto(p).brl;
  return {
    VALOR: Math.max(0, t.tarifa + t.componentes.MARKUP - t.componentes.DESCONTO),
    TAXA_SERVICO: t.componentes.FEE,
    DU_RAV: t.componentes.TAXA_DU + t.componentes.RAV,
    EMBARQUE: t.taxas,
  };
}

export interface LinhaDeRetencao {
  base: BaseDeRetencao;
  tributo: TributoRetido;
  base_centavos: Centavos;
  aliquota: number;
  valor_centavos: Centavos;
}

export interface RetencaoDoProduto {
  produto_id: string;
  descricao: string;
  ambito: Ambito;
  retencao_id: string;
  reter_iss: boolean;
  linhas: LinhaDeRetencao[];
  por_tributo: Record<TributoRetido, Centavos>;
  total: Centavos;
}

function porTributoZerado(): Record<TributoRetido, Centavos> {
  return { IR: 0, CSLL: 0, PIS: 0, COFINS: 0 };
}

/**
 * A retenção de um produto. `bases` limita às bases que interessam (a nota ao
 * pagante só declara a retenção das bases que ela cobra).
 */
export function retencaoDoProduto(p: ProdutoDaVenda, regra: RetencaoDoCliente, bases: readonly BaseDeRetencao[] = BASES_DE_RETENCAO): RetencaoDoProduto {
  const ambito = ambitoDoProduto(p);
  const aliq = ambito === 'NACIONAL' ? regra.nacional : regra.internacional;
  const valores = basesDoProduto(p);
  const linhas: LinhaDeRetencao[] = [];
  const por_tributo = porTributoZerado();
  for (const b of bases) {
    if (valores[b] <= 0) continue;
    for (const t of TRIBUTOS_RETIDOS) {
      const a = aliq[b][t];
      if (!(a > 0)) continue;
      const valor = Math.round(valores[b] * a / 100);
      if (valor <= 0) continue;
      linhas.push({ base: b, tributo: t, base_centavos: valores[b], aliquota: a, valor_centavos: valor });
      por_tributo[t] += valor;
    }
  }
  return {
    produto_id: p.id, descricao: p.descricao, ambito, retencao_id: regra.id, reter_iss: regra.reter_iss,
    linhas, por_tributo, total: TRIBUTOS_RETIDOS.reduce((s, t) => s + por_tributo[t], 0),
  };
}

export interface RetencoesDaVenda {
  cliente_id: string;
  por_produto: RetencaoDoProduto[];
  por_tributo: Record<TributoRetido, Centavos>;
  total: Centavos;
  reter_iss: boolean;
}

/** As retenções de uma venda inteira, pelo cliente dela. */
export function retencoesDaVenda(venda: Pick<Venda, 'cliente' | 'produtos'>, regras: RetencaoDoCliente[]): RetencoesDaVenda {
  const por_produto: RetencaoDoProduto[] = [];
  const por_tributo = porTributoZerado();
  let reter_iss = false;
  for (const p of venda.produtos) {
    const regra = retencaoAplicavel(regras, venda.cliente.id, p.tipo);
    if (!regra) continue;
    const r = retencaoDoProduto(p, regra);
    if (r.reter_iss) reter_iss = true;
    if (r.total <= 0 && !r.reter_iss) continue;
    por_produto.push(r);
    for (const t of TRIBUTOS_RETIDOS) por_tributo[t] += r.por_tributo[t];
  }
  return { cliente_id: venda.cliente.id, por_produto, por_tributo, total: TRIBUTOS_RETIDOS.reduce((s, t) => s + por_tributo[t], 0), reter_iss };
}

/** Linhas para a fatura do cliente: o bruto, cada tributo retido e o líquido. */
export function linhasDeRetencaoNaFatura(bruto: Centavos, r: Pick<RetencoesDaVenda, 'por_tributo' | 'total'>): Array<{ rotulo: string; valor_centavos: Centavos; sinal: 1 | -1 }> {
  const linhas: Array<{ rotulo: string; valor_centavos: Centavos; sinal: 1 | -1 }> = [{ rotulo: 'Valor bruto', valor_centavos: bruto, sinal: 1 }];
  for (const t of TRIBUTOS_RETIDOS) {
    if (r.por_tributo[t] > 0) linhas.push({ rotulo: `${t} retido na fonte (Lei 9.430)`, valor_centavos: r.por_tributo[t], sinal: -1 });
  }
  linhas.push({ rotulo: 'Valor líquido a pagar', valor_centavos: Math.max(0, bruto - r.total), sinal: 1 });
  return linhas;
}

/** O que a conta a receber guarda da retenção (em reais, como o resto da conta). */
export interface RetencaoNaConta {
  valor_bruto: number;
  total: number;
  IR: number;
  CSLL: number;
  PIS: number;
  COFINS: number;
  lei: '9.430';
}

const reais = (c: Centavos) => Math.round(c) / 100;
const centavosDe = (v: unknown) => Math.round((Number(v) || 0) * 100);

/**
 * Deixa LÍQUIDAS as contas a receber do cliente da venda: a retenção sai do
 * valor de cada conta, na proporção do valor dela (a última leva o resto do
 * arredondamento), e cada conta guarda o bruto e o que foi retido de cada
 * tributo. Contas de outras pessoas (fornecedor, intermediário) e de outros
 * pagantes não mudam. Sem retenção, devolve as mesmas contas.
 */
export function aplicarRetencoesNasContas<T extends Record<string, unknown>>(
  contas: T[], r: Pick<RetencoesDaVenda, 'cliente_id' | 'por_tributo' | 'total'>,
): { contas: T[]; aviso: string | null } {
  if (!(r.total > 0) || !r.cliente_id) return { contas, aviso: null };
  const alvo = contas
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => String(c.origem ?? 'VENDA') === 'VENDA' && String(c.cliente_id ?? '') === r.cliente_id && centavosDe(c.valor_final) > 0);
  const soma = alvo.reduce((s, x) => s + centavosDe(x.c.valor_final), 0);
  if (soma <= 0) return { contas, aviso: 'O cliente retém tributos, mas a venda não tem conta a receber dele para descontar a retenção.' };
  const total = Math.min(r.total, soma);
  const aviso = total < r.total ? 'A retenção é maior que o que o cliente ainda paga à agência: o excesso não foi descontado.' : null;
  const saida = contas.slice();
  let restanteTotal = total;
  const restantePorTributo = { ...r.por_tributo };
  alvo.forEach(({ c, i }, k) => {
    const v = centavosDe(c.valor_final);
    const ultima = k === alvo.length - 1;
    const parte = ultima ? restanteTotal : Math.min(restanteTotal, Math.round(total * v / soma));
    restanteTotal -= parte;
    // Cada tributo na mesma proporção; a sobra do arredondamento vai para o
    // maior deles, e a última conta leva exatamente o que faltava de cada um.
    const porTributo: Record<TributoRetido, Centavos> = porTributoZerado();
    if (ultima && total === r.total) {
      for (const t of TRIBUTOS_RETIDOS) porTributo[t] = restantePorTributo[t];
    } else {
      for (const t of TRIBUTOS_RETIDOS) porTributo[t] = Math.round(parte * r.por_tributo[t] / r.total);
      const maior = TRIBUTOS_RETIDOS.reduce((a, t) => (r.por_tributo[t] > r.por_tributo[a] ? t : a), TRIBUTOS_RETIDOS[0]);
      porTributo[maior] += parte - TRIBUTOS_RETIDOS.reduce((s, t) => s + porTributo[t], 0);
    }
    for (const t of TRIBUTOS_RETIDOS) restantePorTributo[t] -= porTributo[t];
    const liquido = v - parte;
    const retencao: RetencaoNaConta = {
      valor_bruto: reais(v), total: reais(parte),
      IR: reais(porTributo.IR), CSLL: reais(porTributo.CSLL), PIS: reais(porTributo.PIS), COFINS: reais(porTributo.COFINS),
      lei: '9.430',
    };
    saida[i] = { ...c, valor_original: reais(liquido), valor_final: reais(liquido), retencao_na_fonte: retencao } as T;
  });
  return { contas: saida, aviso };
}
