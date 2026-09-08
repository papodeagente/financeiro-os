/**
 * FONTE ÚNICA DA VERDADE dos indicadores financeiros de venda e viagem.
 *
 * Toda tela que mostrar margem, recebido, a receber, custo ou resultado deve
 * consumir daqui. Antes desta camada cada tela somava do seu jeito e os
 * números divergiam entre o card, a viagem, o financeiro e o relatório.
 *
 * PRINCÍPIO DE NEGÓCIO (agência de viagens é intermediária)
 * --------------------------------------------------------
 * O valor que o cliente paga NÃO é receita da agência. Numa viagem de
 * R$ 20.000 com R$ 16.500 de fornecedores, a receita da agência é R$ 3.500.
 * Por isso este módulo separa:
 *
 *   volume_vendido    quanto o cliente contratou (nunca é receita)
 *   repasses          o que pertence aos fornecedores
 *   receita_agencia   o que sobra para a empresa, igual à margem bruta
 *
 * Somar volume_vendido como receita infla o faturamento e faz o dono da
 * agência achar que ganhou 20 mil onde ganhou 3,5 mil.
 *
 * REGRAS APLICADAS
 * ----------------
 *  1. Todo somatório passa por soma/somaPor (money.ts). Nunca reduce solto.
 *  2. Conta CANCELADA não entra em nenhum total.
 *  3. O realizado deriva do VALOR BAIXADO, não do status. Baixa PARCIAL
 *     conta pelo acumulado; ignorá-la faz a conta sumir do relatório.
 *  4. Datas civis comparadas por string via helpers de money.ts. Nunca
 *     new Date('YYYY-MM-DD'), que volta um dia no fuso do Brasil.
 *  5. Divisão de indicador por divSegura, para não estampar NaN na tela.
 */

import {
  divSegura,
  estaVencido,
  hojeISO,
  num,
  round2,
  soma,
  somaPor,
} from './money';

// ============================================================
// Formato mínimo de entrada
// ============================================================
// Aceita o shape gravado no JSONB sem exigir o tipo completo, para que
// rotas, telas e testes possam chamar com o que têm em mãos.

export interface ContaReceberMin {
  id?: string;
  origem?: string;
  status?: string;
  valor_final?: number | null;
  valor_recebido?: number | null;
  desconto?: number | null;
  juros?: number | null;
  multa?: number | null;
  taxa?: number | null;
  data_vencimento?: string | null;
  data_recebimento?: string | null;
  descricao?: string | null;
  cliente_nome?: string | null;
  parcela_numero?: number | null;
  total_parcelas?: number | null;
}

export interface ContaPagarMin {
  id?: string;
  origem?: string;
  status?: string;
  valor_final?: number | null;
  valor_pago?: number | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  descricao?: string | null;
  fornecedor_nome?: string | null;
  is_custo_comercial?: boolean | null;
}

/** Conta cancelada não existe para efeito de número. */
export function estaCancelada(c: { status?: string | null }): boolean {
  return String(c.status ?? '') === 'CANCELADO';
}

/** Contas que ainda valem para somatório. */
export function ativas<T extends { status?: string | null }>(contas: readonly T[] | null | undefined): T[] {
  return (contas || []).filter(c => !estaCancelada(c));
}

/**
 * Quanto a conta JÁ movimentou no caixa.
 *
 * PARCIAL guarda o acumulado baixado no campo de baixa, então ele é a fonte.
 * Só a quitação total cai no valor_final. Pendente vale zero mesmo tendo
 * valor_final preenchido: previsão não é dinheiro.
 */
export interface ContaBaixavel {
  status?: string | null;
  valor_final?: number | null;
  valor_recebido?: number | null;
  valor_pago?: number | null;
}

export function valorRealizado(
  conta: ContaBaixavel,
  campo: 'valor_recebido' | 'valor_pago',
): number {
  const status = String(conta.status ?? '');
  if (status === 'CANCELADO') return 0;
  const quitado = campo === 'valor_recebido' ? 'RECEBIDO' : 'PAGO';
  if (status === 'PARCIAL') return round2(num(conta[campo]));
  if (status === quitado) return round2(num(conta[campo]) || num(conta.valor_final));
  return 0;
}

