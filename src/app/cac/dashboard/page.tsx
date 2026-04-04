'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaPagar, VendaCRM, CACMensal, PlanoContas } from '@/lib/crm-types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Target, TrendingUp, TrendingDown, Users, DollarSign, RefreshCw,
  BarChart3, ArrowUpRight, ArrowDownRight, Calculator,
} from 'lucide-react';
import Link from 'next/link';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v.toFixed(1)}%`;

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function CACDashboardPage() {
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [cacHistorico, setCacHistorico] = useState<CACMensal[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');

  async function load() {
    setLoading(true);
    const [cp, v, cac, pc] = await Promise.all([
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<CACMensal>('cac-mensal'),
      loadEntities<PlanoContas>('plano-contas'),
    ]);
    setContasPagar(cp);
    setVendas(v);
    setCacHistorico(cac);
    setPlanoContas(pc);

    const now = new Date();
    setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Calculate CAC for a given month from raw data
  const monthData = useMemo(() => {
    if (!selectedMonth) return null;

    // Filter contas a pagar for this month
    const monthContas = contasPagar.filter(c => {
      const m = c.data_vencimento?.substring(0, 7);
      return m === selectedMonth && (c.status === 'PAGO' || c.status === 'PENDENTE');
    });

    const despesasComerciais = monthContas.filter(c => c.is_custo_comercial);
    const despesasFixas = monthContas.filter(c => c.natureza_custo === 'FIXO');
    const despesasVariaveis = monthContas.filter(c => c.natureza_custo === 'VARIAVEL');

    const totalComercial = despesasComerciais.reduce((s, c) => s + c.valor_final, 0);
    const totalFixas = despesasFixas.reduce((s, c) => s + c.valor_final, 0);
    const totalVariaveis = despesasVariaveis.reduce((s, c) => s + c.valor_final, 0);

    // Sales for this month
    const monthVendas = vendas.filter(v => {
      const m = v.data_venda?.substring(0, 7);
      return m === selectedMonth && v.status !== 'CANCELADO';
    });

    const totalVendas = monthVendas.reduce((s, v) => s + v.valor_final, 0);
    const qtdVendas = monthVendas.length;

    // Unique new clients this month
    const clienteIds = new Set(monthVendas.map(v => v.cliente_id).filter(Boolean));
    // Simple heuristic: count unique clients from this month's sales
    // In a real system, you'd check if the client had any previous sales
    const qtdClientesNovos = clienteIds.size || 1; // avoid div/0

    const cac = qtdClientesNovos > 0 ? totalComercial / qtdClientesNovos : 0;
    const ticketMedio = qtdVendas > 0 ? totalVendas / qtdVendas : 0;
    const roi = totalComercial > 0 ? ((totalVendas - totalComercial) / totalComercial) * 100 : 0;

    // Breakdown by category
    const categoryMap = new Map<string, { nome: string; valor: number; natureza: string }>();
    for (const c of despesasComerciais) {
      const catId = c.categoria_id || 'sem-categoria';
      const catNome = planoContas.find(p => p.id === catId)?.nome || c.descricao || 'Sem Categoria';
      const existing = categoryMap.get(catId) || { nome: catNome, valor: 0, natureza: c.natureza_custo || '' };
      existing.valor += c.valor_final;
      categoryMap.set(catId, existing);
    }

    return {
      totalComercial,
      totalFixas,
      totalVariaveis,
      totalVendas,
      qtdVendas,
      qtdClientesNovos,
      cac,
      ticketMedio,
      roi,
      detalhamento: Array.from(categoryMap.entries()).map(([id, d]) => ({
        categoria_id: id,
        categoria_nome: d.nome,
        natureza: d.natureza,
        valor: d.valor,
      })),
    };
  }, [selectedMonth, contasPagar, vendas, planoContas]);

  // Save calculated CAC to database
  async function handleSaveCAC() {
    if (!monthData || !selectedMonth) return;
    setCalculating(true);

    const cacMensal: CACMensal = {
      id: generateId(),
      mes: selectedMonth,
      total_despesas_comerciais: monthData.totalComercial,
      total_despesas_fixas: monthData.totalFixas,
      total_despesas_variaveis: monthData.totalVariaveis,
      total_vendas: monthData.totalVendas,
      quantidade_clientes_novos: monthData.qtdClientesNovos,
      quantidade_vendas: monthData.qtdVendas,
      cac: monthData.cac,
      ticket_medio: monthData.ticketMedio,
      roi: monthData.roi,
      detalhamento: monthData.detalhamento.map(d => ({
        categoria_id: d.categoria_id,
        categoria_nome: d.categoria_nome,
        natureza: d.natureza as 'FIXO' | 'VARIAVEL' | 'COMPRA_UNICA',
        valor: d.valor,
      })),
      calculado_em: new Date().toISOString(),
    };

    await saveEntity('cac-mensal', cacMensal);
    setCalculating(false);
    load();
  }

  // Available months
  const allMonths = useMemo(() => {
    const months = new Set<string>();
    contasPagar.forEach(c => {
      const m = c.data_vencimento?.substring(0, 7);
      if (m) months.add(m);
    });
    vendas.forEach(v => {
      const m = v.data_venda?.substring(0, 7);
      if (m) months.add(m);
    });
    return [...months].sort().reverse();
  }, [contasPagar, vendas]);

  // Historical comparison
  const prevMonth = useMemo(() => {
    if (!selectedMonth) return null;
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [selectedMonth]);

  const prevCac = cacHistorico.find(c => c.mes === prevMonth);

  const cacTrend = prevCac && monthData
    ? ((monthData.cac - prevCac.cac) / (prevCac.cac || 1)) * 100
    : null;

  if (loading) {
    return (
      <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6 flex items-center justify-center">
        <p className="text-[var(--t-text-secondary)]">Carregando dados...</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">CAC — Dashboard</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Custo de Aquisição do Cliente calculado automaticamente</p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              {allMonths.map(m => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
            </select>
            <Button
              onClick={handleSaveCAC}
              disabled={calculating}
              className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${calculating ? 'animate-spin' : ''}`} />
              {calculating ? 'Calculando...' : 'Salvar Cálculo'}
            </Button>
          </div>
        </div>

        {monthData && (
          <>
            {/* Main KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <Target className="w-5 h-5 text-[var(--t-green)]" />
                    {cacTrend !== null && (
                      <Badge className={`${cacTrend <= 0 ? 'bg-[var(--t-green-bg)] text-[var(--t-green)]' : 'bg-[var(--t-red-bg)] text-[var(--t-red)]'} border-0 text-xs flex items-center gap-0.5`}>
                        {cacTrend <= 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {Math.abs(cacTrend).toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-[var(--t-text)]">{BRL(monthData.cac)}</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">CAC do Mês</p>
                </CardContent>
              </Card>

              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <DollarSign className="w-5 h-5 text-[var(--t-blue)]" />
                  </div>
                  <p className="text-2xl font-bold text-[var(--t-text)]">{BRL(monthData.ticketMedio)}</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">Ticket Médio</p>
                </CardContent>
              </Card>

              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <TrendingUp className="w-5 h-5 text-[var(--t-amber)]" />
                  </div>
                  <p className={`text-2xl font-bold ${monthData.roi >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                    {PCT(monthData.roi)}
                  </p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">ROI Comercial</p>
                </CardContent>
              </Card>

              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <Users className="w-5 h-5 text-purple-400" />
                  </div>
                  <p className="text-2xl font-bold text-[var(--t-text)]">{monthData.qtdClientesNovos}</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">Clientes Novos</p>
                </CardContent>
              </Card>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Expenses Breakdown */}
              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[var(--t-green)]" />
                    Composição dos Custos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Summary bars */}
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[var(--t-text-secondary)]">Custos Comerciais (CAC)</span>
                          <span className="text-[var(--t-text)] font-medium">{BRL(monthData.totalComercial)}</span>
                        </div>
                        <div className="w-full bg-[var(--t-bg)] rounded-full h-2">
                          <div
                            className="bg-[var(--t-green)] h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (monthData.totalComercial / (monthData.totalFixas + monthData.totalVariaveis || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[var(--t-text-secondary)]">Custos Fixos</span>
                          <span className="text-[var(--t-text)] font-medium">{BRL(monthData.totalFixas)}</span>
                        </div>
                        <div className="w-full bg-[var(--t-bg)] rounded-full h-2">
                          <div
                            className="bg-[var(--t-blue)] h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (monthData.totalFixas / (monthData.totalFixas + monthData.totalVariaveis || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[var(--t-text-secondary)]">Custos Variáveis</span>
                          <span className="text-[var(--t-text)] font-medium">{BRL(monthData.totalVariaveis)}</span>
                        </div>
                        <div className="w-full bg-[var(--t-bg)] rounded-full h-2">
                          <div
                            className="bg-[var(--t-amber)] h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (monthData.totalVariaveis / (monthData.totalFixas + monthData.totalVariaveis || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Detailed breakdown */}
                    {monthData.detalhamento.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--t-border)]">
                        <p className="text-xs text-[var(--t-text-muted)] uppercase mb-3">Detalhamento Custos Comerciais</p>
                        <div className="space-y-2">
                          {monthData.detalhamento.sort((a, b) => b.valor - a.valor).map((d, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-[var(--t-text-secondary)]">{d.categoria_nome}</span>
                              <span className="text-[var(--t-text)] font-mono">{BRL(d.valor)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Revenue & Efficiency */}
              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-[var(--t-green)]" />
                    Métricas de Eficiência
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-[var(--t-bg)]">
                        <p className="text-xs text-[var(--t-text-muted)] uppercase">Total Vendas</p>
                        <p className="text-lg font-bold text-[var(--t-green)] mt-1">{BRL(monthData.totalVendas)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--t-bg)]">
                        <p className="text-xs text-[var(--t-text-muted)] uppercase">Qtd. Vendas</p>
                        <p className="text-lg font-bold text-[var(--t-text)] mt-1">{monthData.qtdVendas}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--t-bg)]">
                        <p className="text-xs text-[var(--t-text-muted)] uppercase">Custo / Venda</p>
                        <p className="text-lg font-bold text-[var(--t-amber)] mt-1">
                          {monthData.qtdVendas > 0 ? BRL(monthData.totalComercial / monthData.qtdVendas) : '—'}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--t-bg)]">
                        <p className="text-xs text-[var(--t-text-muted)] uppercase">LTV / CAC</p>
                        <p className="text-lg font-bold text-[var(--t-blue)] mt-1">
                          {monthData.cac > 0 ? `${(monthData.ticketMedio / monthData.cac).toFixed(1)}x` : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-[var(--t-border)]">
                      <p className="text-xs text-[var(--t-text-muted)] uppercase mb-3">Fórmula CAC</p>
                      <div className="p-3 rounded-lg bg-[var(--t-bg)] font-mono text-sm text-center">
                        <span className="text-[var(--t-text-secondary)]">CAC = </span>
                        <span className="text-[var(--t-amber)]">{BRL(monthData.totalComercial)}</span>
                        <span className="text-[var(--t-text-muted)]"> ÷ </span>
                        <span className="text-purple-400">{monthData.qtdClientesNovos} clientes</span>
                        <span className="text-[var(--t-text-muted)]"> = </span>
                        <span className="text-[var(--t-green)] font-bold">{BRL(monthData.cac)}</span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <Link href="/cac/cenarios">
                        <Button variant="outline" className="w-full border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]">
                          <TrendingUp className="w-4 h-4 mr-2" /> Simular Cenários
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Historical CAC */}
            {cacHistorico.length > 0 && (
              <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-[var(--t-green)]" />
                    Histórico CAC
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                          <th className="text-left px-4 py-3">Mês</th>
                          <th className="text-right px-4 py-3">CAC</th>
                          <th className="text-right px-4 py-3">Custos Comerciais</th>
                          <th className="text-right px-4 py-3">Vendas</th>
                          <th className="text-right px-4 py-3">Clientes</th>
                          <th className="text-right px-4 py-3">Ticket Médio</th>
                          <th className="text-right px-4 py-3">ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cacHistorico.sort((a, b) => b.mes.localeCompare(a.mes)).map(h => (
                          <tr key={h.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)]">
                            <td className="px-4 py-3 font-medium text-[var(--t-text)]">{getMonthLabel(h.mes)}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-green)]">{BRL(h.cac)}</td>
                            <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(h.total_despesas_comerciais)}</td>
                            <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(h.total_vendas)}</td>
                            <td className="px-4 py-3 text-right text-[var(--t-text-secondary)]">{h.quantidade_clientes_novos}</td>
                            <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(h.ticket_medio)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={h.roi >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}>
                                {PCT(h.roi)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
