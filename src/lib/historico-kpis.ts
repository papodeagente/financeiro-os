import type { ContaReceber, ContaPagar, ContaBancaria } from './crm-types';

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
  const saldoInicial = (contas || []).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0);

  // Recebido/pago efetivo agrupado por mês de data_recebimento/data_pagamento
  const recebidoPorMes: Record<string, number> = {};
  const pagoPorMes: Record<string, number> = {};
  for (const r of receber || []) {
    if (r.status !== 'RECEBIDO') continue;
    const ym = ymFromISO(r.data_recebimento || r.data_vencimento);
    if (!ym) continue;
    recebidoPorMes[ym] = (recebidoPorMes[ym] || 0) + (Number(r.valor_recebido) || Number(r.valor_final) || 0);
  }
  for (const p of pagar || []) {
    if (p.status !== 'PAGO') continue;
    const ym = ymFromISO(p.data_pagamento || p.data_vencimento);
    if (!ym) continue;
    pagoPorMes[ym] = (pagoPorMes[ym] || 0) + (Number(p.valor_pago) || Number(p.valor_final) || 0);
  }

  // Pendentes que vencem no mês (proxy de "a receber/pagar naquele instante")
  const pendReceberPorMes: Record<string, number> = {};
  const pendPagarPorMes: Record<string, number> = {};
  for (const r of receber || []) {
    if (r.status === 'CANCELADO') continue;
    if (r.status === 'RECEBIDO') continue; // só pendentes
    const ym = ymFromISO(r.data_vencimento);
    if (!ym) continue;
    pendReceberPorMes[ym] = (pendReceberPorMes[ym] || 0) + (Number(r.valor_final) || 0);
  }
  for (const p of pagar || []) {
    if (p.status === 'CANCELADO') continue;
    if (p.status === 'PAGO') continue;
    const ym = ymFromISO(p.data_vencimento);
    if (!ym) continue;
    pendPagarPorMes[ym] = (pendPagarPorMes[ym] || 0) + (Number(p.valor_final) || 0);
  }

  // Cumulativo: saldo[i] = saldo[i-1] + recebido_i - pago_i
  let saldoAcum = saldoInicial;
  const saldo: number[] = [];
  const aReceber: number[] = [];
  const aPagar: number[] = [];
  const lucro: number[] = [];
  for (const ym of meses) {
    const rec = recebidoPorMes[ym] || 0;
    const pag = pagoPorMes[ym] || 0;
    saldoAcum += rec - pag;
    saldo.push(Number(saldoAcum.toFixed(2)));
    aReceber.push(Number((pendReceberPorMes[ym] || 0).toFixed(2)));
    aPagar.push(Number((pendPagarPorMes[ym] || 0).toFixed(2)));
    lucro.push(Number((rec - pag).toFixed(2)));
  }

  return { saldo, aReceber, aPagar, lucro, meses };
}

/** Calcula delta percentual entre dois pontos consecutivos da série.
    Retorna { delta, dir } onde dir é 'up' / 'down' / 'flat'. */
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