/** Quanto ainda falta entrar/sair desta conta. Nunca negativo. */
export function valorEmAberto(
  conta: ContaBaixavel,
  campo: 'valor_recebido' | 'valor_pago',
): number {
  if (estaCancelada(conta)) return 0;
  const total = round2(num(conta.valor_final));
  const feito = valorRealizado(conta, campo);
  return Math.max(0, round2(total - feito));
}

// ============================================================
// Resultado de uma venda ou viagem
// ============================================================

export interface ProximoEvento {
  data: string;
  valor: number;
  descricao: string;
}

export interface ResultadoFinanceiro {
  // ---- VENDA ----
  /** Bruto contratado pelo cliente. NÃO é receita da agência. */
  volume_vendido: number;
  descontos: number;
  /** Volume menos descontos. É o que a agência tem direito de cobrar. */
  volume_liquido: number;

  // ---- CLIENTE ----
  recebido: number;
  a_receber: number;
  percentual_recebido: number;
  vencido_a_receber: number;
  parcelas_vencidas: number;
  proxima_parcela: ProximoEvento | null;

  // ---- FORNECEDORES ----
  /** Tudo que foi lançado como custo da viagem, pago ou não. */
  custo_previsto: number;
  custo_pago: number;
  custo_pendente: number;
  vencido_a_pagar: number;
  proximo_pagamento: ProximoEvento | null;

  // ---- RESULTADO ----
  /** Comissões que a agência recebe de fornecedores. */
  comissoes_a_receber: number;
  /** Custo financeiro das formas de pagamento (adquirente, boleto). */
  taxas: number;
  /** Receita da agência prevista. Igual à margem bruta prevista. */
  receita_agencia: number;
  margem_prevista: number;
  /** Margem já concretizada em caixa: entrou menos saiu. */
  margem_realizada: number;
  /** Margem prevista sobre o volume líquido, em percentual. */
  margem_percentual: number;
  /**
   * Margem travada no momento da venda, quando a venda guardou esse número.
   * É a única referência honesta de "previsto": a margem_prevista acompanha
   * as contas de hoje, então um custo que subiu já entra nela e o desvio
   * contra ela daria sempre zero.
   */
  margem_baseline: number | null;
  /** Quanto a margem se afastou do que foi vendido. Negativo = piorou. */
  desvio_margem: number | null;
  /** Quanto o custo se afastou do orçado. Positivo = custo subiu. */
  desvio_custo: number | null;
  /** Resultado final depois de taxas. */
  resultado_final: number;
}

export interface EntradaResultado {
  contas_receber?: readonly ContaReceberMin[] | null;
  contas_pagar?: readonly ContaPagarMin[] | null;
  /** Data de referência para vencidos. Default: hoje no fuso do tenant. */
  hoje?: string;
  /**
   * Números congelados quando a venda foi fechada, para comparar previsto
   * contra realizado. Sem eles não há como saber que o hotel subiu R$ 800:
   * a conta a pagar já foi reescrita com o valor novo.
   */
  baseline?: {
    margem?: number | null;
    custo?: number | null;
  } | null;
  /**
   * Custo registrado na venda que NÃO tem conta a pagar correspondente.
   *
   * Conta a pagar só nasce quando existe fornecedor real a quem pagar. O
   * custo de um item sem fornecedor identificado continua valendo para a
   * margem (margem é venda menos custo), mas não vira dívida. Sem este
   * campo o custo sumiria da conta e a margem apareceria inflada.
   */
  custo_sem_conta?: number | null;
}

/**
 * Calcula o retrato financeiro completo de uma venda ou de uma viagem, a
 * partir das contas que a originaram.
 *
 * As contas a receber vêm de duas origens diferentes e não podem ser
 * misturadas: origem VENDA é dinheiro do cliente (que em boa parte será
 * repassado ao fornecedor), origem COMISSAO_FORNECEDOR já é receita pura da
 * agência. Somar as duas como se fossem a mesma coisa distorce a margem.
 */
