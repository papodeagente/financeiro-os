'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { CrmStatusBadge } from '@/components/CrmStatusBadge';
import { KPIGridSkeleton } from '@/components/skeletons';
import { formatBRL } from '@/lib/utils';
import { calcLimiteUsado } from '@/lib/cartoes-utils';
import { useModoIniciante } from '@/lib/modo-iniciante';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import type { CartaoCorporativo, ContaPagar, ContaReceber, ContaBancaria } from '@/lib/crm-types';
import {
  BarChart3, FileSpreadsheet, Receipt, CreditCard,
  ArrowRightLeft, BookOpen, Landmark, Package,
  ListOrdered, FileText,
} from 'lucide-react';

interface KPIs {
  saldo: number;
  a_receber: number;          // PENDENTE total (todos meses)
  recebido: number;            // RECEBIDO total
  a_pagar: number;             // PENDENTE total
  pago: number;                // PAGO total
  resultado_projetado: number; // a_receber - a_pagar
  resultado_realizado: number; // recebido - pago
}

interface CartoesKpi {
  limite: number;
  usado: number;
  pct: number;
  count: number;
}

// Atalhos básicos (modo iniciante mostra apenas estes 4).
const SHORTCUTS_BASIC = [
  { icon: BarChart3, label: 'Fluxo de caixa', desc: 'Entradas e saidas por periodo', href: '/financeiro-ag/fluxo-caixa' },
  { icon: FileSpreadsheet, label: 'DRE', desc: 'Demonstrativo de resultado', href: '/financeiro-ag/dre' },
  { icon: Receipt, label: 'Contas a receber', desc: 'Parcelas e recebimentos', href: '/financeiro-ag/receber' },
  { icon: CreditCard, label: 'Contas a pagar', desc: 'Despesas e fornecedores', href: '/financeiro-ag/pagar' },
];
// Atalhos avançados (cadastros + conciliação) — só aparecem com modo avançado.
const SHORTCUTS_ADVANCED = [
  { icon: FileSpreadsheet, label: 'Conciliação', desc: 'Extrato vs lançamentos', href: '/financeiro-ag/conciliacao' },
  { icon: ArrowRightLeft, label: 'Transferências', desc: 'Entre contas bancárias', href: '/financeiro-ag/transferencias' },
  { icon: BookOpen, label: 'Plano de contas', desc: 'Categorias contabeis', href: '/financeiro-ag/plano-contas' },
  { icon: Landmark, label: 'Contas bancarias', desc: 'Cadastro de contas', href: '/financeiro-ag/contas-bancarias' },
  { icon: CreditCard, label: 'Cartões', desc: 'Limites e faturas dos cartões', href: '/financeiro-ag/cartoes' },
];

