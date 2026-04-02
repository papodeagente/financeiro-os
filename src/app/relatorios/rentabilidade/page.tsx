'use client';

import { useEffect, useState, useMemo } from 'react';
import { VendaCRM, Membro } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { exportCSV } from '@/lib/export-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  PieChart, Download, TrendingUp, DollarSign, Percent, BarChart3,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v.toFixed(1)}%`;

type Agrupamento = 'TIPO_PRODUTO' | 'VENDEDOR' | 'GRUPO' | 'MES';

const TIPO_COLORS: Record<string, string> = {
  AEREO: 'text-blue-400',
  HOTEL: 'text-purple-400',
  PACOTE: 'text-[var(--t-green)]',
  SEGURO: 'text-[var(--t-amber)]',
  RECEPTIVO: 'text-cyan-400',
  CRUZEIRO: 'text-indigo-400',
  CARRO: 'text-orange-400',
  INGRESSO: 'text-pink-400',
  GRUPO: 'text-emerald-400',
  OUTROS: 'text-[var(--t-text-muted)]',
};

export default function RentabilidadePage() {
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [agrupamento, setAgrupamento] = useState<Agrupamento>('TIPO_PRODUTO');

  async function load() {
    setLoading(true);
    const [v, m] = await Promise.all([
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<Membro>('membros'),
    ]);
    setVendas(v);
    setMembros(m);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setDateFrom(`${ym}-01`);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    setDateTo(`${ym}-${lastDay}`);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    vendas.filter(v => {
      if (v.status === 'CANCELADO' || v.status === 'ORCAMENTO') return false;
      if (dateFrom && v.data_venda < dateFrom) return false;
      if (dateTo && v.data_venda > dateTo) return false;
      return true;
    }),
    [vendas, dateFrom, dateTo]
  );

  const totals = useMemo(() => {
    const receita = filtered.reduce((s, v) => s + v.valor_final, 0);
    const custo = filtered.reduce((s, v) => s + v.valor_total_custo, 0);
    const markup = receita - custo;
    const margem = receita > 0 ? (markup / receita) * 100 : 0;
    return { receita, custo, markup, margem, qtd: filtered.length };
  }, [filtered]);

  // Grouped data
  const grouped = useMemo(() => {
    type Item = { key: string; label: string; receita: number; custo: number; markup: number; margem: number; qtd: number };
    const map = new Map<string, Item>();

    if (agrupamento === 'TIPO_PRODUTO') {
      // Group by individual product types across all sales
      for (const venda of filtered) {
        for (const prod of (venda.produtos || [])) {
          const key = prod.tipo || 'OUTROS';
          const existing = map.get(key) || { key, label: key, receita: 0, custo: 0, markup: 0, margem: 0, qtd: 0 };
          existing.receita += prod.valor_venda;
          existing.custo += prod.valor_custo;
          existing.qtd++;
          map.set(key, existing);
        }
        // If no products, group by sale type
        if (!venda.produtos || venda.produtos.length === 0) {
          const key = venda.tipo || 'AVULSA';
          const existing = map.get(key) || { key, label: key, receita: 0, custo: 0, markup: 0, margem: 0, qtd: 0 };
          existing.receita += venda.valor_final;
          existing.custo += venda.valor_total_custo;
          existing.qtd++;
          map.set(key, existing);
        }
      }
    } else if (agrupamento === 'VENDEDOR') {
      for (const venda of filtered) {
        const vendedor = membros.find(m => m.id === venda.vendedor_id);
        const key = venda.vendedor_id || 'sem';
        const label = vendedor?.nome || 'Sem Vendedor';
        const existing = map.get(key) || { key, label, receita: 0, custo: 0, markup: 0, margem: 0, qtd: 0 };
        existing.receita += venda.valor_final;
        existing.custo += venda.valor_total_custo;
        existing.qtd++;
        map.set(key, existing);
      }
    } else if (agrupamento === 'GRUPO') {
      for (const venda of filtered) {
        const key = venda.grupo_id || 'avulsa';
        const label = venda.grupo_id ? `Grupo ${venda.grupo_id.substring(0, 8)}` : 'Vendas Avulsas';
        const existing = map.get(key) || { key, label, receita: 0, custo: 0, markup: 0, margem: 0, qtd: 0 };
        existing.receita += venda.valor_final;
        existing.custo += venda.valor_total_custo;
        existing.qtd++;
        map.set(key, existing);
      }
    } else {
      // MES
      for (const venda of filtered) {
        const ym = venda.data_venda?.substring(0, 7) || '';
        const [y, m] = ym.split('-');
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const label = ym ? `${months[parseInt(m) - 1]}/${y}` : 'Sem Data';
        const existing = map.get(ym) || { key: ym, label, receita: 0, custo: 0, markup: 0, margem: 0, qtd: 0 };
        existing.receita += venda.valor_final;
        existing.custo += venda.valor_total_custo;
        existing.qtd++;
        map.set(ym, existing);
      }
    }

    // Calculate markup and margin
    for (const item of map.values()) {
      item.markup = item.receita - item.custo;
      item.margem = item.receita > 0 ? (item.markup / item.receita) * 100 : 0;
    }

    return [...map.values()].sort((a, b) => b.markup - a.markup);
  }, [filtered, agrupamento, membros]);

  function handleExport() {
    const headers = ['Grupo', 'Receita', 'Custo', 'Markup', 'Margem %', 'Qtd'];
    const rows = grouped.map(g => [g.label, g.receita.toFixed(2), g.custo.toFixed(2), g.markup.toFixed(2), g.margem.toFixed(1), String(g.qtd)]);
    rows.push(['TOTAL', totals.receita.toFixed(2), totals.custo.toFixed(2), totals.markup.toFixed(2), totals.margem.toFixed(1), String(totals.qtd)]);
    exportCSV(`rentabilidade-${agrupamento.toLowerCase()}-${dateFrom}-${dateTo}`, headers, rows);
  }

  if (loading) {
    return <div className="min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] p-6 flex items-center justify-center"><p className="text-[var(--t-text-secondary)]">Carregando...</p></div>;
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Rentabilidade</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Análise de margem e lucro por produto, vendedor e grupo</p>
          </div>
          <Button onClick={handleExport} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
        </div>

        {/* Filters */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">De</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Até</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Agrupar por</label>
              <select value={agrupamento} onChange={e => setAgrupamento(e.target.value as Agrupamento)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="TIPO_PRODUTO">Tipo de Produto</option>
                <option value="VENDEDOR">Vendedor</option>
                <option value="GRUPO">Grupo/Avulsa</option>
                <option value="MES">Mês</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <DollarSign className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Receita</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(totals.receita)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Markup</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(totals.markup)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Percent className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Margem</p>
                <p className="text-xl font-bold text-[var(--t-amber)]">{PCT(totals.margem)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <BarChart3 className="w-8 h-8 text-purple-400 shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Vendas</p>
                <p className="text-xl font-bold text-purple-400">{totals.qtd}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[var(--t-green)]" />
              Rentabilidade por {agrupamento === 'TIPO_PRODUTO' ? 'Produto' : agrupamento === 'VENDEDOR' ? 'Vendedor' : agrupamento === 'GRUPO' ? 'Grupo' : 'Mês'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                    <th className="text-left px-4 py-3">Grupo</th>
                    <th className="text-right px-4 py-3">Receita</th>
                    <th className="text-right px-4 py-3">Custo</th>
                    <th className="text-right px-4 py-3">Markup</th>
                    <th className="px-4 py-3 w-40">Margem</th>
                    <th className="text-center px-4 py-3">Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(g => (
                    <tr key={g.key} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                      <td className={`px-4 py-3 font-medium ${TIPO_COLORS[g.key] || 'text-[var(--t-text)]'}`}>{g.label}</td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(g.receita)}</td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(g.custo)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${g.markup >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(g.markup)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-[var(--t-bg)] rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full ${g.margem >= 20 ? 'bg-[var(--t-green)]' : g.margem >= 10 ? 'bg-[var(--t-amber)]' : 'bg-[var(--t-red)]'}`}
                              style={{ width: `${Math.min(100, Math.max(0, g.margem))}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-[var(--t-text-secondary)] w-12 text-right">{PCT(g.margem)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--t-text-secondary)]">{g.qtd}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--t-border)] bg-[var(--t-bg)]">
                    <td className="px-4 py-3 font-bold text-[var(--t-text)]">TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-text)]">{BRL(totals.receita)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-text)]">{BRL(totals.custo)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${totals.markup >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(totals.markup)}</td>
                    <td className="px-4 py-3"><span className="text-xs font-mono font-bold text-[var(--t-amber)]">{PCT(totals.margem)}</span></td>
                    <td className="px-4 py-3 text-center font-bold text-[var(--t-text)]">{totals.qtd}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