export function calcularResultado(entrada: EntradaResultado): ResultadoFinanceiro {
  const hoje = entrada.hoje || hojeISO();
  const receber = ativas(entrada.contas_receber);
  const pagar = ativas(entrada.contas_pagar);

  const doCliente = receber.filter(c => String(c.origem ?? 'VENDA') !== 'COMISSAO_FORNECEDOR');
  const deComissao = receber.filter(c => String(c.origem ?? '') === 'COMISSAO_FORNECEDOR');

  // ---- VENDA ----
  // valor_final já é líquido do desconto rateado na geração das contas.
  // O campo desconto guarda abatimentos dados depois, na própria conta.
  const descontos = somaPor(doCliente, c => num(c.desconto));
  const volume_liquido = somaPor(doCliente, c => num(c.valor_final));
  const volume_vendido = round2(volume_liquido + descontos);

  // ---- CLIENTE ----
  const recebidoCliente = somaPor(doCliente, c => valorRealizado(c, 'valor_recebido'));
  const comissoesRecebidas = somaPor(deComissao, c => valorRealizado(c, 'valor_recebido'));
  const recebido = round2(recebidoCliente + comissoesRecebidas);
  const a_receber = somaPor(receber, c => valorEmAberto(c, 'valor_recebido'));

  const emAbertoVencidas = receber.filter(
    c => valorEmAberto(c, 'valor_recebido') > 0 && estaVencido(c.data_vencimento, hoje),
  );
  const vencido_a_receber = somaPor(emAbertoVencidas, c => valorEmAberto(c, 'valor_recebido'));

  const proxima_parcela = proximoVencimento(
    receber.filter(c => valorEmAberto(c, 'valor_recebido') > 0),
    c => valorEmAberto(c, 'valor_recebido'),
    c => c.descricao || c.cliente_nome || 'Parcela',
    hoje,
  );

  // ---- FORNECEDORES ----
  // O custo previsto é o que está lançado como conta a pagar MAIS o custo
  // que a venda registrou sem fornecedor identificado. Os dois somam porque
  // representam partes diferentes do mesmo custo: o que já tem dono e o que
  // ainda não tem.
  const custoSemConta = Math.max(0, round2(num(entrada.custo_sem_conta)));
  const custo_previsto = round2(somaPor(pagar, c => num(c.valor_final)) + custoSemConta);
  const custo_pago = somaPor(pagar, c => valorRealizado(c, 'valor_pago'));
  const custo_pendente = somaPor(pagar, c => valorEmAberto(c, 'valor_pago'));
  const vencido_a_pagar = somaPor(
    pagar.filter(c => valorEmAberto(c, 'valor_pago') > 0 && estaVencido(c.data_vencimento, hoje)),
    c => valorEmAberto(c, 'valor_pago'),
  );
  const proximo_pagamento = proximoVencimento(
    pagar.filter(c => valorEmAberto(c, 'valor_pago') > 0),
    c => valorEmAberto(c, 'valor_pago'),
    c => c.fornecedor_nome || c.descricao || 'Fornecedor',
    hoje,
  );

  // ---- RESULTADO ----
  const comissoes_a_receber = somaPor(deComissao, c => num(c.valor_final));
  const taxas = somaPor(receber, c => num(c.taxa));

  // Receita da agência = o que sobra depois de repassar os fornecedores,
  // mais as comissões que os fornecedores pagam à agência.
  const margem_prevista = round2(volume_liquido + comissoes_a_receber - custo_previsto);
  const receita_agencia = margem_prevista;
  const margem_realizada = round2(recebido - custo_pago);
  const margem_percentual = round2(divSegura(margem_prevista, volume_liquido) * 100);

  // Baseline só existe se a venda tiver guardado o número. Ausente vira null
  // em vez de zero: zero seria lido na tela como "nenhum desvio", que é uma
  // afirmação que não temos como fazer.
  const margem_baseline = entrada.baseline?.margem === null || entrada.baseline?.margem === undefined
    ? null
    : round2(num(entrada.baseline.margem));
  const custo_baseline = entrada.baseline?.custo === null || entrada.baseline?.custo === undefined
    ? null
    : round2(num(entrada.baseline.custo));

  return {
    volume_vendido,
    descontos,
    volume_liquido,

    recebido,
    a_receber,
    percentual_recebido: round2(divSegura(recebido, round2(recebido + a_receber)) * 100),
    vencido_a_receber,
    parcelas_vencidas: emAbertoVencidas.length,
    proxima_parcela,

    custo_previsto,
    custo_pago,
    custo_pendente,
    vencido_a_pagar,
    proximo_pagamento,

    comissoes_a_receber,
    taxas,
    receita_agencia,
    margem_prevista,
    margem_realizada,
    margem_percentual,
    margem_baseline,
    desvio_margem: margem_baseline === null ? null : round2(margem_prevista - margem_baseline),
    desvio_custo: custo_baseline === null ? null : round2(custo_previsto - custo_baseline),
    resultado_final: round2(margem_prevista - taxas),
  };
}

