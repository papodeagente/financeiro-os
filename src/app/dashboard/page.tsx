'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  UserPlus,
  PlusCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Cliente, VendaCRM, ContaReceber, ContaPagar } from '@/lib/crm-types';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

const statusVendaLabel: Record<string, { label: string; color: string }> = {
  ORCAMENTO: { label: 'Orçamento', color: 'text-yellow-400 bg-yellow-400/10' },
  RESERVADO: { label: 'Reservado', color: 'text-blue-400 bg-blue-400/10' },
  CONFIRMADO: { label: 'Confirmado', color: 'text-green-400 bg-green-400/10' },
  CANCELADO: { label: 'Cancelado', color: 'text-red-400 bg-red-400/10' },
  CONCLUIDO: { label: 'Concluído', color: 'text-purple-400 bg-purple-400/10' },
};

const statusContaLabel: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Pendente', color: 'text-yellow-400 bg-yellow-400/10' },
  ATRASADO: { label: 'Atrasado', color: 'text-red-400 bg-red-400/10' },
  VENCIDO: { label: 'Vencido', color: 'text-red-400 bg-red-400/10' },
  RECEBIDO: { label: 'Recebido', color: 'text-green-400 bg-green-400/10' },
  PAGO: { label: 'Pago', color: 'text-green-400 bg-green-400/10' },
  PARCIAL: { label: 'Parcial', color: 'text-orange-400 bg-orange-400/10' },
  CANCELADO: { label: 'Cancelado', color: 'text-gray-400 bg-gray-400/10' },
};

