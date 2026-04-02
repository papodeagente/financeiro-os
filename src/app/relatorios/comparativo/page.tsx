'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { exportCSV } from '@/lib/export-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart3, Download, TrendingUp, TrendingDown, Minus,
  ArrowUpCircle, ArrowDownCircle, DollarSign,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

interface MesData {
  mes: string; // YYYY-MM
  label: string;
  receitas: number;
  despesas: number;
  resultado: number;
  qtdReceitas: number;
  qtdDespesas: number;
}

function getMesLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[parseInt(m) - 1]}/${y}`;
}

function getBarHeight(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.max(4, (Math.abs(value) / max) * 180);
}

export default function ComparativoMensalPage() {
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesesExibir, setMesesExibir] = useState(6);

  useEffect(() => {
    Promise.all([
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
    ]).then(([r, p]) => {
      setReceber(r);
      setPagar(p);
      setLoading(false);
    });
  }, []);

  const dados = useMemo(() => {
    const mapMes: Record<string, MesData> = {};

    const ensure = (mes: string) => {
      if (!mapMes[mes]) {
        mapMes[mes] = { mes, label: getMesLabel(mes), receitas: 0, despesas: 0, resultado: 0, qtdReceitas: 0, qtdDespesas: 0 };
      }
    };

    receber.filter(r => r.status === 'RECEBIDO').forEach(r => {
      const dt = r.data_recebimento || r.data_vencimento;
      if (!dt) return;
      const mes = dt.substring(0, 7);
      ensure(mes);
      mapMes[mes].receitas += r.valor_final;
      mapMes[mes].qtdReceitas += 1;
    });

    pagar.filter(p => p.status === 'PAGO').forEach(p => {
      const dt = p.data_pagamento || p.data_vencimento;
      if (!dt) return;
      const mes = dt.substring(0, 7);
      ensure(mes);
      mapMes[mes].despesas += p.valor_final;
      mapMes[mes].qtdDespesas += 1;
    });

    Object.values(mapMes).forEach(m => {
      m.resultado = m.receitas - m.despesas;
    });

    return Object.values(mapMes)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .slice(-mesesExibir);
  }, [receber, pagar, mesesExibir]);

  const maxValor = useMemo(() => {
    return Math.max(...dados.map(d => Math.max(d.receitas, d.despesas)), 1);
  }, [dados]);

  const totais = useMemo(() => {
    const totalReceitas = dados.reduce((s, d) => s + d.receitas, 0);
    const totalDespesas = dados.reduce((s, d) => s + d.despesas, 0);
    return {
      receitas: totalReceitas,
      despesas: totalDespesas,
      resultado: totalReceitas - totalDespesas,
      mediaReceitas: dados.length ? totalReceitas / dados.length : 0,
      mediaDespesas: dados.length ? totalDespesas / dados.length : 0,
    };
  }, [dados]);

  const variacoes = useMemo(() => {
    if (dados.length < 2) return null;
    const atual = dados[dados.length - 1];
    const anterior = dados[dados.length - 2];
    const varReceita = anterior.receitas > 0
      ? ((atual.receitas - anterior.receitas) / anterior.receitas) * 100 : 0;
    const varDespesa = anterior.despesas > 0
      ? ((atual.despesas - anterior.despesas) / anterior.despesas) * 100 : 0;
    const varResultado = anterior.resultado !== 0
      ? ((atual.resultado - anterior.resultado) / Math.abs(anterior.resultado)) * 100 : 0;
    return { varReceita, varDespesa, varResultado, mesAtual: atual.label, mesAnterior: anterior.label };
  }, [dados]);

  const handleExport = () => {
    const headers = ['Mês', 'Receitas (R$)', 'Despesas (R$)', 'Resultado (R$)', 'Qtd Receitas', 'Qtd Despesas'];
    const rows = dados.map(d => [
      d.label,
      d.receitas.toFixed(2).replace('.', ','),
      d.despesas.toFixed(2).replace('.', ','),
      d.resultado.toFixed(2).replace('.', ','),
      String(d.qtdReceitas),
      String(d.qtdDespesas),
    ]);
    rows.push([
      'TOTAL',
      totais.receitas.toFixed(2).replace('.', ','),
      totais.despesas.toFixed(2).replace('.', ','),
      totais.resultado.toFixed(2).replace('.', ','),
      String(dados.reduce((s, d) => s + d.qtdReceitas, 0)),
      String(dados.reduce((s, d) => s + d.qtdDespesas, 0)),
    ]);
    exportCSV('comparativo-mensal', headers, rows);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-[var(--t-green)]" />
            </div>
            Comparativo Mensal
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Evolucao de receitas e despesas mes a mes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={mesesExibir}
            onChange={(e) => setMesesExibir(Number(e.target.value))}
            className="bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
          >
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={24}>24 meses</option>
          </select>
          <Button onClick={handleExport} variant="outline" size="sm" className="gap-2 border-[var(--t-border)] text-[var(--t-text)]">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--t-text-secondary)]">Total Receitas</span>
              <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400">{BRL(totais.receitas)}</div>
            <div className="text-xs text-[var(--t-text-muted)] mt-1">Media: {BRL(totais.mediaReceitas)}/mes</div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--t-text-secondary)]">Total Despesas</span>
              <ArrowDownCircle className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-xl font-bold text-red-400">{BRL(totais.despesas)}</div>
            <div className="text-xs text-[var(--t-text-muted)] mt-1">Media: {BRL(totais.mediaDespesas)}/mes</div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--t-text-secondary)]">Resultado</span>
              <DollarSign className="w-4 h-4 text-[var(--t-green)]" />
            </div>
            <div className={`text-xl font-bold ${totais.resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {BRL(totais.resultado)}
            </div>
            <div className="text-xs text-[var(--t-text-muted)] mt-1">
              {dados.length} meses analisados
            </div>
          </CardContent>
        </Card>
        {variacoes && (
          <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--t-text-secondary)]">Variacao ({variacoes.mesAnterior} → {variacoes.mesAtual})</span>
                {variacoes.varResultado >= 0
                  ? <TrendingUp className="w-4 h-4 text-emerald-400" />
                  : <TrendingDown className="w-4 h-4 text-red-400" />
                }
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--t-text-secondary)]">Receitas</span>
                  <span className={variacoes.varReceita >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {PCT(variacoes.varReceita)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--t-text-secondary)]">Despesas</span>
                  <span className={variacoes.varDespesa <= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {PCT(variacoes.varDespesa)}
                  </span>
                </div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-[var(--t-text-secondary)]">Resultado</span>
                  <span className={variacoes.varResultado >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {PCT(variacoes.varResultado)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Chart - Bar Chart */}
      <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-[var(--t-text)]">Receitas vs Despesas</CardTitle>
        </CardHeader>
        <CardContent>
          {dados.length === 0 ? (
            <div className="text-center py-12 text-[var(--t-text-muted)]">
              Nenhum dado encontrado no periodo
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex items-end gap-2 min-w-fit px-4 pb-2" style={{ minHeight: 240 }}>
                {dados.map((d) => (
                  <div key={d.mes} className="flex flex-col items-center gap-1" style={{ minWidth: 80 }}>
                    <div className="flex items-end gap-1" style={{ height: 200 }}>
                      {/* Receita bar */}
                      <div className="flex flex-col items-center justify-end" style={{ height: '100%' }}>
                        <span className="text-[9px] text-emerald-400 mb-1 whitespace-nowrap">
                          {d.receitas > 0 ? BRL(d.receitas) : ''}
                        </span>
                        <div
                          className="w-8 rounded-t bg-emerald-500/80 transition-all"
                          style={{ height: getBarHeight(d.receitas, maxValor) }}
                        />
                      </div>
                      {/* Despesa bar */}
                      <div className="flex flex-col items-center justify-end" style={{ height: '100%' }}>
                        <span className="text-[9px] text-red-400 mb-1 whitespace-nowrap">
                          {d.despesas > 0 ? BRL(d.despesas) : ''}
                        </span>
                        <div
                          className="w-8 rounded-t bg-red-500/80 transition-all"
                          style={{ height: getBarHeight(d.despesas, maxValor) }}
                        />
                      </div>
                    </div>
                    <span className="text-[11px] text-[var(--t-text-secondary)] mt-1">{d.label}</span>
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-6 justify-center mt-3 pt-3 border-t border-[var(--t-border)]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-emerald-500/80" />
                  <span className="text-xs text-[var(--t-text-secondary)]">Receitas</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-red-500/80" />
                  <span className="text-xs text-[var(--t-text-secondary)]">Despesas</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resultado Line */}
      <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-[var(--t-text)]">Resultado Mensal (Receitas - Despesas)</CardTitle>
        </CardHeader>
        <CardContent>
          {dados.length === 0 ? (
            <div className="text-center py-12 text-[var(--t-text-muted)]">
              Nenhum dado encontrado no periodo
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="space-y-2 px-2">
                {dados.map((d, i) => {
                  const maxAbs = Math.max(...dados.map(x => Math.abs(x.resultado)), 1);
                  const pct = (Math.abs(d.resultado) / maxAbs) * 100;
                  const prev = i > 0 ? dados[i - 1] : null;
                  const variacao = prev && prev.resultado !== 0
                    ? ((d.resultado - prev.resultado) / Math.abs(prev.resultado)) * 100
                    : null;

                  return (
                    <div key={d.mes} className="flex items-center gap-3">
                      <span className="text-xs text-[var(--t-text-secondary)] w-16 shrink-0">{d.label}</span>
                      <div className="flex-1 h-7 relative">
                        <div
                          className={`h-full rounded ${d.resultado >= 0 ? 'bg-emerald-500/30' : 'bg-red-500/30'}`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                        <span className={`absolute inset-y-0 flex items-center pl-2 text-xs font-medium ${d.resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {BRL(d.resultado)}
                        </span>
                      </div>
                      <div className="w-16 text-right shrink-0">
                        {variacao !== null ? (
                          <span className={`text-[10px] font-medium ${variacao >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {PCT(variacao)}
                          </span>
                        ) : (
                          <Minus className="w-3 h-3 text-[var(--t-text-muted)] ml-auto" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-[var(--t-text)]">Detalhamento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--t-border)]">
                  <th className="text-left py-2 px-3 text-[var(--t-text-secondary)] font-medium">Mes</th>
                  <th className="text-right py-2 px-3 text-[var(--t-text-secondary)] font-medium">Receitas</th>
                  <th className="text-right py-2 px-3 text-[var(--t-text-secondary)] font-medium">Despesas</th>
                  <th className="text-right py-2 px-3 text-[var(--t-text-secondary)] font-medium">Resultado</th>
                  <th className="text-right py-2 px-3 text-[var(--t-text-secondary)] font-medium">Margem</th>
                  <th className="text-right py-2 px-3 text-[var(--t-text-secondary)] font-medium">Var. Resultado</th>
                </tr>
              </thead>
              <tbody>
                {dados.map((d, i) => {
                  const margem = d.receitas > 0 ? ((d.resultado / d.receitas) * 100) : 0;
                  const prev = i > 0 ? dados[i - 1] : null;
                  const variacao = prev && prev.resultado !== 0
                    ? ((d.resultado - prev.resultado) / Math.abs(prev.resultado)) * 100
                    : null;

                  return (
                    <tr key={d.mes} className="border-b border-[var(--t-border)]/50 hover:bg-[var(--t-bg)]/50">
                      <td className="py-2 px-3 text-[var(--t-text)] font-medium">{d.label}</td>
                      <td className="py-2 px-3 text-right text-emerald-400">{BRL(d.receitas)}</td>
                      <td className="py-2 px-3 text-right text-red-400">{BRL(d.despesas)}</td>
                      <td className={`py-2 px-3 text-right font-medium ${d.resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {BRL(d.resultado)}
                      </td>
                      <td className={`py-2 px-3 text-right ${margem >= 0 ? 'text-[var(--t-text)]' : 'text-red-400'}`}>
                        {margem.toFixed(1)}%
                      </td>
                      <td className="py-2 px-3 text-right">
                        {variacao !== null ? (
                          <span className={variacao >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {PCT(variacao)}
                          </span>
                        ) : (
                          <span className="text-[var(--t-text-muted)]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--t-border)]">
                  <td className="py-2 px-3 text-[var(--t-text)] font-bold">Total</td>
                  <td className="py-2 px-3 text-right text-emerald-400 font-bold">{BRL(totais.receitas)}</td>
                  <td className="py-2 px-3 text-right text-red-400 font-bold">{BRL(totais.despesas)}</td>
                  <td className={`py-2 px-3 text-right font-bold ${totais.resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {BRL(totais.resultado)}
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--t-text)] font-bold">
                    {totais.receitas > 0 ? ((totais.resultado / totais.receitas) * 100).toFixed(1) : '0.0'}%
                  </td>
                  <td className="py-2 px-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
