/**
 * Liquidação de contas a pagar/receber — regra pura (05/11/2026).
 *
 * Usada pelo servidor (que decide) e pela tela (que mostra a mesma conta
 * antes de gravar). Sem banco, sem React.
 *
 * Modelo, compatível com tudo que já existe:
 * - `valor_recebido` / `valor_pago` do título = o que entrou/saiu de verdade
 *   (o valor cheio pago pelo cliente/à pessoa). É o que move o caixa e o que
 *   o recálculo de saldos e os painéis já usam.
 * - juros, multa e desconto acumulam nos campos do título e entram no
 *   `valor_final` (= base + juros + multa − desconto). A base é o valor final
 *   antes do primeiro encargo, guardada uma vez em `valor_base_encargos`.
 * - quitado quando o pago alcança o valor final (tolerância de meio centavo).
 */
import { addDias, num, paraCentavos, round2 } from './money';

export type TituloTabela = 'contas_receber' | 'contas_pagar';
export type TratamentoDiferenca = 'deixar_aberto' | 'desconto' | 'acrescimo' | 'credito' | 'taxa';

/** Política da agência para encargos (agencia.data.politica_cobranca). */
export interface PoliticaCobranca {
  /** Juros ao mês, em %, simples e proporcional por dia (mês de 30 dias). */
  juros_am_pct?: number;
  /** Multa única por atraso, em % do saldo. */
  multa_pct?: number;
  /** Dias depois do vencimento sem cobrar nada. */
  tolerancia_dias?: number;
  /** Desconto por pagar adiantado. */
  desconto_antecipacao?: { pct: number; dias: number } | null;
  /** Sugerir encargos também nas contas a pagar (padrão: não). */
  aplicar_em_pagar?: boolean;
}

export interface TituloParaBaixa {
  tabela: TituloTabela;
  status: string;
  valor_final: number;
  /** Já recebido/pago (acumulado). */
  valor_baixado: number;
  data_vencimento: string;
  juros?: number;
  multa?: number;
  desconto?: number;
  valor_base_encargos?: number | null;
  conta_bancaria_id?: string | null;
}

export interface EncargosSugeridos {
  dias_atraso: number;
  juros: number;
  multa: number;
  desconto_antecipacao: number;
}

