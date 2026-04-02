'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users, ShoppingCart, ArrowUpRight, ArrowDownRight,
  TrendingUp, Clock, AlertTriangle, ChevronRight,
  DollarSign, CreditCard, Receipt, Package,
} from 'lucide-react';
import type { Cliente, VendaCRM, ContaReceber, ContaPagar } from '@/lib/crm-types';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (s: string) => {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

const today = new Date().toISOString().split('T')[0];
const thisMonth = today.slice(0, 7);

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

export default function DashboardPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/clientes').then(r => r.json()).catch(() => []),
      fetch('/api/vendas-crm').then(r => r.json()).catch(() => []),
      fetch('/api/contas-receber').then(r => r.json()).catch(() => []),
      fetch('/api/contas-pagar').then(r => r.json()).catch(() => []),
    ]).then(([c, v, cr, cp]) => {
      setClientes(c); setVendas(v); setReceber(cr); setPagar(cp);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const vendasMes = vendas.filter(v => v.data_venda?.startsWith(thisMonth) && v.status !== 'CANCELADO');
  const receitaMes = vendasMes.reduce((s, v) => s + (v.valor_final || 0), 0);
  const ticketMedio = vendasMes.length > 0 ? receitaMes / vendasMes.length : 0;

  const totalReceber = receber.filter(r => r.status === 'PENDENTE' || r.status === 'ATRASADO')
    .reduce((s, r) => s + (r.valor_final || 0), 0);
  const totalPagar = pagar.filter(p => p.status === 'PENDENTE' || p.status === 'VENCIDO')
    .reduce((s, p) => s + (p.valor_final || 0), 0);
  const atrasados = receber.filter(r => r.status === 'ATRASADO');
  const vencidos = pagar.filter(p => p.status === 'VENCIDO');

  const contasVencer7d = [
    ...receber.filter(r => r.status === 'PENDENTE' && daysUntil(r.data_vencimento) >= 0 && daysUntil(r.data_vencimento) <= 7)
      .map(r => ({ tipo: 'receber' as const, nome: r.cliente_nome, valor: r.valor_final, vencimento: r.data_vencimento, dias: daysUntil(r.data_vencimento) })),
    ...pagar.filter(p => p.status === 'PENDENTE' && daysUntil(p.data_vencimento) >= 0 && daysUntil(p.data_vencimento) <= 7)
      .map(p => ({ tipo: 'pagar' as const, nome: p.fornecedor_nome, valor: p.valor_final, vencimento: p.data_vencimento, dias: daysUntil(p.data_vencimento) })),
  ].sort((a, b) => a.dias - b.dias);

  const ultimasVendas = [...vendas].sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || '')).slice(0, 8);
  const clienteMap = Object.fromEntries(clientes.map(c => [c.id, c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social]));

  const statusColor: Record<string, string> = {
    ORCAMENTO: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
    RESERVADO: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
    CONFIRMADO: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
    CANCELADO: 'bg-[var(--t-red-bg)] text-[var(--t-red)]',
    CONCLUIDO: 'bg-[var(--t-border)] text-[var(--t-text-secondary)]',
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-8 pb-2">
        <h1 className="text-2xl font-semibold text-[var(--t-text)]">Dashboard</h1>
        <p className="text-sm text-[var(--t-text-secondary)] mt-1">Visao geral financeira</p>
      </div>

      <div className="px-8 pb-8 space-y-6">
        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--t-surface)] rounded-2xl p-5 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[var(--t-text-secondary)]">Receita do Mes</span>
              <div className="w-9 h-9 rounded-xl bg-[var(--t-green-bg)] flex items-center justify-center">
                <TrendingUp className="w-[18px] h-[18px] text-[var(--t-green)]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-[var(--t-text)] leading-none tracking-tight">{fmt(receitaMes)}</div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[var(--t-text-secondary)]">{vendasMes.length} vendas</span>
              <span className="text-[10px] text-[var(--t-text-muted)]">|</span>
              <span className="text-xs text-[var(--t-text-secondary)]">Ticket medio: {fmt(ticketMedio)}</span>
            </div>
          </div>

          <div className="bg-[var(--t-surface)] rounded-2xl p-5 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[var(--t-text-secondary)]">A Receber</span>
              <div className="w-9 h-9 rounded-xl bg-[var(--t-green-bg)] flex items-center justify-center">
                <ArrowDownRight className="w-[18px] h-[18px] text-[var(--t-green)]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-[var(--t-text)] leading-none tracking-tight">{fmt(totalReceber)}</div>
            <div className="flex items-center gap-2 mt-3">
              {atrasados.length > 0
                ? <span className="text-xs text-[var(--t-red)] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {atrasados.length} atrasado(s)</span>
                : <span className="text-xs text-[var(--t-green)]">Tudo em dia</span>
              }
            </div>
          </div>

          <div className="bg-[var(--t-surface)] rounded-2xl p-5 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[var(--t-text-secondary)]">A Pagar</span>
              <div className="w-9 h-9 rounded-xl bg-[var(--t-red-bg)] flex items-center justify-center">
                <ArrowUpRight className="w-[18px] h-[18px] text-[var(--t-red)]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-[var(--t-text)] leading-none tracking-tight">{fmt(totalPagar)}</div>
            <div className="flex items-center gap-2 mt-3">
              {vencidos.length > 0
                ? <span className="text-xs text-[var(--t-red)] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {vencidos.length} vencido(s)</span>
                : <span className="text-xs text-[var(--t-green)]">Nenhum vencido</span>
              }
            </div>
          </div>

          <div className="bg-[var(--t-surface)] rounded-2xl p-5 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[var(--t-text-secondary)]">Clientes</span>
              <div className="w-9 h-9 rounded-xl bg-[var(--t-blue-bg)] flex items-center justify-center">
                <Users className="w-[18px] h-[18px] text-[var(--t-blue)]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-[var(--t-text)] leading-none tracking-tight">{clientes.filter(c => c.status === 'ATIVO').length}</div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[var(--t-text-secondary)]">{clientes.length} cadastrados</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-3 flex-wrap">
          <Link href="/vendas/nova">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[var(--t-green)] text-white dark:text-[#0a0a14] rounded-xl text-sm font-medium hover:opacity-90 transition-all" style={{ boxShadow: '0 4px 15px var(--t-green-shadow)' }}>
              <ShoppingCart className="w-4 h-4" /> Nova Venda
            </button>
          </Link>
          {[
            { href: '/pessoas/clientes', icon: Users, label: 'Clientes' },
            { href: '/financeiro-ag/receber', icon: Receipt, label: 'Contas a Receber' },
            { href: '/financeiro-ag/pagar', icon: CreditCard, label: 'Contas a Pagar' },
            { href: '/financeiro-grupos', icon: Package, label: 'Fin. Grupos' },
          ].map(a => (
            <Link key={a.href} href={a.href}>
              <button className="flex items-center gap-2 px-4 py-2.5 bg-[var(--t-surface)] text-[var(--t-text)] rounded-xl text-sm font-medium hover:bg-[var(--t-surface-hover)] transition-colors border border-[var(--t-border)]">
                <a.icon className="w-4 h-4" /> {a.label}
              </button>
            </Link>
          ))}
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Recent Sales */}
          <div className="lg:col-span-3 bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)]">Ultimas Vendas</h2>
              <Link href="/vendas" className="text-xs text-[var(--t-green)] flex items-center gap-1 hover:underline">
                Ver todas <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {ultimasVendas.length === 0 ? (
              <div className="px-5 py-10 text-center text-[var(--t-text-secondary)] text-sm">Nenhuma venda registrada</div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {ultimasVendas.map(v => (
                  <div key={v.id} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--t-surface-hover)] transition-colors">
                    <div className="w-9 h-9 rounded-full bg-[var(--t-green-bg)] flex items-center justify-center shrink-0">
                      <DollarSign className="w-4 h-4 text-[var(--t-green)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)] truncate">{clienteMap[v.cliente_id] || 'Cliente'}</div>
                      <div className="text-[11px] text-[var(--t-text-secondary)]">#{v.numero} · {fmtDate(v.data_venda)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-[var(--t-text)]">{fmt(v.valor_final || 0)}</div>
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${statusColor[v.status] || ''}`}>
                        {v.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming */}
          <div className="lg:col-span-2 bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)]">Vencimentos (7 dias)</h2>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[var(--t-text-secondary)]" />
                <span className="text-xs text-[var(--t-text-secondary)]">{contasVencer7d.length}</span>
              </div>
            </div>
            {contasVencer7d.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm">
                <div className="text-[var(--t-green)] mb-1">Tudo limpo</div>
                <div className="text-[var(--t-text-secondary)]">Nenhuma conta nos proximos 7 dias</div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {contasVencer7d.slice(0, 8).map((c, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3 hover:bg-[var(--t-surface-hover)] transition-colors">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${c.tipo === 'receber' ? 'bg-[var(--t-green)]' : 'bg-[var(--t-red)]'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)] truncate">{c.nome || 'Sem nome'}</div>
                      <div className="text-[11px] text-[var(--t-text-secondary)]">
                        {c.tipo === 'receber' ? 'Receber' : 'Pagar'} · {fmtDate(c.vencimento)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-medium ${c.tipo === 'receber' ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                        {fmt(c.valor)}
                      </div>
                      <div className="text-[10px] text-[var(--t-text-secondary)]">
                        {c.dias === 0 ? 'Hoje' : c.dias === 1 ? 'Amanha' : `${c.dias}d`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(atrasados.length > 0 || vencidos.length > 0) && (
              <div className="mx-5 mb-4 mt-2 p-3 rounded-xl bg-[var(--t-red-bg)] border border-[var(--t-red)]/20">
                <div className="flex items-center gap-2 text-sm text-[var(--t-red)]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {atrasados.length > 0 && `${atrasados.length} conta(s) a receber atrasada(s)`}
                    {atrasados.length > 0 && vencidos.length > 0 && ' · '}
                    {vencidos.length > 0 && `${vencidos.length} conta(s) a pagar vencida(s)`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
