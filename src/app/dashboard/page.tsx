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
        <div className="w-8 h-8 border-2 border-[#4ade80] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Calculations
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
    ORCAMENTO: 'bg-amber-500/20 text-amber-400',
    RESERVADO: 'bg-blue-500/20 text-blue-400',
    CONFIRMADO: 'bg-[#4ade80]/20 text-[#4ade80]',
    CANCELADO: 'bg-red-500/20 text-red-400',
    CONCLUIDO: 'bg-[#8888a0]/20 text-[#8888a0]',
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-8 pb-2">
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-[#8888a0] mt-1">Visao geral financeira</p>
      </div>

      <div className="px-8 pb-8 space-y-6">
        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Receita do Mes */}
          <div className="bg-[#12121e] rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[#8888a0]">Receita do Mes</span>
              <div className="w-9 h-9 rounded-xl bg-[#4ade80]/10 flex items-center justify-center">
                <TrendingUp className="w-[18px] h-[18px] text-[#4ade80]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-white leading-none tracking-tight">{fmt(receitaMes)}</div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[#8888a0]">{vendasMes.length} vendas</span>
              <span className="text-[10px] text-[#555]">|</span>
              <span className="text-xs text-[#8888a0]">Ticket medio: {fmt(ticketMedio)}</span>
            </div>
          </div>

          {/* A Receber */}
          <div className="bg-[#12121e] rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[#8888a0]">A Receber</span>
              <div className="w-9 h-9 rounded-xl bg-[#4ade80]/10 flex items-center justify-center">
                <ArrowDownRight className="w-[18px] h-[18px] text-[#4ade80]" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-white leading-none tracking-tight">{fmt(totalReceber)}</div>
            <div className="flex items-center gap-2 mt-3">
              {atrasados.length > 0 && (
                <span className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {atrasados.length} atrasado(s)
                </span>
              )}
              {atrasados.length === 0 && <span className="text-xs text-[#4ade80]">Tudo em dia</span>}
            </div>
          </div>

          {/* A Pagar */}
          <div className="bg-[#12121e] rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[#8888a0]">A Pagar</span>
              <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
                <ArrowUpRight className="w-[18px] h-[18px] text-red-400" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-white leading-none tracking-tight">{fmt(totalPagar)}</div>
            <div className="flex items-center gap-2 mt-3">
              {vencidos.length > 0 && (
                <span className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {vencidos.length} vencido(s)
                </span>
              )}
              {vencidos.length === 0 && <span className="text-xs text-[#4ade80]">Nenhum vencido</span>}
            </div>
          </div>

          {/* Clientes */}
          <div className="bg-[#12121e] rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-[#8888a0]">Clientes</span>
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Users className="w-[18px] h-[18px] text-blue-400" />
              </div>
            </div>
            <div className="text-[28px] font-semibold text-white leading-none tracking-tight">{clientes.filter(c => c.status === 'ATIVO').length}</div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-[#8888a0]">{clientes.length} cadastrados</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-3">
          <Link href="/vendas/nova">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#4ade80] text-[#0a0a14] rounded-xl text-sm font-medium hover:bg-[#22c55e] transition-colors shadow-lg shadow-[#4ade80]/20">
              <ShoppingCart className="w-4 h-4" /> Nova Venda
            </button>
          </Link>
          <Link href="/pessoas/clientes">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a2a] text-white rounded-xl text-sm font-medium hover:bg-[#252538] transition-colors border border-white/[0.06]">
              <Users className="w-4 h-4" /> Clientes
            </button>
          </Link>
          <Link href="/financeiro-ag/receber">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a2a] text-white rounded-xl text-sm font-medium hover:bg-[#252538] transition-colors border border-white/[0.06]">
              <Receipt className="w-4 h-4" /> Contas a Receber
            </button>
          </Link>
          <Link href="/financeiro-ag/pagar">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a2a] text-white rounded-xl text-sm font-medium hover:bg-[#252538] transition-colors border border-white/[0.06]">
              <CreditCard className="w-4 h-4" /> Contas a Pagar
            </button>
          </Link>
          <Link href="/financeiro-grupos">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a2a] text-white rounded-xl text-sm font-medium hover:bg-[#252538] transition-colors border border-white/[0.06]">
              <Package className="w-4 h-4" /> Fin. Grupos
            </button>
          </Link>
        </div>

        {/* Bottom Grid: Recent Sales + Upcoming */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Recent Sales — 3 cols */}
          <div className="lg:col-span-3 bg-[#12121e] rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
              <h2 className="text-sm font-medium text-white">Ultimas Vendas</h2>
              <Link href="/vendas" className="text-xs text-[#4ade80] flex items-center gap-1 hover:underline">
                Ver todas <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {ultimasVendas.length === 0 ? (
              <div className="px-5 py-10 text-center text-[#8888a0] text-sm">Nenhuma venda registrada</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {ultimasVendas.map(v => (
                  <div key={v.id} className="px-5 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                    <div className="w-9 h-9 rounded-full bg-[#1a1a2a] flex items-center justify-center shrink-0">
                      <DollarSign className="w-4 h-4 text-[#4ade80]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{clienteMap[v.cliente_id] || 'Cliente'}</div>
                      <div className="text-[11px] text-[#8888a0]">#{v.numero} · {fmtDate(v.data_venda)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-white">{fmt(v.valor_final || 0)}</div>
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${statusColor[v.status] || ''}`}>
                        {v.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming — 2 cols */}
          <div className="lg:col-span-2 bg-[#12121e] rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
              <h2 className="text-sm font-medium text-white">Vencimentos (7 dias)</h2>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#8888a0]" />
                <span className="text-xs text-[#8888a0]">{contasVencer7d.length}</span>
              </div>
            </div>
            {contasVencer7d.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm">
                <div className="text-[#4ade80] mb-1">Tudo limpo</div>
                <div className="text-[#8888a0]">Nenhuma conta nos proximos 7 dias</div>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {contasVencer7d.slice(0, 8).map((c, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${c.tipo === 'receber' ? 'bg-[#4ade80]' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{c.nome || 'Sem nome'}</div>
                      <div className="text-[11px] text-[#8888a0]">
                        {c.tipo === 'receber' ? 'Receber' : 'Pagar'} · {fmtDate(c.vencimento)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-medium ${c.tipo === 'receber' ? 'text-[#4ade80]' : 'text-red-400'}`}>
                        {fmt(c.valor)}
                      </div>
                      <div className="text-[10px] text-[#8888a0]">
                        {c.dias === 0 ? 'Hoje' : c.dias === 1 ? 'Amanha' : `${c.dias}d`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Alert banner if overdue */}
            {(atrasados.length > 0 || vencidos.length > 0) && (
              <div className="mx-5 mb-4 mt-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-sm text-red-400">
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
