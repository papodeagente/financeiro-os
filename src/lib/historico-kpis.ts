import type { ContaReceber, ContaPagar, ContaBancaria } from './crm-types';
import { round2, soma } from './money';
import { valorMovimentado } from './saldo-bancario';
import { valorEmAberto as emAbertoDaConta } from './resultado-financeiro';

// Computa série histórica dos KPIs principais para os últimos N meses,
// usando os dados que o hub já tem em mãos (sem novo endpoint).
//
// Estratégia:
// - Saldo bancário: saldo inicial das contas + Σ recebidos − Σ pagos por
//   mês, cumulativo. O último ponto = saldo atual computado.
// - A receber pendente: snapshot impossível de reconstruir do passado, mas
//   usamos como proxy o total cuja data_vencimento estava em cada mês e
//   que ainda não foi pago no fechamento daquele mês.
// - A pagar pendente: mesmo padrão.
// - Lucro do mês: (recebido nesse mês) − (pago nesse mês).
//
// Quando o backend tiver snapshots reais, basta trocar a implementação
// preservando a mesma assinatura.

export interface HistoricoKpis {
  saldo: number[];
  aReceber: number[];
  aPagar: number[];
  lucro: number[];
  /** Labels 'YYYY-MM' do mais antigo para o mais recente. */
  meses: string[];
}

function ymFromISO(iso: string): string {
  return (iso || '').slice(0, 7);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Retorna ['YYYY-01', ..., 'YYYY-MM'] com N meses terminando no atual. */
function ultimosMeses(n: number, ref: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return out;
}

export function calcularHistoricoKpis(
  contas: ContaBancaria[],
  receber: ContaReceber[],
  pagar: ContaPagar[],
  nMeses: number = 10,
): HistoricoKpis {
  const meses = ultimosMeses(nMeses);
  const saldoInicial = soma((contas || []).map(c => c.saldo_inicial));

  // Realizado por mês, pelo VALOR BAIXADO.
  //
  // Antes, a conta PARCIAL era contada errado nas duas pontas: excluída do
  // realizado (o dinheiro que entrou não aparecia no saldo) e somada INTEIRA
  // no pendente (cobrança do valor cheio de quem já pagou parte). Uma conta
  // de R$ 100.000 com R$ 70.000 recebidos errava R$ 140.000 sozinha, e o
  // erro se propagava por todos os meses seguintes pelo saldo acumulado.
  const recebidoPorMes: Record<string, number[]> = {};
  const pagoPorMes: Record<string, number[]> = {};
  for (const r of receber || []) {
    const valor = valorMovimentado(r, 'valor_recebido');
    if (valor === 0) continue;
    const ym = ymFromISO(r.data_recebimento || r.data_vencimento);
    if (!ym) continue;
    (recebidoPorMes[ym] ||= []).push(valor);
  }
  for (const p of pagar || []) {
    const valor = valorMovimentado(p, 'valor_pago');
    if (valor === 0) continue;
    const ym = ymFromISO(p.data_pagamento || p.data_vencimento);
    if (!ym) continue;
    (pagoPorMes[ym] ||= []).push(valor);
  }

  // Em aberto por mês de vencimento — o SALDO que falta, não o valor cheio.
  const pendReceberPorMes: Record<string, number[]> = {};
  const pendPagarPorMes: Record<string, number[]> = {};
  for (const r of receber || []) {
    const saldo = emAbertoDaConta(r, 'valor_recebido');
    if (saldo <= 0) continue;
    const ym = ymFromISO(r.data_vencimento);
    if (!ym) continue;
    (pendReceberPorMes[ym] ||= []).push(saldo);
  }
  for (const p of pagar || []) {
    const saldo = emAbertoDaConta(p, 'valor_pago');
    if (saldo <= 0) continue;
    const ym = ymFromISO(p.data_vencimento);
    if (!ym) continue;
    (pendPagarPorMes[ym] ||= []).push(saldo);
  }

  // Cumulativo: saldo[i] = saldo[i-1] + recebido_i - pago_i
  let saldoAcum = saldoInicial;
  const saldo: number[] = [];
  const aReceber: number[] = [];
  const aPagar: number[] = [];
  const lucro: number[] = [];
  for (const ym of meses) {
    const rec = soma(recebidoPorMes[ym] || []);
    const pag = soma(pagoPorMes[ym] || []);
    saldoAcum = round2(saldoAcum + rec - pag);
    saldo.push(saldoAcum);
    aReceber.push(soma(pendReceberPorMes[ym] || []));
    aPagar.push(soma(pendPagarPorMes[ym] || []));
    lucro.push(round2(rec - pag));
  }

  return { saldo, aReceber, aPagar, lucro, meses };
}

/** OBSOLETA — não use. Em base zero ela inventa "+100%", enquanto
    `variacaoPct` de money.ts devolve null para dizer "sem base de
    comparação". O hub já usa variacaoPct; esta ficou sem chamadores e
    permanece só para não quebrar importação externa. */
export function calcDelta(series: number[]): { delta: number; dir: 'up' | 'down' | 'flat' } {
  if (!series || series.length < 2) return { delta: 0, dir: 'flat' };
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  if (prev === 0) {
    if (cur === 0) return { delta: 0, dir: 'flat' };
    return { delta: cur > 0 ? 100 : -100, dir: cur > 0 ? 'up' : 'down' };
  }
  const delta = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(delta) < 0.05) return { delta: 0, dir: 'flat' };
  return { delta: Number(delta.toFixed(1)), dir: delta > 0 ? 'up' : 'down' };
}
