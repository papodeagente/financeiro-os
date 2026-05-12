'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { CrmStatusBadge } from '@/components/CrmStatusBadge';
import { KPIGridSkeleton } from '@/components/skeletons';
import { OnboardingChecklist, type OnboardingStep } from '@/components/financeiro/OnboardingChecklist';
import { MetricExplainer } from '@/components/financeiro/MetricExplainer';
import { formatBRL } from '@/lib/utils';
import { calcLimiteUsado } from '@/lib/cartoes-utils';
import { useModoIniciante } from '@/lib/modo-iniciante';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { toast } from '@/lib/toast';
import type { CartaoCorporativo, ContaPagar, ContaReceber, ContaBancaria, VendaCRM, PlanoContas } from '@/lib/crm-types';
import {
  BarChart3, FileSpreadsheet, Receipt, CreditCard,
  ArrowRightLeft, BookOpen, Landmark, Package,
  ListOrdered, FileText, RefreshCw, ChevronDown, ChevronUp,
  Plus, TrendingDown,
} from 'lucide-react';

interface KPIs {
  saldo: number;
  a_receber: number;          // PENDENTE total (todos meses)
  recebido: number;            // RECEBIDO total
  a_pagar: number;             // PENDENTE total
  pago: number;                // PAGO total
  resultado_projetado: number; // a_receber - a_pagar
  resultado_realizado: number; // recebido - pago
  receita_gerada: number;      // Σ (valor_venda − custo) de TODAS vendas não canceladas
  faturamento_vendas: number;  // Σ valor_venda das vendas (base para margem %)
  margem_pct: number;          // receita_gerada / faturamento_vendas × 100
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
  const router = useRouter();
  // Estado para onboarding checklist
  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([]);
  // Estado para "Ver mais indicadores" (linha 2 expandível)
  const [expandirIndicadores, setExpandirIndicadores] = useState(false);
  // Frescor dos dados — mostra "Atualizado há X" abaixo dos KPIs
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date());
  const [recarregando, setRecarregando] = useState(false);

  const load = useCallback(async () => {
    try {
        const [receberRes, pagarRes, cartoesRes, contasBancariasRes, vendasRes, planoContasRes] = await Promise.all([
          fetch('/api/contas-receber').then(r => r.json()),
          fetch('/api/contas-pagar').then(r => r.json()),
          fetch('/api/cartoes-corp').then(r => r.json()).catch(() => []),
          fetch('/api/contas-bancarias').then(r => r.json()).catch(() => []),
          fetch('/api/vendas-crm').then(r => r.json()).catch(() => []),
          fetch('/api/plano-contas').then(r => r.json()).catch(() => []),
        ]);

        const receber: ContaReceber[] = Array.isArray(receberRes) ? receberRes : [];
        const pagar: ContaPagar[] = Array.isArray(pagarRes) ? pagarRes : [];
        const cartoes: CartaoCorporativo[] = Array.isArray(cartoesRes) ? cartoesRes : [];
        const contasBancarias: ContaBancaria[] = Array.isArray(contasBancariasRes) ? contasBancariasRes : [];
        const vendas: Array<Partial<VendaCRM> & Record<string, unknown>> = Array.isArray(vendasRes) ? vendasRes : [];

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

        // Receita gerada (comissão) das vendas — independente de baixa.
        // É a margem bruta acumulada: faturamento_vendas − custo_vendas.
        // Aceita tanto o shape novo (valor_total/custo_total) quanto o
        // legado (valor_total_venda/valor_total_custo).
        const vendasAtivas = vendas.filter(v => {
          const s = String(v.status ?? '').toUpperCase();
          return s !== 'CANCELADO';
        });
        const faturamentoVendas = vendasAtivas.reduce((s, v) => {
          const venda = Number(v.valor_final) || Number(v.valor_total_venda) || Number(v.valor_total) || 0;
          return s + venda;
        }, 0);
        const custoVendas = vendasAtivas.reduce((s, v) => {
          const custo = Number(v.valor_total_custo) || Number(v.custo_total) || 0;
          return s + custo;
        }, 0);
        const receitaGerada = Math.max(faturamentoVendas - custoVendas, 0);
        const margemPct = faturamentoVendas > 0 ? (receitaGerada / faturamentoVendas) * 100 : 0;

        setKpis({
          saldo: saldoBancario,
          a_receber: aReceberTotal,
          recebido: recebidoTotal,
          a_pagar: aPagarTotal,
          pago: pagoTotal,
          resultado_projetado: aReceberTotal - aPagarTotal,
          resultado_realizado: recebidoTotal - pagoTotal,
          receita_gerada: receitaGerada,
          faturamento_vendas: faturamentoVendas,
          margem_pct: margemPct,
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

        // Detecta passos do onboarding com base nos dados carregados
        const plano: PlanoContas[] = Array.isArray(planoContasRes) ? planoContasRes : [];
        const temCaixa = contasBancarias.length > 0;
        const temPlanoContas = plano.length > 0;
        const temDespesa = pagar.length > 0;
        const temPagamento = pagar.some(p => p.status === 'PAGO');
        setOnboardingSteps([
          {
            key: 'caixa',
            label: 'Conta bancária cadastrada',
            description: temCaixa ? 'Pronto · sua Caixa Geral está ativa.' : 'Toda baixa de pagamento/recebimento entra ou sai daqui.',
            done: temCaixa,
            href: '/financeiro-ag/contas-bancarias',
          },
          {
            key: 'plano-contas',
            label: 'Plano de contas configurado',
            description: temPlanoContas ? `${plano.length} categorias prontas.` : 'Carregue o plano padrão (CNAE 7911-2 — Agências de Viagens) em 1 clique.',
            done: temPlanoContas,
            href: '/financeiro-ag/plano-contas',
          },
          {
            key: 'primeira-despesa',
            label: 'Primeira despesa lançada',
            description: temDespesa ? 'Tudo certo.' : 'Cadastre uma despesa para começar a controlar o caixa.',
            done: temDespesa,
            href: '/financeiro-ag/pagar',
          },
          {
            key: 'primeiro-pagamento',
            label: 'Primeiro pagamento confirmado',
            description: temPagamento ? 'Você já marcou pagamentos como concluídos.' : 'Marque uma despesa como paga para atualizar o saldo bancário.',
            done: temPagamento,
            href: '/financeiro-ag/pagar',
          },
        ]);

        setUltimaAtualizacao(new Date());
      } catch { /* silent */ }
      setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const recarregar = async () => {
      setRecarregando(true);
      await load();
      setRecarregando(false);
      toast.success('Dados atualizados');
    };

  if (loading) return (
    <PageShell header={<PageHeader title="Financeiro" crmBadge />}>
      <KPIGridSkeleton count={4} columns={4} />
    </PageShell>
  );

  return (
    <PageShell header={<PageHeader title="Financeiro" crmBadge />}>

      {/* Onboarding checklist — esconde quando dispensado ou 4/4 completo */}
      {onboardingSteps.length > 0 && <OnboardingChecklist steps={onboardingSteps} />}

      {/* KPI Cards — 4 essenciais. Mais indicadores em "Ver mais" expandível */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
        {[
          {
            label: 'Saldo bancário',
            value: kpis?.saldo || 0,
            hint: 'Somatório das contas',
            explainer: 'Total acumulado nas suas contas bancárias. Atualiza automaticamente quando você confirma um recebimento ou pagamento.',
          },
          {
            label: 'A receber (pendente)',
            value: kpis?.a_receber || 0,
            hint: 'Total ainda não recebido',
            explainer: 'Soma de todas as contas a receber com status PENDENTE, independente do mês de vencimento.',
          },
          {
            label: 'A pagar (pendente)',
            value: kpis?.a_pagar || 0,
            hint: 'Total ainda não pago',
            explainer: 'Soma de todas as contas a pagar com status PENDENTE, independente do mês de vencimento.',
          },
          {
            label: 'Lucro do mês',
            value: kpis?.resultado_realizado || 0,
            hint: 'Recebido − pago neste mês',
            explainer: 'Resultado realizado: tudo que entrou no caixa menos tudo que saiu. Não inclui valores pendentes.',
          },
        ].map((kpi, i) => (
          <div key={i} className="bento-card">
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
              {kpi.label}
              <MetricExplainer title={kpi.label} text={kpi.explainer} />
            </p>
            <p className={`text-2xl font-bold ${kpi.value >= 0 ? 'text-[var(--t-text)]' : 'text-[var(--crm-err)]'}`}>
              {formatBRL(kpi.value)}
            </p>
            <p className="text-[10px] text-[var(--t-text-muted)] mt-1">{kpi.hint}</p>
          </div>
        ))}
      </div>

      {/* Indicador de frescor + "Ver mais indicadores" */}
      <div className="flex items-center justify-between mb-6 px-1">
        <p className="text-[11px] text-[var(--t-text-muted)] flex items-center gap-2">
          <span>Atualizado às {ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <button
            onClick={recarregar}
            disabled={recarregando}
            className="inline-flex items-center gap-1 hover:text-[var(--t-text)] transition-colors disabled:opacity-50"
            title="Recarregar dados"
          >
            <RefreshCw className={`w-3 h-3 ${recarregando ? 'animate-spin' : ''}`} />
            <span>{recarregando ? 'Atualizando…' : 'Recarregar'}</span>
          </button>
        </p>
        <button
          onClick={() => setExpandirIndicadores(v => !v)}
          className="text-[11px] text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors inline-flex items-center gap-1"
        >
          {expandirIndicadores ? (
            <><ChevronUp className="w-3 h-3" /> Ocultar indicadores avançados</>
          ) : (
            <><ChevronDown className="w-3 h-3" /> Ver mais indicadores</>
          )}
        </button>
      </div>

      {/* Indicadores avançados — só quando expandido */}
      {expandirIndicadores && (
        <>
          <div className="mb-4 rounded-[var(--t-card-radius)] border border-[var(--t-green)]/30 bg-gradient-to-br from-[var(--t-green)]/5 to-transparent p-5">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
                  Receita gerada (comissão)
                  <MetricExplainer
                    title="Receita da agência (CNAE 7911-2)"
                    text={'É o que sua agência ganha de fato — a margem das vendas após pagar fornecedores.\n\nDiferente de "Faturamento", que é o valor TOTAL transacionado (passagens, hotéis), e do qual a agência fica com apenas a comissão.'}
                  />
                </p>
                <p className="text-3xl font-bold text-[var(--t-green)]">{formatBRL(kpis?.receita_gerada || 0)}</p>
                <p className="text-[11px] text-[var(--t-text-muted)] mt-1">
                  Margem bruta de todas as vendas, antes de descontar pagamentos
                </p>
              </div>
              <div className="text-right">
                <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-1">
                  Margem do período
                </p>
                <p className={`text-2xl font-bold ${(kpis?.margem_pct || 0) >= 15 ? 'text-[var(--crm-ok)]' : (kpis?.margem_pct || 0) >= 8 ? 'text-[var(--t-amber)]' : 'text-[var(--crm-err)]'}`}>
                  {(kpis?.margem_pct || 0).toFixed(1)}%
                </p>
                <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
                  sobre {formatBRL(kpis?.faturamento_vendas || 0)} faturado
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bento-card">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
                Resultado projetado
                <MetricExplainer text="Quanto vai sobrar quando todas as contas pendentes forem liquidadas: a receber − a pagar." />
              </p>
              <p className={`text-2xl font-bold ${(kpis?.resultado_projetado || 0) >= 0 ? 'text-[var(--t-text)]' : 'text-[var(--crm-err)]'}`}>
                {formatBRL(kpis?.resultado_projetado || 0)}
              </p>
            </div>
            <div className="bento-card">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
                Faturamento
                <MetricExplainer text="Total recebido das vendas confirmadas (status RECEBIDO)." />
              </p>
              <p className="text-2xl font-bold text-[var(--crm-ok)]">{formatBRL(kpis?.recebido || 0)}</p>
            </div>
            <div className="bento-card">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
                Despesas
                <MetricExplainer text="Total já pago (status PAGO) — saídas reais do caixa." />
              </p>
              <p className="text-2xl font-bold text-[var(--crm-err)]">{formatBRL(kpis?.pago || 0)}</p>
            </div>
            <div className="bento-card">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide mb-2 flex items-center">
                Faturamento de vendas
                <MetricExplainer text="Valor total transacionado em vendas (incluindo pendentes). Volume operacional, NÃO é receita líquida." />
              </p>
              <p className="text-2xl font-bold text-[var(--t-text)]">{formatBRL(kpis?.faturamento_vendas || 0)}</p>
            </div>
          </div>
        </>
      )}

      {/* Quick Actions Bar — 3 atalhos de 1 clique pras ações mais usadas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <button
          onClick={() => router.push('/financeiro-ag/pagar')}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--crm-err)]/10 border border-[var(--crm-err)]/30 hover:bg-[var(--crm-err)]/15 text-[var(--crm-err)] font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nova despesa
        </button>
        <button
          onClick={() => router.push('/financeiro-ag/receber')}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--crm-ok)]/10 border border-[var(--crm-ok)]/30 hover:bg-[var(--crm-ok)]/15 text-[var(--crm-ok)] font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo recebimento
        </button>
        <button
          onClick={() => router.push('/financeiro-ag/fluxo-caixa')}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] font-medium transition-colors"
        >
          <TrendingDown className="w-4 h-4" /> Ver fluxo de caixa
        </button>
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
              <div className="px-4 py-8 text-center">
                <Receipt className="w-8 h-8 text-[var(--t-text-muted)] mx-auto mb-2 opacity-40" />
                <p className="text-[var(--text-body-sm)] text-[var(--t-text)] font-medium mb-1">Nada por aqui ainda</p>
                <p className="text-[11px] text-[var(--t-text-muted)] mb-3">Comece lançando uma despesa ou recebimento</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => router.push('/financeiro-ag/pagar')} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">+ Despesa</button>
                  <button onClick={() => router.push('/financeiro-ag/receber')} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">+ Recebimento</button>
                </div>
              </div>
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