const dias = (de: string, ate: string) => {
  const a = Date.parse(`${de.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${ate.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
};

/** Quanto falta pagar/receber do título hoje. */
export function saldoDoTitulo(t: Pick<TituloParaBaixa, 'valor_final' | 'valor_baixado'>): number {
  return Math.max(0, round2(num(t.valor_final) - num(t.valor_baixado)));
}

/**
 * Encargos que a política sugere para pagar na data informada. Só sugere:
 * a pessoa sempre pode mudar o valor na tela.
 */
export function calcularEncargos(t: TituloParaBaixa, dataBaixa: string, politica: PoliticaCobranca | null | undefined): EncargosSugeridos {
  const zero = { dias_atraso: 0, juros: 0, multa: 0, desconto_antecipacao: 0 };
  const p = politica ?? {};
  if (t.tabela === 'contas_pagar' && !p.aplicar_em_pagar) return { ...zero, dias_atraso: Math.max(0, dias(t.data_vencimento || dataBaixa, dataBaixa)) };
  const saldo = saldoDoTitulo(t);
  if (!t.data_vencimento || saldo <= 0) return zero;
  const atraso = dias(t.data_vencimento, dataBaixa);
  if (atraso > 0) {
    const tol = Math.max(0, num(p.tolerancia_dias));
    if (atraso <= tol) return { ...zero, dias_atraso: atraso };
    const juros = round2(saldo * (num(p.juros_am_pct) / 100) / 30 * atraso);
    const multa = round2(saldo * (num(p.multa_pct) / 100));
    return { dias_atraso: atraso, juros, multa, desconto_antecipacao: 0 };
  }
  const d = p.desconto_antecipacao;
  if (d && num(d.pct) > 0 && num(d.dias) > 0) {
    const limite = addDias(t.data_vencimento, -Math.round(num(d.dias)));
    if (dataBaixa.slice(0, 10) <= limite) {
      return { ...zero, desconto_antecipacao: round2(saldo * num(d.pct) / 100) };
    }
  }
  return zero;
}

export interface PedidoDeBaixa {
  /** Dinheiro que entrou/saiu agora (cheio, antes da taxa da plataforma). */
  valor: number;
  data: string;
  juros?: number;
  multa?: number;
  desconto?: number;
  /** Retido pela plataforma/banco (só informativo; segue a regra de hoje). */
  taxa?: number;
  tratamento_diferenca?: TratamentoDiferenca;
}

export interface PlanoDaBaixa {
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
  /** Excesso guardado como crédito do cliente (fica registrado na baixa). */
  credito: number;
  /** Quanto do valor abate a dívida. */
  principal: number;
  saldo_antes: number;
  saldo_depois: number;
  /** pago − (saldo + encargos − desconto). <0 pagou menos; >0 pagou mais. */
  diferenca: number;
  status_depois: string;
  valor_final_depois: number;
  valor_baixado_depois: number;
  avisos: string[];
  erros: string[];
}

/**
 * O que acontece com o título se esta baixa for gravada. A diferença entre
 * o pago e o devido (com encargos) é resolvida pelo `tratamento_diferenca`:
 * - pagou menos: 'deixar_aberto' (padrão; fica parcial) ou 'desconto'
 *   (a diferença vira desconto e o título é quitado);
 * - pagou mais: 'acrescimo' (padrão; a sobra vira juros) ou 'credito'
 *   (a sobra fica como crédito do cliente, registrado na baixa).
 */
export function planoDaBaixa(t: TituloParaBaixa, pedido: PedidoDeBaixa): PlanoDaBaixa {
  const erros: string[] = [];
  const avisos: string[] = [];
  const valor = round2(num(pedido.valor));
  let juros = Math.max(0, round2(num(pedido.juros)));
  let multa = Math.max(0, round2(num(pedido.multa)));
  let desconto = Math.max(0, round2(num(pedido.desconto)));
  const taxa = Math.max(0, round2(num(pedido.taxa)));
  const quitadoStatus = t.tabela === 'contas_receber' ? 'RECEBIDO' : 'PAGO';

  if (valor <= 0) erros.push('Informe um valor maior que zero.');
  if (!pedido.data || !/^\d{4}-\d{2}-\d{2}$/.test(pedido.data.slice(0, 10))) erros.push('Informe a data do pagamento.');
  if (t.status === 'CANCELADO') erros.push('Esta conta está cancelada.');
  if (t.tabela === 'contas_receber' && taxa > valor) erros.push('A taxa não pode ser maior que o valor recebido.');

  const saldo_antes = saldoDoTitulo(t);
  if (saldo_antes <= 0 && t.status === quitadoStatus) erros.push('Esta conta já está liquidada.');

  const devidoComEncargos = round2(saldo_antes + juros + multa - desconto);
  let diferenca = round2(valor - devidoComEncargos);
  let credito = 0;
  const tratamento = pedido.tratamento_diferenca;

  if (diferenca < -0.005) {
    if (tratamento === 'desconto') {
      desconto = round2(desconto + -diferenca);
      avisos.push(`A diferença de R$ ${(-diferenca).toFixed(2).replace('.', ',')} vira desconto e a conta é liquidada.`);
      diferenca = 0;
    }
    // 'deixar_aberto' (padrão): fica parcial.
  } else if (diferenca > 0.005) {
    if (tratamento === 'credito' && t.tabela === 'contas_receber') {
      credito = diferenca;
      avisos.push('A sobra fica registrada como crédito do cliente.');
    } else {
      juros = round2(juros + diferenca);
      avisos.push('A sobra foi lançada como acréscimo (juros).');
    }
    diferenca = 0;
  }

  const base = num(t.valor_base_encargos) || round2(num(t.valor_final) - num(t.juros) + num(t.desconto) - num(t.multa));
  const jurosTot = round2(num(t.juros) + juros);
  const multaTot = round2(num(t.multa) + multa);
  const descTot = round2(num(t.desconto) + desconto);
  const valor_final_depois = round2(base + jurosTot + multaTot - descTot);
  const valor_baixado_depois = round2(num(t.valor_baixado) + valor - credito);
  const restante = round2(valor_final_depois - valor_baixado_depois);
  const quitado = restante <= 0.005;
  const status_depois = quitado ? quitadoStatus : valor_baixado_depois > 0 ? 'PARCIAL' : t.status;
  const principal = round2(valor - credito - juros - multa);
  if (principal < 0) erros.push('Os encargos são maiores que o valor pago.');
  if (descTot > round2(base + jurosTot + multaTot)) erros.push('O desconto não pode ser maior que a conta.');

  return {
    valor, juros, multa, desconto, taxa, credito, principal,
    saldo_antes,
    saldo_depois: Math.max(0, restante),
    diferenca,
    status_depois,
    valor_final_depois,
    valor_baixado_depois,
    avisos,
    erros,
  };
}

/** Os campos do título depois da baixa (para gravar no JSONB). */
export function tituloDepoisDaBaixa(
  dados: Record<string, unknown>,
  t: TituloParaBaixa,
  plano: PlanoDaBaixa,
  pedido: { data: string; conta_bancaria_id: string | null },
): Record<string, unknown> {
  const campoValor = t.tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const campoData = t.tabela === 'contas_receber' ? 'data_recebimento' : 'data_pagamento';
  const base = num(t.valor_base_encargos) || round2(num(t.valor_final) - num(t.juros) + num(t.desconto) - num(t.multa));
  const novo: Record<string, unknown> = {
    ...dados,
    status: plano.status_depois,
    [campoValor]: plano.valor_baixado_depois,
    [campoData]: pedido.data.slice(0, 10),
    juros: round2(num(t.juros) + plano.juros),
    multa: round2(num(t.multa) + plano.multa),
    desconto: round2(num(t.desconto) + plano.desconto),
    valor_final: plano.valor_final_depois,
    valor_base_encargos: base,
  };
  if (pedido.conta_bancaria_id) novo.conta_bancaria_id = pedido.conta_bancaria_id;
  if (t.tabela === 'contas_receber' && plano.taxa > 0) novo.taxa = round2(num(dados.taxa) + plano.taxa);
  return novo;
}

/** Os campos do título depois de estornar uma baixa gravada. */
export function tituloDepoisDoEstorno(
  dados: Record<string, unknown>,
  tabela: TituloTabela,
  baixa: { valor: number; juros: number; multa: number; desconto: number; taxa: number; credito: number },
): Record<string, unknown> {
  const campoValor = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const quitado = tabela === 'contas_receber' ? 'RECEBIDO' : 'PAGO';
  const juros = Math.max(0, round2(num(dados.juros) - baixa.juros));
  const multa = Math.max(0, round2(num(dados.multa) - baixa.multa));
  const desconto = Math.max(0, round2(num(dados.desconto) - baixa.desconto));
  const base = num(dados.valor_base_encargos) || round2(num(dados.valor_final) - num(dados.juros) + num(dados.desconto) - num(dados.multa));
  const valorFinal = round2(base + juros + multa - desconto);
  const baixado = Math.max(0, round2(num(dados[campoValor]) - (baixa.valor - baixa.credito)));
  const status = baixado <= 0.005 ? 'PENDENTE' : round2(valorFinal - baixado) <= 0.005 ? quitado : 'PARCIAL';
  const novo: Record<string, unknown> = { ...dados, status, [campoValor]: baixado, juros, multa, desconto, valor_final: valorFinal };
  if (tabela === 'contas_receber' && baixa.taxa > 0) novo.taxa = Math.max(0, round2(num(dados.taxa) - baixa.taxa));
  return novo;
}

const limitar = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, num(v)));

/** Política gravada sempre dentro de faixas razoáveis. */
export function normalizarPolitica(p: Partial<PoliticaCobranca> | null | undefined): PoliticaCobranca {
  const d = p?.desconto_antecipacao;
  return {
    juros_am_pct: limitar(p?.juros_am_pct, 0, 20),
    multa_pct: limitar(p?.multa_pct, 0, 20),
    tolerancia_dias: Math.round(limitar(p?.tolerancia_dias, 0, 60)),
    desconto_antecipacao: d && num(d.pct) > 0 && num(d.dias) > 0
      ? { pct: limitar(d.pct, 0, 50), dias: Math.round(limitar(d.dias, 1, 60)) }
      : null,
    aplicar_em_pagar: Boolean(p?.aplicar_em_pagar),
  };
}

/** Centavos, para gravar a baixa. */
export const centavos = paraCentavos;