export default function DashboardPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [clientesRes, vendasRes, receberRes, pagarRes] = await Promise.all([
          fetch('/api/clientes'),
          fetch('/api/vendas-crm'),
          fetch('/api/contas-receber'),
          fetch('/api/contas-pagar'),
        ]);

        const [clientesData, vendasData, receberData, pagarData] = await Promise.all([
          clientesRes.ok ? clientesRes.json() : [],
          vendasRes.ok ? vendasRes.json() : [],
          receberRes.ok ? receberRes.json() : [],
          pagarRes.ok ? pagarRes.json() : [],
        ]);

        setClientes(clientesData);
        setVendas(vendasData);
        setContasReceber(receberData);
        setContasPagar(pagarData);
      } catch (err) {
        console.error('Erro ao carregar dados do dashboard:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Computed metrics
  const now = new Date();
  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();

  const vendasDoMes = vendas.filter((v) => {
    const d = new Date(v.data_venda);
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
  });

  const receitaDoMes = vendasDoMes
    .filter((v) => v.status !== 'CANCELADO')
    .reduce((acc, v) => acc + (v.valor_final || 0), 0);

  const contasVencidas = [
    ...contasReceber.filter((c) => c.status === 'ATRASADO'),
    ...contasPagar.filter((c) => c.status === 'VENCIDO'),
  ];

  // Próximos 7 dias: contas a vencer
  const em7dias = new Date(now);
  em7dias.setDate(em7dias.getDate() + 7);

  const contasAVencer = [
    ...contasReceber
      .filter((c) => {
        if (c.status !== 'PENDENTE') return false;
        const venc = new Date(c.data_vencimento + 'T00:00:00');
        return venc >= now && venc <= em7dias;
      })
      .map((c) => ({
        id: c.id,
        tipo: 'receber' as const,
        nome: c.cliente_nome,
        valor: c.valor_final,
        vencimento: c.data_vencimento,
        status: c.status,
      })),
    ...contasPagar
      .filter((c) => {
        if (c.status !== 'PENDENTE') return false;
        const venc = new Date(c.data_vencimento + 'T00:00:00');
        return venc >= now && venc <= em7dias;
      })
      .map((c) => ({
        id: c.id,
        tipo: 'pagar' as const,
        nome: c.fornecedor_nome,
        valor: c.valor_final,
        vencimento: c.data_vencimento,
        status: c.status,
      })),
  ].sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  // Últimas 10 vendas
  const ultimasVendas = [...vendas]
    .sort((a, b) => b.data_venda.localeCompare(a.data_venda))
    .slice(0, 10);

  // Map clienteId -> nome
  const clienteMap = Object.fromEntries(
    clientes.map((c) => [c.id, c.nome_completo || c.razao_social || '-'])
  );

  const summaryCards = [
    {
      title: 'Total de Clientes',
      value: clientes.filter((c) => c.status === 'ATIVO').length.toString(),
      subtitle: `${clientes.length} cadastrados`,
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      title: 'Vendas do Mês',
      value: vendasDoMes.filter((v) => v.status !== 'CANCELADO').length.toString(),
      subtitle: `${vendasDoMes.length} no total`,
      icon: ShoppingCart,
      color: 'text-[#d4a853]',
      bg: 'bg-[#d4a853]/10',
    },
    {
      title: 'Receita do Mês',
      value: formatCurrency(receitaDoMes),
      subtitle: 'vendas confirmadas',
      icon: TrendingUp,
      color: 'text-green-400',
      bg: 'bg-green-400/10',
    },
    {
      title: 'Contas Vencidas',
      value: contasVencidas.length.toString(),
      subtitle: 'requerem atenção',
      icon: AlertTriangle,
      color: 'text-red-400',
      bg: 'bg-red-400/10',
    },
  ];

  const quickActions = [
    {
      label: 'Novo Cliente',
      icon: UserPlus,
      href: '/pessoas/clientes',
      variant: 'default' as const,
    },
    {
      label: 'Nova Venda',
      icon: PlusCircle,
      href: '/vendas/nova',
      variant: 'default' as const,
    },
    {
      label: 'Contas a Receber',
      icon: ArrowDownCircle,
      href: '/financeiro-ag/receber',
      variant: 'outline' as const,
    },
    {
      label: 'Contas a Pagar',
      icon: ArrowUpCircle,
      href: '/financeiro-ag/pagar',
      variant: 'outline' as const,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-[#d4a853] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">
          Visão geral do sistema —{' '}
          {now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="bg-[#1a1a2e] border-white/10">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">
                      {card.title}
                    </p>
                    <p className="text-white text-2xl font-bold">{card.value}</p>
                    <p className="text-gray-500 text-xs">{card.subtitle}</p>
                  </div>
                  <div className={`p-2.5 rounded-lg ${card.bg}`}>
                    <Icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card className="bg-[#1a1a2e] border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base font-semibold">Ações Rápidas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}>
                <Button
                  variant={action.variant}
                  className={
                    action.variant === 'default'
                      ? 'bg-[#d4a853] hover:bg-[#c4983f] text-[#1a1a2e] font-semibold gap-2'
                      : 'border-white/20 text-gray-300 hover:bg-white/5 hover:text-white gap-2'
                  }
                >
                  <Icon className="w-4 h-4" />
                  {action.label}
                </Button>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      {/* Bottom Grid: Recent Vendas + Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Vendas */}
        <Card className="bg-[#1a1a2e] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-white text-base font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#d4a853]" />
              Últimas Vendas
            </CardTitle>
            <Link href="/vendas">
              <span className="text-[#d4a853] text-xs hover:underline cursor-pointer">
                Ver todas
              </span>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {ultimasVendas.length === 0 ? (
              <div className="px-5 pb-5 text-gray-500 text-sm text-center py-8">
                Nenhuma venda registrada ainda.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {ultimasVendas.map((venda) => {
                  const status = statusVendaLabel[venda.status] ?? {
                    label: venda.status,
                    color: 'text-gray-400 bg-gray-400/10',
                  };
                  return (
                    <div
                      key={venda.id}
                      className="flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">
                          {clienteMap[venda.cliente_id] ?? '—'}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          #{venda.numero} · {formatDate(venda.data_venda)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                        <span className="text-white text-sm font-semibold">
                          {formatCurrency(venda.valor_final)}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts: contas a vencer */}
        <Card className="bg-[#1a1a2e] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-white text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#d4a853]" />
              Contas a Vencer (7 dias)
            </CardTitle>
            <span className="text-xs text-gray-500">{contasAVencer.length} conta(s)</span>
          </CardHeader>
          <CardContent className="p-0">
            {contasAVencer.length === 0 ? (
              <div className="px-5 pb-5 text-center py-8 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto" />
                <p className="text-gray-400 text-sm">Nenhuma conta a vencer nos próximos 7 dias.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {contasAVencer.map((conta) => {
                  const status = statusContaLabel[conta.status] ?? {
                    label: conta.status,
                    color: 'text-gray-400 bg-gray-400/10',
                  };
                  const isReceber = conta.tipo === 'receber';
                  return (
                    <div
                      key={`${conta.tipo}-${conta.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`p-1.5 rounded-md shrink-0 ${
                            isReceber ? 'bg-green-400/10' : 'bg-red-400/10'
                          }`}
                        >
                          {isReceber ? (
                            <ArrowDownCircle className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <ArrowUpCircle className="w-3.5 h-3.5 text-red-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{conta.nome}</p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            {isReceber ? 'Receber' : 'Pagar'} · vence {formatDate(conta.vencimento)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                        <span
                          className={`text-sm font-semibold ${
                            isReceber ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {formatCurrency(conta.valor)}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Vencidas warning */}
            {contasVencidas.length > 0 && (
              <div className="mx-5 mb-5 mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-xs">
                  <span className="font-semibold">{contasVencidas.length} conta(s) vencida(s)</span>{' '}
                  aguardando regularização.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
