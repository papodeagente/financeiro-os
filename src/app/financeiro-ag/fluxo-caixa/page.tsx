'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, ContaBancaria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle, Wallet,
  Calendar, BarChart3,
} from 'lucide-react';
import type { FunilPayload } from '@/lib/funil-types';
import {
  round2, num, somaPor, divSegura, hojeISO, dataLocal, paraISO, mesDe, dentroDoPeriodo,
} from '@/lib/money';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function getWeekRange(date: Date): string {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} — ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

type Periodo = 'SEMANAL' | 'MENSAL';

interface FluxoLine {
  periodo: string;
  label: string;
  entradas: number;
  saidas: number;
  saldo: number;
  saldoAcumulado: number;
  detalhesEntradas: Array<{ desc: string; valor: number; data: string }>;
  detalhesSaidas: Array<{ desc: string; valor: number; data: string }>;
}

/** Movimento unitário de caixa — realizado (baixado) ou previsto (em aberto). */
interface Evento {
  desc: string;
  valor: number;
  data: string;
  realizado: boolean;
}

export default function FluxoCaixaPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [funis, setFunis] = useState<FunilPayload[]>([]);
  const [incluirFunis, setIncluirFunis] = useState(false);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo>('MENSAL');
  const [meses, setMeses] = useState(6);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [cr, cp, cb, fs] = await Promise.all([
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<FunilPayload>('funis'),
    ]);
    setContasReceber(cr);
    setContasPagar(cp);
    setContasBancarias(cb);
    setFunis(fs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  /**
   * Soma a receita/investimento projetado dos funis em execução.
   * A projeção é aplicada uniformemente sobre os períodos futuros (simplificação consciente:
   * o funil não carrega calendário próprio — é uma estimativa mensal distribuída por período).
   */
  const projecaoFunis = useMemo(() => {
    const ativos = funis.filter(f => f.status === 'em_execucao');
    let receita = 0;
    let investimento = 0;
    for (const f of ativos) {
      const kpis = f.data?.cenarios?.[0]?.kpis;
      if (!kpis) continue;
      receita = round2(receita + num(kpis.receita_liquida ?? kpis.receita_bruta ?? 0));
      investimento = round2(investimento + num(kpis.investimento_total ?? 0));
    }
    // Se for semanal, dividir por 4 (aproximação mês/semana)
    const divisor = periodo === 'MENSAL' ? 1 : 4;
    return {
      count: ativos.length,
      receita: round2(divSegura(receita, divisor)),
      investimento: round2(divSegura(investimento, divisor)),
    };
  }, [funis, periodo]);

  // Saldo computado: saldo_inicial + recebido - pago. Sempre bate com
  // o histórico de baixas, independente de saldo_atual persistido.
  const saldoAtual = useMemo(() =>
    calcularSaldoBancario(contasBancarias, contasReceber, contasPagar),
    [contasBancarias, contasReceber, contasPagar]
  );

  // Cada conta vira até DOIS eventos de caixa:
  //  · REALIZADO — o que já foi baixado (RECEBIDO/PAGO, ou a parcela já
  //    quitada de uma baixa PARCIAL), na data da baixa;
  //  · PREVISTO  — o saldo ainda em aberto, na data de vencimento.
  // Separar os dois é o que permite montar o saldo base com dinheiro REAL e
  // tratar pendência vencida como projeção, nunca como caixa existente.
  const eventosEntrada = useMemo<Evento[]>(() => {
    const out: Evento[] = [];
    for (const cr of contasReceber) {
      if (cr.status === 'CANCELADO') continue;
      const desc = `${cr.cliente_nome || '—'} — ${cr.descricao || ''}`;
      const baixado = cr.status === 'RECEBIDO'
        ? round2(num(cr.valor_recebido) || num(cr.valor_final))
        : round2(num(cr.valor_recebido));
      if (baixado > 0) {
        out.push({ desc, valor: baixado, data: cr.data_recebimento || cr.data_vencimento || '', realizado: true });
      }
      const emAberto = cr.status === 'RECEBIDO'
        ? 0
        : round2(num(cr.valor_final) - num(cr.valor_recebido));
      if (emAberto > 0) {
        out.push({ desc, valor: emAberto, data: cr.data_vencimento || '', realizado: false });
      }
    }
    return out;
  }, [contasReceber]);

  const eventosSaida = useMemo<Evento[]>(() => {
    const out: Evento[] = [];
    for (const cp of contasPagar) {
      if (cp.status === 'CANCELADO') continue;
      const desc = `${cp.fornecedor_nome || '—'} — ${cp.descricao || ''}`;
      const baixado = cp.status === 'PAGO'
        ? round2(num(cp.valor_pago) || num(cp.valor_final))
        : round2(num(cp.valor_pago));
      if (baixado > 0) {
        out.push({ desc, valor: baixado, data: cp.data_pagamento || cp.data_vencimento || '', realizado: true });
      }
      const emAberto = cp.status === 'PAGO'
        ? 0
        : round2(num(cp.valor_final) - num(cp.valor_pago));
      if (emAberto > 0) {
        out.push({ desc, valor: emAberto, data: cp.data_vencimento || '', realizado: false });
      }
    }
    return out;
  }, [contasPagar]);

  const fluxo = useMemo(() => {
    const hoje = hojeISO();
    const today = dataLocal(hoje)!; // ancorado ao meio-dia — imune a fuso
    const lines: FluxoLine[] = [];

    // Constrói a linha do período. `extras` carrega os atrasados, que só
    // entram na PRIMEIRA linha (projeção de cobrança/pagamento imediato).
    const buildLine = (
      periodoId: string,
      label: string,
      isInPeriod: (date: string) => boolean,
      extras?: { entradas: Evento[]; saidas: Evento[] },
    ): FluxoLine => {
      const entradas = [
        ...eventosEntrada.filter(e => e.data && isInPeriod(e.data)),
        ...(extras?.entradas ?? []),
      ];
      const saidas = [
        ...eventosSaida.filter(e => e.data && isInPeriod(e.data)),
        ...(extras?.saidas ?? []),
      ];
      const totalEntradas = somaPor(entradas, e => e.valor);
      const totalSaidas = somaPor(saidas, e => e.valor);
      return {
        periodo: periodoId,
        label,
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: round2(totalEntradas - totalSaidas),
        saldoAcumulado: 0, // preenchido depois
        detalhesEntradas: entradas.map(e => ({ desc: e.desc, valor: e.valor, data: e.data })),
        detalhesSaidas: saidas.map(e => ({ desc: e.desc, valor: e.valor, data: e.data })),
      };
    };

    // Início do primeiro período (mês corrente ou semana corrente).
    let primeiroPeriodoStart: string;
    if (periodo === 'MENSAL') {
      primeiroPeriodoStart = `${mesDe(hoje)}-01`;
    } else {
      const ws = dataLocal(hoje)!;
      ws.setDate(ws.getDate() - ws.getDay());
      primeiroPeriodoStart = paraISO(ws);
    }

    // Linha base = saldo_inicial + APENAS movimento realizado anterior ao
    // primeiro período. Somar pendência vencida aqui inflava o saldo inicial
    // com dinheiro que nunca entrou.
    const linhaBase = round2(
      somaPor(contasBancarias, c => c.saldo_inicial)
      + somaPor(eventosEntrada.filter(e => e.realizado && e.data && e.data < primeiroPeriodoStart), e => e.valor)
      - somaPor(eventosSaida.filter(e => e.realizado && e.data && e.data < primeiroPeriodoStart), e => e.valor),
    );

    // Atrasados = em aberto com vencimento anterior ao primeiro período.
    // Viram projeção do primeiro período (é quando se espera resolver).
    const marcarAtraso = (e: Evento): Evento => ({ ...e, desc: `${e.desc} (em atraso)` });
    const atrasadosEntrada = eventosEntrada
      .filter(e => !e.realizado && e.data && e.data < primeiroPeriodoStart)
      .map(marcarAtraso);
    const atrasadosSaida = eventosSaida
      .filter(e => !e.realizado && e.data && e.data < primeiroPeriodoStart)
      .map(marcarAtraso);

    if (periodo === 'MENSAL') {
      for (let i = 0; i < meses; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1, 12, 0, 0, 0);
        const ym = mesDe(paraISO(d));
        const line = buildLine(
          ym,
          getMonthLabel(ym),
          (date) => mesDe(date) === ym,
          i === 0 ? { entradas: atrasadosEntrada, saidas: atrasadosSaida } : undefined,
        );
        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : linhaBase;
        line.saldoAcumulado = round2(prevAcum + line.saldo);
        lines.push(line);
      }
    } else {
      const weeks = meses * 4;
      for (let i = 0; i < weeks; i++) {
        const ws = dataLocal(hoje)!;
        ws.setDate(ws.getDate() - ws.getDay() + i * 7);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        const startStr = paraISO(ws);
        const endStr = paraISO(we);
        const line = buildLine(
          startStr,
          getWeekRange(ws),
          (date) => dentroDoPeriodo(date, startStr, endStr),
          i === 0 ? { entradas: atrasadosEntrada, saidas: atrasadosSaida } : undefined,
        );
        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : linhaBase;
        line.saldoAcumulado = round2(prevAcum + line.saldo);
        lines.push(line);
      }
    }

    return lines;
  }, [eventosEntrada, eventosSaida, contasBancarias, periodo, meses]);

  // KPIs "Previstas" = tudo que ainda está em aberto (saldo devedor das
  // parciais incluído), em qualquer data.
  const totals = useMemo(() => ({
    entradas: somaPor(eventosEntrada.filter(e => !e.realizado), e => e.valor),
    saidas: somaPor(eventosSaida.filter(e => !e.realizado), e => e.valor),
  }), [eventosEntrada, eventosSaida]);

  // Visual bar scale
  const maxVal = useMemo(() =>
    Math.max(...fluxo.map(f => Math.max(f.entradas, f.saidas)), 1),
    [fluxo]
  );

  if (loading) {
    return (
      <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6 flex items-center justify-center">
        <p className="text-[var(--t-text-secondary)]">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header padronizado MinimalPageHead */}
        <MinimalPageHead
          title="Fluxo de caixa projetado"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Projeção de entradas e saídas com base nos lançamentos pendentes</p>}
          actions={
            <>
              <select
                value={periodo}
                onChange={e => setPeriodo(e.target.value as Periodo)}
                className="h-[34px] px-3 text-[12px] border"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                <option value="SEMANAL">Semanal</option>
                <option value="MENSAL">Mensal</option>
              </select>
              <select
                value={meses}
                onChange={e => setMeses(parseInt(e.target.value))}
                className="h-[34px] px-3 text-[12px] border"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
              </select>
              {projecaoFunis.count > 0 && (
                <label className="flex items-center gap-2 h-[34px] px-3 border border-dashed text-[12px] cursor-pointer" style={{ borderColor: 'var(--ink-3)', color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={incluirFunis}
                    onChange={e => setIncluirFunis(e.target.checked)}
                  />
                  Incluir projeção de funis ({projecaoFunis.count})
                </label>
              )}
            </>
          }
        />

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Wallet className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Saldo Atual</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(saldoAtual)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <ArrowUpCircle className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Entradas Previstas</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(totals.entradas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <ArrowDownCircle className="w-8 h-8 text-[var(--t-red)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Saídas Previstas</p>
                <p className="text-xl font-bold text-[var(--t-red)]">{BRL(totals.saidas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <BarChart3 className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Saldo Projetado</p>
                <p className={`text-xl font-bold ${fluxo.length > 0 && fluxo[fluxo.length - 1].saldoAcumulado >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                  {fluxo.length > 0 ? BRL(fluxo[fluxo.length - 1].saldoAcumulado) : '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Flow Chart (table with inline bars) */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--t-green)]" />
              Projeção por Período
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                    <th className="text-left px-4 py-3">Período</th>
                    <th className="text-right px-4 py-3">Entradas</th>
                    <th className="text-right px-4 py-3">Saídas</th>
                    <th className="px-4 py-3 w-64">Visual</th>
                    <th className="text-right px-4 py-3">Saldo</th>
                    <th className="text-right px-4 py-3">Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {fluxo.map((f, idx) => (
                    <>
                      <tr
                        key={f.periodo}
                        className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === f.periodo ? null : f.periodo)}
                      >
                        <td className="px-4 py-3 font-medium text-[var(--t-text)]">{f.label}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-green)]">{BRL(f.entradas)}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-red)]">{BRL(f.saidas)}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="w-full bg-[var(--t-bg)] rounded-full h-2 relative">
                                <div className="bg-[var(--t-green)] h-2 rounded-full" style={{ width: `${divSegura(f.entradas, maxVal) * 100}%` }} />
                                {incluirFunis && projecaoFunis.receita > 0 && (
                                  <div
                                    className="absolute inset-y-0 left-0 h-2 rounded-full border border-dashed border-[var(--t-green)] pointer-events-none"
                                    style={{ width: `${Math.min(100, divSegura(f.entradas + projecaoFunis.receita, maxVal) * 100)}%` }}
                                    title={`+ ${BRL(projecaoFunis.receita)} de projeção de funis`}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-full bg-[var(--t-bg)] rounded-full h-2 relative">
                                <div className="bg-[var(--t-red)] h-2 rounded-full" style={{ width: `${divSegura(f.saidas, maxVal) * 100}%` }} />
                                {incluirFunis && projecaoFunis.investimento > 0 && (
                                  <div
                                    className="absolute inset-y-0 left-0 h-2 rounded-full border border-dashed border-[var(--t-red)] pointer-events-none"
                                    style={{ width: `${Math.min(100, divSegura(f.saidas + projecaoFunis.investimento, maxVal) * 100)}%` }}
                                    title={`+ ${BRL(projecaoFunis.investimento)} de investimento projetado`}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${f.saldo >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                          {BRL(f.saldo)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${f.saldoAcumulado >= 0 ? 'text-[var(--t-text)]' : 'text-[var(--t-red)]'}`}>
                          {BRL(f.saldoAcumulado)}
                          {f.saldoAcumulado < 0 && (
                            <Badge className="bg-[var(--t-red-bg)] text-[var(--t-red)] border-0 text-[10px] ml-1">Negativo</Badge>
                          )}
                        </td>
                      </tr>

                      {/* Expanded details */}
                      {expandedRow === f.periodo && (f.detalhesEntradas.length > 0 || f.detalhesSaidas.length > 0) && (
                        <tr key={`${f.periodo}-detail`}>
                          <td colSpan={6} className="bg-[var(--t-bg)] px-8 py-4">
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <p className="text-xs text-[var(--t-green)] uppercase font-medium mb-2 flex items-center gap-1">
                                  <TrendingUp className="w-3 h-3" /> Entradas ({f.detalhesEntradas.length})
                                </p>
                                {f.detalhesEntradas.length === 0 ? (
                                  <p className="text-xs text-[var(--t-text-muted)]">Nenhuma entrada</p>
                                ) : (
                                  <div className="space-y-1">
                                    {f.detalhesEntradas.map((d, i) => (
                                      <div key={i} className="flex justify-between text-xs">
                                        <span className="text-[var(--t-text-secondary)] truncate max-w-[250px]">{d.desc}</span>
                                        <span className="font-mono text-[var(--t-green)]">{BRL(d.valor)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-[var(--t-red)] uppercase font-medium mb-2 flex items-center gap-1">
                                  <TrendingDown className="w-3 h-3" /> Saídas ({f.detalhesSaidas.length})
                                </p>
                                {f.detalhesSaidas.length === 0 ? (
                                  <p className="text-xs text-[var(--t-text-muted)]">Nenhuma saída</p>
                                ) : (
                                  <div className="space-y-1">
                                    {f.detalhesSaidas.map((d, i) => (
                                      <div key={i} className="flex justify-between text-xs">
                                        <span className="text-[var(--t-text-secondary)] truncate max-w-[250px]">{d.desc}</span>
                                        <span className="font-mono text-[var(--t-red)]">{BRL(d.valor)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <MinimalFooter pageId="fluxo de caixa" />
      </div>
    </div>
  );
}
