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
import { Sparkline } from '@/components/financeiro/Sparkline';
import { MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { formatBRL } from '@/lib/utils';
import { calcLimiteUsado } from '@/lib/cartoes-utils';
import { useModoIniciante } from '@/lib/modo-iniciante';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { calcularHistoricoKpis, calcDelta, type HistoricoKpis } from '@/lib/historico-kpis';
import { toast } from '@/lib/toast';
import type { CartaoCorporativo, ContaPagar, ContaReceber, ContaBancaria, VendaCRM, PlanoContas } from '@/lib/crm-types';
import {
  BarChart3, FileSpreadsheet, Receipt, CreditCard,
  ArrowRightLeft, BookOpen, Landmark, Package,
  ListOrdered, FileText, RefreshCw, ChevronDown, ChevronUp,
  ArrowRight,
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
  // Período do header — atualmente visual (filtro funcional vem depois)
  const [periodoHeader, setPeriodoHeader] = useState<'hoje' | '7d' | 'mes' | 'trimestre' | 'ano'>('mes');
  // Tab das movimentações
  const [movsTab, setMovsTab] = useState<'todas' | 'entradas' | 'saidas' | 'nc'>('todas');
  // Série histórica computada (10 meses) — alimenta sparklines e deltas reais
  const [historico, setHistorico] = useState<HistoricoKpis | null>(null);

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

        // Histórico real de 10 meses para sparklines e deltas
        setHistorico(calcularHistoricoKpis(contasBancarias, receber, pagar, 10));

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

  // KPIs essenciais — sparklines e deltas com HISTÓRICO REAL.
  // calcularHistoricoKpis computa 10 meses de série a partir das CRs/CPs
  // já carregadas (data_recebimento/data_pagamento agrupadas por mês).
  // Sem histórico → série fica em zeros (estado válido pra workspace novo).
  const histSaldo = historico?.saldo || [];
  const histReceber = historico?.aReceber || [];
  const histPagar = historico?.aPagar || [];
  const histLucro = historico?.lucro || [];
  const dSaldo = calcDelta(histSaldo);
  const dReceber = calcDelta(histReceber);
  const dPagar = calcDelta(histPagar);
  const dLucro = calcDelta(histLucro);
  const kpiList = [
    {
      idx: '01',
      label: 'Saldo bancário',
      value: kpis?.saldo || 0,
      sub: 'Somatório das contas correntes.',
      explainer: 'Total acumulado nas suas contas bancárias. Atualiza automaticamente quando você confirma um recebimento ou pagamento.',
      tone: (kpis?.saldo || 0) >= 0 ? 'pos' : 'neg',
      delta: dSaldo.delta,
      deltaDir: dSaldo.dir,
      spark: histSaldo,
    },
    {
      idx: '02',
      label: 'A receber (pendente)',
      value: kpis?.a_receber || 0,
      sub: 'Total ainda não recebido neste mês.',
      explainer: 'Soma de todas as contas a receber com status PENDENTE, independente do mês de vencimento.',
      tone: 'neutral' as const,
      delta: dReceber.delta,
      deltaDir: dReceber.dir,
      spark: histReceber,
    },
    {
      idx: '03',
      label: 'A pagar (pendente)',
      value: kpis?.a_pagar || 0,
      sub: 'Total ainda não pago neste mês.',
      explainer: 'Soma de todas as contas a pagar com status PENDENTE, independente do mês de vencimento.',
      tone: 'neutral' as const,
      delta: dPagar.delta,
      deltaDir: dPagar.dir,
      spark: histPagar,
    },
    {
      idx: '04',
      label: 'Lucro do mês',
      value: kpis?.resultado_realizado || 0,
      sub: 'Recebido menos pago neste mês.',
      explainer: 'Resultado realizado: tudo que entrou no caixa menos tudo que saiu. Não inclui valores pendentes.',
      tone: (kpis?.resultado_realizado || 0) >= 0 ? 'pos' : 'neg',
      delta: dLucro.delta,
      deltaDir: dLucro.dir,
      spark: histLucro,
    },
  ];

  return (
    <PageShell header={<PageHeader title="Financeiro" crmBadge />}>
    <div className="min-shell">

      {/* Onboarding checklist — esconde quando dispensado ou 4/4 completo */}
      {onboardingSteps.length > 0 && <OnboardingChecklist steps={onboardingSteps} />}

      {/* Head row — H1 + meta à esquerda · segmented control período à direita */}
      <div className="flex items-end justify-between pb-6 mb-8 border-b" style={{ borderColor: 'var(--line)' }}>
        <div>
          <h1 style={{ fontSize: '42px', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1, margin: 0 }}>Financeiro</h1>
          <div className="mt-2.5 text-[12px] flex items-center gap-4" style={{ color: 'var(--ink-3)' }}>
            <span>
              {(() => {
                const h = new Date().getHours();
                const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
                return <>{greeting}, <b className="mono" style={{ fontSize: '11px', color: 'var(--ink-2)' }}>Bruno</b></>;
              })()}
            </span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span>
              Atualizado às <b className="mono" style={{ fontSize: '11px', color: 'var(--ink-2)' }}>
                {ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </b>
            </span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <button
              onClick={recarregar}
              disabled={recarregando}
              className="inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'var(--ink-4)' }}
            >
              <RefreshCw className={`w-3 h-3 ${recarregando ? 'animate-spin' : ''}`} />
              <span>{recarregando ? 'Atualizando…' : 'Recarregar'}</span>
            </button>
          </div>
        </div>
        <div className="flex items-stretch border" style={{ borderColor: 'var(--line)', height: '34px' }}>
          {(['hoje', '7d', 'mes', 'trimestre', 'ano'] as const).map((p, i, arr) => {
            const label = { hoje: 'Hoje', '7d': '7d', mes: 'Mês', trimestre: 'Trimestre', ano: 'Ano' }[p];
            const isActive = periodoHeader === p;
            return (
              <button
                key={p}
                onClick={() => setPeriodoHeader(p)}
                className="px-4 text-[12px] transition-colors"
                style={{
                  color: isActive ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: isActive ? 500 : 400,
                  background: isActive ? 'var(--ink-surface-2)' : 'transparent',
                  borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ver mais indicadores — link sutil acima dos KPIs */}
      <div className="flex items-center justify-end mb-3 px-1">
        <button
          onClick={() => setExpandirIndicadores(v => !v)}
          className="text-[11px] inline-flex items-center gap-1 transition-colors"
          style={{ color: 'var(--ink-3)' }}
        >
          {expandirIndicadores ? (
            <><ChevronUp className="w-3 h-3" /> Ocultar indicadores avançados</>
          ) : (
            <><ChevronDown className="w-3 h-3" /> Ver mais indicadores</>
          )}
        </button>
      </div>

      {/* KPI Row — 4 colunas hairline · label uppercase + idx mono · valor 38px
          · delta com seta + comparativo · sub · sparkline 1.2px */}
      <div className="min-kpis mb-10">
        {kpiList.map(kpi => {
          const dirGlyph = kpi.deltaDir === 'up' ? '▲' : kpi.deltaDir === 'down' ? '▼' : '—';
          const dirColor = kpi.deltaDir === 'up' ? 'var(--pos)' : kpi.deltaDir === 'down' ? 'var(--neg)' : 'var(--ink-3)';
          return (
            <div key={kpi.idx} className="min-kpi">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase" style={{ letterSpacing: '0.1em', color: 'var(--ink-3)' }}>
                <span className="flex items-center">
                  {kpi.label}
                  <MetricExplainer title={kpi.label} text={kpi.explainer} />
                </span>
                <span className="mono" style={{ fontSize: '10px', color: 'var(--ink-4)' }}>{kpi.idx}</span>
              </div>
              <div
                className="mt-6 min-tabular"
                style={{
                  fontSize: '38px',
                  fontWeight: 500,
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                  color: kpi.tone === 'neg' ? 'var(--neg)' : kpi.tone === 'pos' ? 'var(--pos)' : 'var(--ink)',
                }}
              >
                {formatBRL(kpi.value)}
              </div>
              {/* Delta */}
              <div className="mt-2.5 text-[12px] font-medium min-tabular inline-flex items-baseline gap-1.5" style={{ color: 'var(--ink-2)' }}>
                <span style={{ fontSize: '9px', color: dirColor }}>{dirGlyph}</span>
                <span>
                  {kpi.deltaDir === 'flat' ? '0,0%' : `${kpi.delta > 0 ? '+' : ''}${kpi.delta.toFixed(1).replace('.', ',')}%`}
                </span>
                <span style={{ color: 'var(--ink-3)' }}>vs mês anterior</span>
              </div>
              <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)', lineHeight: 1.5 }}>{kpi.sub}</p>
              <div
                className="mt-4"
                style={{
                  color: kpi.tone === 'neg' ? 'var(--neg)' : kpi.tone === 'pos' ? 'var(--pos)' : 'var(--ink)',
                }}
              >
                <Sparkline data={kpi.spark} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Indicadores avançados — só quando expandido */}
      {expandirIndicadores && (
        <div className="mb-10">
          {/* Card destaque: Receita gerada */}
          <div
            className="mb-2 p-7 border-t border-b"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-surface-2)' }}
          >
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="min-section-title flex items-center mb-2">
                  <span><b>Receita gerada</b> (comissão real da agência)</span>
                  <MetricExplainer
                    title="Receita da agência (CNAE 7911-2)"
                    text={'É o que sua agência ganha de fato — a margem das vendas após pagar fornecedores.\n\nDiferente de "Faturamento", que é o valor TOTAL transacionado (passagens, hotéis), e do qual a agência fica com apenas a comissão.'}
                  />
                </p>
                <p
                  className="min-tabular"
                  style={{
                    fontSize: '34px', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1,
                    color: 'var(--pos)',
                  }}
                >
                  {formatBRL(kpis?.receita_gerada || 0)}
                </p>
                <p className="text-[12px] mt-2" style={{ color: 'var(--ink-3)' }}>
                  Margem bruta de todas as vendas, antes de descontar pagamentos
                </p>
              </div>
              <div className="text-right">
                <p className="min-section-title mb-1">Margem do período</p>
                <p
                  className="min-tabular"
                  style={{
                    fontSize: '26px', fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1,
                    color: (kpis?.margem_pct || 0) >= 15 ? 'var(--pos)' : (kpis?.margem_pct || 0) >= 8 ? 'var(--warn)' : 'var(--neg)',
                  }}
                >
                  {(kpis?.margem_pct || 0).toFixed(1)}%
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>
                  sobre {formatBRL(kpis?.faturamento_vendas || 0)} faturado
                </p>
              </div>
            </div>
          </div>

          {/* 4 KPIs avançados em hairline grid */}
          <div className="min-kpis">
            {[
              { label: 'Resultado projetado', value: kpis?.resultado_projetado || 0, explainer: 'Quanto vai sobrar quando todas as contas pendentes forem liquidadas: a receber − a pagar.', idx: '05', tone: (kpis?.resultado_projetado || 0) >= 0 ? 'neutral' : 'neg' },
              { label: 'Faturamento', value: kpis?.recebido || 0, explainer: 'Total recebido das vendas confirmadas (status RECEBIDO).', idx: '06', tone: 'pos' as const },
              { label: 'Despesas', value: kpis?.pago || 0, explainer: 'Total já pago (status PAGO) — saídas reais do caixa.', idx: '07', tone: 'neg' as const },
              { label: 'Faturamento de vendas', value: kpis?.faturamento_vendas || 0, explainer: 'Valor total transacionado em vendas (incluindo pendentes). Volume operacional, NÃO é receita líquida.', idx: '08', tone: 'neutral' as const },
            ].map(k => (
              <div key={k.idx} className="min-kpi">
                <div className="flex items-center justify-between text-[11px] font-medium uppercase" style={{ letterSpacing: '0.1em', color: 'var(--ink-3)' }}>
                  <span className="flex items-center">
                    {k.label}
                    <MetricExplainer title={k.label} text={k.explainer} />
                  </span>
                  <span className="mono" style={{ fontSize: '10px', color: 'var(--ink-4)' }}>{k.idx}</span>
                </div>
                <div
                  className="mt-6 min-tabular"
                  style={{
                    fontSize: '30px', fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1,
                    color: k.tone === 'neg' ? 'var(--neg)' : k.tone === 'pos' ? 'var(--pos)' : 'var(--ink)',
                  }}
                >
                  {formatBRL(k.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Row — hairline grid 4 colunas. Conciliar (4ª) é o accent
          preto sólido conforme handoff. */}
      <div className="min-actions mb-10">
        <button onClick={() => router.push('/financeiro-ag/pagar')} className="min-action">
          <span className="flex items-center gap-3">
            <span className="mono text-[13px]" style={{ color: 'var(--ink-3)' }}>+</span>
            <span>Nova despesa</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
        </button>
        <button onClick={() => router.push('/financeiro-ag/receber')} className="min-action">
          <span className="flex items-center gap-3">
            <span className="mono text-[13px]" style={{ color: 'var(--ink-3)' }}>+</span>
            <span>Novo recebimento</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
        </button>
        <button onClick={() => router.push('/financeiro-ag/fluxo-caixa')} className="min-action">
          <span className="flex items-center gap-3">
            <span className="mono text-[13px]" style={{ color: 'var(--ink-3)' }}>↗</span>
            <span>Ver fluxo de caixa</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
        </button>
        <button onClick={() => router.push('/financeiro-ag/conciliacao')} className="min-action accent">
          <span className="flex items-center gap-3">
            <span className="mono text-[13px] opacity-60">→</span>
            <span>Conciliar contas</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 opacity-60" />
        </button>
      </div>

      {/* Cartões corporativos — linha hairline com 3 stats em mono */}
      {cartoesKpi && !modoIniciante && (
        <Link
          href="/financeiro-ag/cartoes"
          className="block mb-10 px-7 py-5 border-t border-b transition-colors hover:bg-[var(--ink-surface-2)]"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <CreditCard className="w-5 h-5" style={{ color: 'var(--ink-3)' }} />
              <div className="min-w-0">
                <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>Cartões corporativos</p>
                <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>{cartoesKpi.count} cartão{cartoesKpi.count !== 1 ? 'es' : ''} ativo{cartoesKpi.count !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-8 flex-wrap">
              {[
                { label: 'Limite', value: formatBRL(cartoesKpi.limite), color: 'var(--ink)' },
                { label: 'Usado', value: formatBRL(cartoesKpi.usado), color: 'var(--ink)' },
                {
                  label: 'Utilização',
                  value: `${cartoesKpi.pct.toFixed(1)}%`,
                  color: cartoesKpi.pct > 85 ? 'var(--neg)' : cartoesKpi.pct > 60 ? 'var(--warn)' : 'var(--pos)',
                },
              ].map(s => (
                <div key={s.label} className="text-right">
                  <p className="min-section-title">{s.label}</p>
                  <p className="text-[15px] font-medium min-tabular mt-1" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Link>
      )}

      {/* Acesso rápido — hairline grid 4 colunas com índice mono */}
      <div className="flex items-baseline justify-between mb-4">
        <span className="min-section-title">
          <b>Acesso rápido</b> Seções utilizadas com mais frequência
        </span>
        <Link
          href="/config/agencia"
          className="text-[12px]"
          style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'var(--ink-4)' }}
        >
          Personalizar
        </Link>
      </div>
      <div className="min-quick mb-10">
        {SHORTCUTS.slice(0, 4).map((item, i) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="min-qcard group">
              <div className="flex items-center justify-between">
                <Icon className="w-5 h-5" style={{ color: 'var(--ink-3)' }} />
                <span className="mono" style={{ fontSize: '10px', color: 'var(--ink-4)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <div>
                <p className="text-[18px] font-medium" style={{ letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.15 }}>{item.label}</p>
                <p className="text-[12.5px] mt-1.5" style={{ color: 'var(--ink-3)', lineHeight: 1.4 }}>{item.desc}</p>
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Bottom: Últimas movimentações (2/3) + Integração CRM (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-10">
        {/* Movimentações */}
        <section className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <span className="min-section-title">
              <b>Últimas movimentações</b> Conta principal
            </span>
            <Link
              href="/financeiro-ag/pagar"
              className="text-[12px]"
              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'var(--ink-4)' }}
            >
              Ver tudo
            </Link>
          </div>
          {/* Tabs */}
          <div className="flex gap-5 mb-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {(['todas', 'entradas', 'saidas', 'nc'] as const).map(t => {
              const label = { todas: 'Todas', entradas: 'Entradas', saidas: 'Saídas', nc: 'Não conciliadas' }[t];
              const active = movsTab === t;
              return (
                <button
                  key={t}
                  onClick={() => setMovsTab(t)}
                  className="pb-1.5 transition-colors"
                  style={{
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    fontWeight: active ? 500 : 400,
                    borderBottom: active ? '1px solid var(--ink)' : '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="min-mov-list">
            {(() => {
              // Aplica filtro de tab (visual; "não conciliadas" = manuais por hora,
              // que mapeia ao caso real de itens sem extrato vinculado)
              const filtrados = ultimos.filter(item => {
                if (movsTab === 'entradas') return item.tipo === 'receber';
                if (movsTab === 'saidas') return item.tipo === 'pagar';
                if (movsTab === 'nc') return item.origem !== 'crm';
                return true;
              });
              if (filtrados.length === 0) {
                return (
                  <div className="py-10 text-center">
                    <Receipt className="w-7 h-7 mx-auto mb-3 opacity-40" style={{ color: 'var(--ink-3)' }} />
                    <p className="text-[13px] font-medium mb-1" style={{ color: 'var(--ink)' }}>Nada por aqui ainda</p>
                    <p className="text-[11px] mb-4" style={{ color: 'var(--ink-3)' }}>
                      {ultimos.length === 0
                        ? 'Comece lançando uma despesa ou recebimento'
                        : 'Tente outra aba acima'}
                    </p>
                    {ultimos.length === 0 && (
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => router.push('/financeiro-ag/pagar')}
                          className="text-xs px-3 py-1.5 border transition-colors hover:bg-[var(--ink-surface-2)]"
                          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                        >
                          + Despesa
                        </button>
                        <button
                          onClick={() => router.push('/financeiro-ag/receber')}
                          className="text-xs px-3 py-1.5 border transition-colors hover:bg-[var(--ink-surface-2)]"
                          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                        >
                          + Recebimento
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              return filtrados.map((item, i) => {
                const idxStr = String(i + 1).padStart(3, '0');
                const isReceber = item.tipo === 'receber';
                // Tag inteligente: CRM se veio do CRM; Recorrente se descrição
                // tem padrão de recorrência (parcela X/Y); senão Manual
                const isRecorrente = /\(\d+\/\d+/.test(item.descricao);
                const tagText = item.origem === 'crm' ? 'CRM' : isRecorrente ? 'RECORRENTE' : 'MANUAL';
                const tagCrm = item.origem === 'crm';
                return (
                  <div key={i} className="min-mov">
                    <span className="mono" style={{ fontSize: '10px', color: 'var(--ink-4)' }}>{idxStr}</span>
                    <div>
                      <p className="text-[14px] font-medium" style={{ color: 'var(--ink)', letterSpacing: '-0.008em' }}>{item.descricao}</p>
                      <p className="mono mt-0.5" style={{ fontSize: '11px', color: 'var(--ink-3)' }}>{item.data}</p>
                    </div>
                    <span className={`min-tag ${tagCrm ? 'crm' : ''}`}>
                      {tagText}
                    </span>
                    <span
                      className="text-[14.5px] font-medium min-tabular text-right"
                      style={{
                        minWidth: '110px',
                        color: isReceber ? 'var(--pos)' : 'var(--neg)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {isReceber ? '+' : '−'}{formatBRL(item.valor)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </section>

        {/* Integração CRM */}
        <aside>
          <div className="flex items-baseline justify-between mb-3">
            <span className="min-section-title"><b>Integração CRM</b></span>
            <Link
              href="/config/crm"
              className="text-[12px]"
              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'var(--ink-4)' }}
            >
              Configurar
            </Link>
          </div>
          <div className="border-t border-b" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between py-3.5 border-b" style={{ borderColor: 'var(--line)' }}>
              <span className="min-section-title">Status</span>
              <CrmStatusBadge variant="completo" />
            </div>
            <div className="flex items-center justify-between py-3.5 border-b" style={{ borderColor: 'var(--line)' }}>
              <span className="min-section-title">Última sincronização</span>
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>agora</span>
            </div>
            <div className="flex items-center justify-between py-3.5 border-b" style={{ borderColor: 'var(--line)' }}>
              <span className="min-section-title">Movimentações importadas</span>
              <span className="text-[13px] font-medium min-tabular" style={{ color: 'var(--ink)' }}>
                {ultimos.filter(u => u.origem === 'crm').length}
              </span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="min-section-title">Última venda importada</span>
              <span className="text-[13px] font-medium mono" style={{ color: 'var(--ink)' }}>
                {(() => {
                  const ultimaVenda = ultimos.find(u => u.origem === 'crm' && /VND-/.test(u.descricao));
                  const match = ultimaVenda?.descricao.match(/VND-\d+/);
                  return match ? match[0] : '—';
                })()}
              </span>
            </div>
          </div>
          {/* Links de ação */}
          <div className="mt-5 flex flex-col gap-2.5">
            <Link
              href="/config/crm"
              className="text-[13px] flex items-center justify-between"
              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '4px', textDecorationColor: 'var(--ink-4)' }}
            >
              <span>Ver log completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/config/crm"
              className="text-[13px] flex items-center justify-between"
              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '4px', textDecorationColor: 'var(--ink-4)' }}
            >
              <span>Forçar sincronização</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {/* Mini bar chart 14h — visual de atividade */}
          <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="min-section-title">Sincronizações · 14h</span>
              <span className="mono text-[11px]" style={{ color: 'var(--ink-3)' }}>312 evts</span>
            </div>
            <div className="flex items-end gap-[3px] h-[60px] border-b pb-px" style={{ borderColor: 'var(--line)' }}>
              {[18, 24, 22, 28, 30, 26, 32, 28, 34, 30, 36, 32, 30, 12].map((h, i) => (
                <span
                  key={i}
                  className="flex-1"
                  style={{
                    height: `${h}px`,
                    minHeight: '1px',
                    background: i === 13 ? 'var(--ink-4)' : 'var(--ink)',
                  }}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>

      <MinimalFooter pageId="visão geral" />

    </div>
    </PageShell>
  );
}
