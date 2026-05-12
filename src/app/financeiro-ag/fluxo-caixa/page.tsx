'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, ContaBancaria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle, Wallet,
  Calendar, BarChart3,
} from 'lucide-react';
import type { FunilPayload } from '@/lib/funil-types';

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
      receita += kpis.receita_liquida ?? kpis.receita_bruta ?? 0;
      investimento += kpis.investimento_total ?? 0;
    }
    // Se for semanal, dividir por 4 (aproximação mês/semana)
    const divisor = periodo === 'MENSAL' ? 1 : 4;
    return {
      count: ativos.length,
      receita: receita / divisor,
      investimento: investimento / divisor,
    };
  }, [funis, periodo]);

  // Saldo computado: saldo_inicial + recebido - pago. Sempre bate com
  // o histórico de baixas, independente de saldo_atual persistido.
  const saldoAtual = useMemo(() =>
    calcularSaldoBancario(contasBancarias, contasReceber, contasPagar),
    [contasBancarias, contasReceber, contasPagar]
  );

  const fluxo = useMemo(() => {
    const today = new Date();
    const lines: FluxoLine[] = [];

    if (periodo === 'MENSAL') {
      for (let i = 0; i < meses; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = getMonthLabel(ym);

        const entradas = contasReceber.filter(cr =>
          cr.data_vencimento?.substring(0, 7) === ym && cr.status !== 'CANCELADO' && cr.status !== 'RECEBIDO'
        );
        const saidas = contasPagar.filter(cp =>
          cp.data_vencimento?.substring(0, 7) === ym && cp.status !== 'CANCELADO' && cp.status !== 'PAGO'
        );

        const totalEntradas = entradas.reduce((s, cr) => s + cr.valor_final, 0);
        const totalSaidas = saidas.reduce((s, cp) => s + cp.valor_final, 0);
        const saldo = totalEntradas - totalSaidas;

        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : saldoAtual;

        lines.push({
          periodo: ym,
          label,
          entradas: totalEntradas,
          saidas: totalSaidas,
          saldo,
          saldoAcumulado: prevAcum + saldo,
          detalhesEntradas: entradas.map(cr => ({
            desc: `${cr.cliente_nome} — ${cr.descricao}`,
            valor: cr.valor_final,
            data: cr.data_vencimento,
          })),
          detalhesSaidas: saidas.map(cp => ({
            desc: `${cp.fornecedor_nome} — ${cp.descricao}`,
            valor: cp.valor_final,
            data: cp.data_vencimento,
          })),
        });
      }
    } else {
      // Weekly
      const weeks = meses * 4;
      for (let i = 0; i < weeks; i++) {
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const startStr = weekStart.toISOString().split('T')[0];
        const endStr = weekEnd.toISOString().split('T')[0];
        const label = getWeekRange(weekStart);

        const entradas = contasReceber.filter(cr =>
          cr.data_vencimento >= startStr && cr.data_vencimento <= endStr &&
          cr.status !== 'CANCELADO' && cr.status !== 'RECEBIDO'
        );
        const saidas = contasPagar.filter(cp =>
          cp.data_vencimento >= startStr && cp.data_vencimento <= endStr &&
          cp.status !== 'CANCELADO' && cp.status !== 'PAGO'
        );

        const totalEntradas = entradas.reduce((s, cr) => s + cr.valor_final, 0);
        const totalSaidas = saidas.reduce((s, cp) => s + cp.valor_final, 0);
        const saldo = totalEntradas - totalSaidas;

        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : saldoAtual;

        lines.push({
          periodo: startStr,
          label,
          entradas: totalEntradas,
          saidas: totalSaidas,
          saldo,
          saldoAcumulado: prevAcum + saldo,
          detalhesEntradas: entradas.map(cr => ({
            desc: `${cr.cliente_nome} — ${cr.descricao}`,
            valor: cr.valor_final,
            data: cr.data_vencimento,
          })),
          detalhesSaidas: saidas.map(cp => ({
            desc: `${cp.fornecedor_nome} — ${cp.descricao}`,
            valor: cp.valor_final,
            data: cp.data_vencimento,
          })),
        });
      }
    }

    return lines;
  }, [contasReceber, contasPagar, saldoAtual, periodo, meses]);

  const totals = useMemo(() => ({
    entradas: fluxo.reduce((s, f) => s + f.entradas, 0),
    saidas: fluxo.reduce((s, f) => s + f.saidas, 0),
  }), [fluxo]);

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

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Fluxo de Caixa Projetado</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Projeção de entradas e saídas com base nos lançamentos pendentes</p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={periodo}
              onChange={e => setPeriodo(e.target.value as Periodo)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              <option value="SEMANAL">Semanal</option>
              <option value="MENSAL">Mensal</option>
            </select>
            <select
              value={meses}
              onChange={e => setMeses(parseInt(e.target.value))}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              <option value={3}>3 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
            {projecaoFunis.count > 0 && (
              <label className="flex items-center gap-2 px-3 py-2 rounded border border-dashed border-[var(--t-green)] text-sm text-[var(--t-text)] cursor-pointer hover:bg-[var(--t-green-bg)]/30">
                <input
                  type="checkbox"
                  checked={incluirFunis}
                  onChange={e => setIncluirFunis(e.target.checked)}
                  className="accent-[var(--t-green)]"
                />
                Incluir projeção de funis ({projecaoFunis.count})
              </label>
            )}
          </div>
        </div>

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
                                <div className="bg-[var(--t-green)] h-2 rounded-full" style={{ width: `${(f.entradas / maxVal) * 100}%` }} />
                                {incluirFunis && projecaoFunis.receita > 0 && (
                                  <div
                                    className="absolute inset-y-0 left-0 h-2 rounded-full border border-dashed border-[var(--t-green)] pointer-events-none"
                                    style={{ width: `${Math.min(100, ((f.entradas + projecaoFunis.receita) / maxVal) * 100)}%` }}
                                    title={`+ ${BRL(projecaoFunis.receita)} de projeção de funis`}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-full bg-[var(--t-bg)] rounded-full h-2 relative">
                                <div className="bg-[var(--t-red)] h-2 rounded-full" style={{ width: `${(f.saidas / maxVal) * 100}%` }} />
                                {incluirFunis && projecaoFunis.investimento > 0 && (
                                  <div
                                    className="absolute inset-y-0 left-0 h-2 rounded-full border border-dashed border-[var(--t-red)] pointer-events-none"
                                    style={{ width: `${Math.min(100, ((f.saidas + projecaoFunis.investimento) / maxVal) * 100)}%` }}
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
      </div>
    </div>
  );
}
