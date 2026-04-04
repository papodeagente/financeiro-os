'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, PlanoContas, Membro } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { exportCSV } from '@/lib/export-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  FileText, Download, Filter, ArrowUpCircle, ArrowDownCircle,
  DollarSign, TrendingUp, TrendingDown,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type Agrupamento = 'CATEGORIA' | 'FORNECEDOR' | 'VENDEDOR' | 'MES' | 'NENHUM';
type TipoRelatorio = 'RECEBER' | 'PAGAR' | 'AMBOS';

export default function RelatorioFinanceiroPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tipo, setTipo] = useState<TipoRelatorio>('AMBOS');
  const [agrupamento, setAgrupamento] = useState<Agrupamento>('CATEGORIA');
  const [statusFilter, setStatusFilter] = useState('TODOS');

  async function load() {
    setLoading(true);
    const [cr, cp, pc, mb] = await Promise.all([
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<PlanoContas>('plano-contas'),
      loadEntities<Membro>('membros'),
    ]);
    setContasReceber(cr);
    setContasPagar(cp);
    setPlanoContas(pc);
    setMembros(mb);

    // Default: current month
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setDateFrom(`${ym}-01`);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    setDateTo(`${ym}-${lastDay}`);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Filtered data
  const { receber, pagar } = useMemo(() => {
    const filterDate = (d: string) => {
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    };
    const filterStatus = (s: string) => statusFilter === 'TODOS' || s === statusFilter;

    const receber = (tipo === 'PAGAR' ? [] : contasReceber).filter(cr =>
      filterDate(cr.data_vencimento) && filterStatus(cr.status)
    );
    const pagar = (tipo === 'RECEBER' ? [] : contasPagar).filter(cp =>
      filterDate(cp.data_vencimento) && filterStatus(cp.status)
    );
    return { receber, pagar };
  }, [contasReceber, contasPagar, dateFrom, dateTo, tipo, statusFilter]);

  // Totals
  const totalReceber = receber.reduce((s, cr) => s + cr.valor_final, 0);
  const totalPagar = pagar.reduce((s, cp) => s + cp.valor_final, 0);
  const saldo = totalReceber - totalPagar;

  // Grouped data
  const grouped = useMemo(() => {
    type GroupItem = { key: string; label: string; entradas: number; saidas: number; count: number };
    const map = new Map<string, GroupItem>();

    const getKey = (catId: string, fornecedor: string, cliente: string, data: string, isEntrada: boolean): { key: string; label: string } => {
      switch (agrupamento) {
        case 'CATEGORIA': {
          const cat = planoContas.find(c => c.id === catId);
          return { key: catId || 'sem-cat', label: cat ? `${cat.codigo} — ${cat.nome}` : 'Sem Categoria' };
        }
        case 'FORNECEDOR':
          return { key: isEntrada ? (cliente || 'sem') : (fornecedor || 'sem'), label: isEntrada ? (cliente || 'Sem Cliente') : (fornecedor || 'Sem Fornecedor') };
        case 'VENDEDOR':
          return { key: 'geral', label: 'Geral' };
        case 'MES': {
          const ym = data?.substring(0, 7) || '';
          const [y, m] = ym.split('-');
          const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
          return { key: ym, label: ym ? `${months[parseInt(m) - 1]}/${y}` : 'Sem Data' };
        }
        default:
          return { key: 'all', label: 'Todos' };
      }
    };

    for (const cr of receber) {
      const { key, label } = getKey(cr.categoria_id, '', cr.cliente_nome, cr.data_vencimento, true);
      const existing = map.get(key) || { key, label, entradas: 0, saidas: 0, count: 0 };
      existing.entradas += cr.valor_final;
      existing.count++;
      map.set(key, existing);
    }

    for (const cp of pagar) {
      const { key, label } = getKey(cp.categoria_id, cp.fornecedor_nome, '', cp.data_vencimento, false);
      const existing = map.get(key) || { key, label, entradas: 0, saidas: 0, count: 0 };
      existing.saidas += cp.valor_final;
      existing.count++;
      map.set(key, existing);
    }

    return [...map.values()].sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas));
  }, [receber, pagar, agrupamento, planoContas]);

  function handleExport() {
    const headers = ['Grupo', 'Entradas', 'Saídas', 'Saldo', 'Qtd Lançamentos'];
    const rows = grouped.map(g => [
      g.label,
      g.entradas.toFixed(2),
      g.saidas.toFixed(2),
      (g.entradas - g.saidas).toFixed(2),
      String(g.count),
    ]);
    rows.push(['TOTAL', totalReceber.toFixed(2), totalPagar.toFixed(2), saldo.toFixed(2), String(receber.length + pagar.length)]);
    exportCSV(`relatorio-financeiro-${dateFrom}-${dateTo}`, headers, rows);
  }

  function handleExportDetalhado() {
    const headers = ['Tipo', 'Data', 'Descrição', 'Pessoa', 'Valor', 'Status', 'Categoria'];
    const rows: string[][] = [];
    for (const cr of receber) {
      const cat = planoContas.find(c => c.id === cr.categoria_id);
      rows.push(['RECEBER', cr.data_vencimento, cr.descricao, cr.cliente_nome, cr.valor_final.toFixed(2), cr.status, cat?.nome || '']);
    }
    for (const cp of pagar) {
      const cat = planoContas.find(c => c.id === cp.categoria_id);
      rows.push(['PAGAR', cp.data_vencimento, cp.descricao, cp.fornecedor_nome, cp.valor_final.toFixed(2), cp.status, cat?.nome || '']);
    }
    rows.sort((a, b) => a[1].localeCompare(b[1]));
    exportCSV(`lancamentos-detalhado-${dateFrom}-${dateTo}`, headers, rows);
  }

  if (loading) {
    return <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6 flex items-center justify-center"><p className="text-[var(--t-text-secondary)]">Carregando...</p></div>;
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Relatório Financeiro</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Análise de receitas e despesas por período</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExport} variant="outline" className="border-[var(--t-border)] text-[var(--t-text-secondary)]">
              <Download className="w-4 h-4 mr-2" /> Exportar Resumo
            </Button>
            <Button onClick={handleExportDetalhado} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
              <Download className="w-4 h-4 mr-2" /> Exportar Detalhado
            </Button>
          </div>
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
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value as TipoRelatorio)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="AMBOS">Receitas e Despesas</option>
                <option value="RECEBER">Apenas Receitas</option>
                <option value="PAGAR">Apenas Despesas</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Agrupar por</label>
              <select value={agrupamento} onChange={e => setAgrupamento(e.target.value as Agrupamento)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="CATEGORIA">Categoria</option>
                <option value="FORNECEDOR">Fornecedor/Cliente</option>
                <option value="MES">Mês</option>
                <option value="NENHUM">Sem Agrupamento</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="TODOS">Todos</option>
                <option value="PENDENTE">Pendente</option>
                <option value="PAGO">Pago</option>
                <option value="RECEBIDO">Recebido</option>
                <option value="VENCIDO">Vencido</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <ArrowUpCircle className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Entradas</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(totalReceber)}</p>
                <p className="text-xs text-[var(--t-text-muted)]">{receber.length} lançamentos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <ArrowDownCircle className="w-8 h-8 text-[var(--t-red)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Saídas</p>
                <p className="text-xl font-bold text-[var(--t-red)]">{BRL(totalPagar)}</p>
                <p className="text-xs text-[var(--t-text-muted)]">{pagar.length} lançamentos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              {saldo >= 0 ? <TrendingUp className="w-8 h-8 text-[var(--t-green)] shrink-0" /> : <TrendingDown className="w-8 h-8 text-[var(--t-red)] shrink-0" />}
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Saldo</p>
                <p className={`text-xl font-bold ${saldo >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(saldo)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Grouped Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--t-green)]" />
              Resultado por {agrupamento === 'CATEGORIA' ? 'Categoria' : agrupamento === 'FORNECEDOR' ? 'Fornecedor/Cliente' : agrupamento === 'MES' ? 'Mês' : 'Lançamento'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                    <th className="text-left px-4 py-3">Grupo</th>
                    <th className="text-right px-4 py-3">Entradas</th>
                    <th className="text-right px-4 py-3">Saídas</th>
                    <th className="px-4 py-3 w-48">Proporção</th>
                    <th className="text-right px-4 py-3">Saldo</th>
                    <th className="text-center px-4 py-3">Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(g => {
                    const gSaldo = g.entradas - g.saidas;
                    const maxBar = Math.max(totalReceber, totalPagar) || 1;
                    return (
                      <tr key={g.key} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                        <td className="px-4 py-3 text-[var(--t-text)] font-medium">{g.label}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-green)]">{g.entradas > 0 ? BRL(g.entradas) : '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-red)]">{g.saidas > 0 ? BRL(g.saidas) : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {g.entradas > 0 && (
                              <div className="w-full bg-[var(--t-bg)] rounded-full h-1.5">
                                <div className="bg-[var(--t-green)] h-1.5 rounded-full" style={{ width: `${(g.entradas / maxBar) * 100}%` }} />
                              </div>
                            )}
                            {g.saidas > 0 && (
                              <div className="w-full bg-[var(--t-bg)] rounded-full h-1.5">
                                <div className="bg-[var(--t-red)] h-1.5 rounded-full" style={{ width: `${(g.saidas / maxBar) * 100}%` }} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${gSaldo >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                          {BRL(gSaldo)}
                        </td>
                        <td className="px-4 py-3 text-center text-[var(--t-text-secondary)]">{g.count}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--t-border)] bg-[var(--t-bg)]">
                    <td className="px-4 py-3 font-bold text-[var(--t-text)]">TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-green)]">{BRL(totalReceber)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-red)]">{BRL(totalPagar)}</td>
                    <td></td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${saldo >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(saldo)}</td>
                    <td className="px-4 py-3 text-center text-[var(--t-text-secondary)] font-bold">{receber.length + pagar.length}</td>
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