export default function FinanceiroAgHubPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [cartoesKpi, setCartoesKpi] = useState<CartoesKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [ultimos, setUltimos] = useState<Array<{ descricao: string; valor: number; tipo: string; data: string; origem: string }>>([]);
  const [modoIniciante] = useModoIniciante();
  const SHORTCUTS = modoIniciante ? SHORTCUTS_BASIC : [...SHORTCUTS_BASIC, ...SHORTCUTS_ADVANCED];

  useEffect(() => {
    async function load() {
      try {
        const [receberRes, pagarRes, cartoesRes, contasBancariasRes] = await Promise.all([
          fetch('/api/contas-receber').then(r => r.json()),
          fetch('/api/contas-pagar').then(r => r.json()),
          fetch('/api/cartoes-corp').then(r => r.json()).catch(() => []),
          fetch('/api/contas-bancarias').then(r => r.json()).catch(() => []),
        ]);

        const receber: ContaReceber[] = Array.isArray(receberRes) ? receberRes : [];
        const pagar: ContaPagar[] = Array.isArray(pagarRes) ? pagarRes : [];
        const cartoes: CartaoCorporativo[] = Array.isArray(cartoesRes) ? cartoesRes : [];
        const contasBancarias: ContaBancaria[] = Array.isArray(contasBancariasRes) ? contasBancariasRes : [];

        if (cartoes.length > 0) {
          const limite = cartoes.reduce((s, c) => s + (c.limite_total || 0), 0);
          const usado = cartoes.reduce((s, c) => s + calcLimiteUsado(c.id, pagar), 0);
          const pct = limite > 0 ? (usado / limite) * 100 : 0;
          setCartoesKpi({ limite, usado, pct, count: cartoes.filter(c => c.ativo).length });
        }

        // Totais all-time. "Este mês" zerava quando vencimentos caíam em mês
        // futuro (caso comum com vendas CRM cujas parcelas vencem em 30/60d).
        // Saldo bancário é COMPUTADO: saldo_inicial + recebido - pago. Não
        // depende de saldo_atual persistido (que pode estar stale se o user
        // marcou baixas antes do override PUT entrar em produção).
        const saldoBancario = calcularSaldoBancario(contasBancarias, receber, pagar);
        const aReceberTotal = receber
          .filter(r => r.status === 'PENDENTE')
          .reduce((s, r) => s + (r.valor_final || 0), 0);
        const recebidoTotal = receber
          .filter(r => r.status === 'RECEBIDO')
          .reduce((s, r) => s + (r.valor_recebido || r.valor_final || 0), 0);
        const aPagarTotal = pagar
          .filter(p => p.status === 'PENDENTE')
          .reduce((s, p) => s + (p.valor_final || 0), 0);
        const pagoTotal = pagar
          .filter(p => p.status === 'PAGO')
          .reduce((s, p) => s + (p.valor_pago || p.valor_final || 0), 0);

        setKpis({
          saldo: saldoBancario,
          a_receber: aReceberTotal,
          recebido: recebidoTotal,
          a_pagar: aPagarTotal,
          pago: pagoTotal,
          resultado_projetado: aReceberTotal - aPagarTotal,
          resultado_realizado: recebidoTotal - pagoTotal,
        });

        // Últimas movimentações: ordena por data_emissao desc, junta receber + pagar
        type Mov = { descricao: string; valor: number; tipo: 'receber' | 'pagar'; data: string; origem: string };
        const items: Mov[] = [];
        receber.slice().sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || '')).slice(0, 3).forEach(r => {
          items.push({
            descricao: r.descricao || r.cliente_nome || 'Conta a receber',
            valor: r.valor_final || 0,
            tipo: 'receber',
            data: r.data_vencimento || '',
            origem: (r.auto_gerado ? 'crm' : 'Manual'),
          });
        });
        pagar.slice().sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || '')).slice(0, 2).forEach(p => {
          items.push({
            descricao: p.descricao || p.fornecedor_nome || 'Conta a pagar',
            valor: p.valor_final || 0,
            tipo: 'pagar',
            data: p.data_vencimento || '',
            origem: (p.auto_gerado ? 'crm' : 'Manual'),
          });
        });
        setUltimos(items);
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (
    <PageShell header={<PageHeader title="Financeiro" crmBadge />}>
      <KPIGridSkeleton count={4} columns={4} />
    </PageShell>
  );

  return (
    <PageShell header={<PageHeader title="Financeiro" crmBadge />}>

      {/* KPI Cards — totais all-time (pendente + realizado) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Saldo bancário', value: kpis?.saldo || 0, hint: 'Somatório das contas' },
          { label: 'A receber (pendente)', value: kpis?.a_receber || 0, hint: 'Total ainda não recebido' },
          { label: 'A pagar (pendente)', value: kpis?.a_pagar || 0, hint: 'Total ainda não pago' },
          { label: 'Resultado projetado', value: kpis?.resultado_projetado || 0, hint: 'A receber − a pagar' },
        ].map((kpi, i) => (
          <div key={i} className="bento-card">
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.value >= 0 ? 'text-[var(--t-text)]' : 'text-[var(--crm-err)]'}`}>
              {formatBRL(kpi.value)}
            </p>
            <p className="text-[10px] text-[var(--t-text-muted)] mt-1">{kpi.hint}</p>
          </div>
        ))}
      </div>

      {/* Segunda linha — Realizado */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Faturamento', value: kpis?.recebido || 0, color: 'text-[var(--crm-ok)]' },
          { label: 'Despesas', value: kpis?.pago || 0, color: 'text-[var(--crm-err)]' },
          { label: 'Lucro', value: kpis?.resultado_realizado || 0, color: (kpis?.resultado_realizado || 0) >= 0 ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-err)]' },
        ].map((kpi, i) => (
          <div key={i} className="bento-card">
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.color}`}>{formatBRL(kpi.value)}</p>
          </div>
        ))}
      </div>

      {/* Cartões KPI */}
      {cartoesKpi && !modoIniciante && (
        <Link href="/financeiro-ag/cartoes" className="block mb-8">
          <div className="bento-card hover:shadow-[var(--t-card-shadow-hover)] transition-shadow">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-[var(--t-accent)]/10">
                  <CreditCard className="w-5 h-5 text-[var(--t-accent)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Cartões corporativos</p>
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{cartoesKpi.count} cartão{cartoesKpi.count !== 1 ? 'es' : ''} ativo{cartoesKpi.count !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-right">
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Limite</p>
                  <p className="text-[var(--text-body)] font-semibold text-[var(--t-text)]">{formatBRL(cartoesKpi.limite)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Usado</p>
                  <p className="text-[var(--text-body)] font-semibold text-[var(--t-text)]">{formatBRL(cartoesKpi.usado)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Utilização</p>
                  <p className={`text-[var(--text-body)] font-semibold ${cartoesKpi.pct > 85 ? 'text-red-500' : cartoesKpi.pct > 60 ? 'text-amber-500' : 'text-green-500'}`}>
                    {cartoesKpi.pct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Shortcuts grid */}
      <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Acesso rápido</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {SHORTCUTS.map(item => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="bento-card group hover:shadow-[var(--t-card-shadow-hover)]">
              <Icon className="w-5 h-5 text-[var(--t-text-muted)] group-hover:text-[var(--t-green)] transition-colors mb-2" />
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">{item.label}</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{item.desc}</p>
            </Link>
          );
        })}
      </div>

      {/* Recent movements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-3">Últimas movimentações</h2>
          <div className="rounded-[20px] shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] divide-y divide-[var(--t-border)]">
            {ultimos.length === 0 ? (
              <p className="px-4 py-6 text-center text-[var(--text-body-sm)] text-[var(--t-text-muted)]">Nenhuma movimentacao</p>
            ) : ultimos.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.tipo === 'receber' ? <Receipt className="w-4 h-4 text-[var(--crm-ok)]" /> : <CreditCard className="w-4 h-4 text-[var(--crm-err)]" />}
                  <div>
                    <p className="text-[var(--text-body-sm)] text-[var(--t-text)]">{item.descricao}</p>
                    <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{item.data}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-[var(--text-body-sm)] font-medium ${item.tipo === 'receber' ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-err)]'}`}>
                    {item.tipo === 'pagar' ? '-' : '+'}{formatBRL(item.valor)}
                  </p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${item.origem === 'crm' ? 'bg-[var(--t-green-bg)] text-[var(--t-green)]' : 'bg-[var(--t-sidebar-item-hover)] text-[var(--t-text-muted)]'}`}>
                    {item.origem === 'crm' ? 'CRM' : 'Manual'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-3">Integração CRM</h2>
          <div className="rounded-[20px] shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-4">
            <CrmStatusBadge variant="completo" />
            <div className="mt-3 pt-3 border-t border-[var(--t-border)]">
              <Link href="/config/crm" className="text-[var(--text-body-sm)] text-[var(--t-green)] hover:underline">
                Ver log completo →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