/** Vencimento em aberto mais próximo, olhando de `hoje` para frente e,
 *  na falta de futuros, o mais antigo em atraso. */
function proximoVencimento<T extends { data_vencimento?: string | null }>(
  contas: readonly T[],
  valor: (c: T) => number,
  descricao: (c: T) => string,
  hoje: string,
): ProximoEvento | null {
  const comData = contas.filter(c => !!c.data_vencimento);
  if (comData.length === 0) return null;
  const ordenadas = [...comData].sort(
    (a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)),
  );
  const futura = ordenadas.find(c => String(c.data_vencimento).slice(0, 10) >= hoje);
  const alvo = futura || ordenadas[0];
  return {
    data: String(alvo.data_vencimento).slice(0, 10),
    valor: round2(valor(alvo)),
    descricao: descricao(alvo),
  };
}

// ============================================================
// Inadimplência — faixas de atraso
// ============================================================

export type FaixaAtraso = 'VENCE_HOJE' | 'ATE_3' | 'ATE_7' | 'ATE_15' | 'ATE_30' | 'ACIMA_30';

export const FAIXAS_ATRASO: { id: FaixaAtraso; label: string }[] = [
  { id: 'VENCE_HOJE', label: 'Vence hoje' },
  { id: 'ATE_3', label: '1 a 3 dias' },
  { id: 'ATE_7', label: '4 a 7 dias' },
  { id: 'ATE_15', label: '8 a 15 dias' },
  { id: 'ATE_30', label: '16 a 30 dias' },
  { id: 'ACIMA_30', label: 'Mais de 30 dias' },
];

/** Dias inteiros entre duas datas civis, sem armadilha de fuso. */
export function diasEntre(de: string, ate: string): number {
  const a = String(de).slice(0, 10);
  const b = String(ate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  // Ancorado ao meio-dia UTC: imune a horário de verão e a offset negativo.
  const ms = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10), 12)
    - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10), 12);
  return Math.round(ms / 86400000);
}

export function faixaDeAtraso(vencimento: string, hoje = hojeISO()): FaixaAtraso | null {
  const dias = diasEntre(hoje, vencimento);
  if (dias < 0) return null;      // ainda vai vencer
  if (dias === 0) return 'VENCE_HOJE';
  if (dias <= 3) return 'ATE_3';
  if (dias <= 7) return 'ATE_7';
  if (dias <= 15) return 'ATE_15';
  if (dias <= 30) return 'ATE_30';
  return 'ACIMA_30';
}

export interface LinhaInadimplencia {
  faixa: FaixaAtraso;
  label: string;
  quantidade: number;
  valor: number;
  clientes: string[];
}

/**
 * Agrupa o que está vencido por faixa de atraso. Trabalha sempre sobre o
 * SALDO em aberto: uma parcela de R$ 5.000 com R$ 3.000 já recebidos entra
 * como R$ 2.000 de inadimplência, não R$ 5.000.
 */
export function calcularInadimplencia(
  contas: readonly ContaReceberMin[] | null | undefined,
  hoje = hojeISO(),
): LinhaInadimplencia[] {
  const buckets = new Map<FaixaAtraso, { valor: number[]; qtd: number; clientes: Set<string> }>();
  for (const f of FAIXAS_ATRASO) buckets.set(f.id, { valor: [], qtd: 0, clientes: new Set() });

  for (const c of ativas(contas)) {
    const saldo = valorEmAberto(c, 'valor_recebido');
    if (saldo <= 0 || !c.data_vencimento) continue;
    const faixa = faixaDeAtraso(String(c.data_vencimento), hoje);
    if (!faixa) continue;
    const b = buckets.get(faixa)!;
    b.valor.push(saldo);
    b.qtd += 1;
    if (c.cliente_nome) b.clientes.add(c.cliente_nome);
  }

  return FAIXAS_ATRASO.map(f => {
    const b = buckets.get(f.id)!;
    return {
      faixa: f.id,
      label: f.label,
      quantidade: b.qtd,
      valor: soma(b.valor),
      clientes: [...b.clientes].sort(),
    };
  });
}

// ============================================================
// Caixa livre — saldo bancário não é lucro
// ============================================================

export interface CaixaLivre {
  saldo_atual: number;
  comprometido_fornecedores: number;
  comissoes_provisionadas: number;
  tributos_provisionados: number;
  total_comprometido: number;
  caixa_livre: number;
  /** Quanto entra de cliente no mesmo horizonte, para leitura de risco. */
  entradas_previstas: number;
  /** Caixa livre considerando o que ainda vai entrar. */
  caixa_livre_com_entradas: number;
}

export interface EntradaCaixaLivre {
  saldo_atual: number;
  contas_pagar?: readonly ContaPagarMin[] | null;
  contas_receber?: readonly ContaReceberMin[] | null;
  /** Comissões de vendedores ainda não pagas. */
  comissoes_a_pagar?: number;
  /** Provisão de tributos informada pela agência. */
  tributos?: number;
  /** Horizonte em dias. Fora dele o compromisso não entra na conta. */
  horizonte_dias?: number;
  hoje?: string;
}

/**
 * Saldo bancário menos o que já tem dono. Existe porque o saldo sozinho
 * engana: R$ 200.000 em conta com R$ 130.000 de fornecedores a pagar é
 * R$ 55.000 de caixa livre, não R$ 200.000 de lucro.
 */
export function calcularCaixaLivre(e: EntradaCaixaLivre): CaixaLivre {
  const hoje = e.hoje || hojeISO();
  const limite = e.horizonte_dias && e.horizonte_dias > 0
    ? somarDias(hoje, e.horizonte_dias)
    : null;

  const dentroDoHorizonte = (venc?: string | null) => {
    if (!limite) return true;
    if (!venc) return false;
    return String(venc).slice(0, 10) <= limite;
  };

  const comprometido_fornecedores = somaPor(
    ativas(e.contas_pagar).filter(c => dentroDoHorizonte(c.data_vencimento)),
    c => valorEmAberto(c, 'valor_pago'),
  );
  const entradas_previstas = somaPor(
    ativas(e.contas_receber).filter(c => dentroDoHorizonte(c.data_vencimento)),
    c => valorEmAberto(c, 'valor_recebido'),
  );

  const comissoes_provisionadas = round2(num(e.comissoes_a_pagar));
  const tributos_provisionados = round2(num(e.tributos));
  const total_comprometido = soma([
    comprometido_fornecedores,
    comissoes_provisionadas,
    tributos_provisionados,
  ]);
  const saldo_atual = round2(num(e.saldo_atual));
  const caixa_livre = round2(saldo_atual - total_comprometido);

  return {
    saldo_atual,
    comprometido_fornecedores,
    comissoes_provisionadas,
    tributos_provisionados,
    total_comprometido,
    caixa_livre,
    entradas_previstas,
    caixa_livre_com_entradas: round2(caixa_livre + entradas_previstas),
  };
}

/** Soma dias a uma data civil sem passar por Date local. */
function somarDias(iso: string, dias: number): string {
  const s = String(iso).slice(0, 10);
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
