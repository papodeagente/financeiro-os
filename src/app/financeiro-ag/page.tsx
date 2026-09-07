'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, CreditCard, Receipt } from 'lucide-react';
import { CrmStatusBadge } from '@/components/CrmStatusBadge';
import { OnboardingChecklist, type OnboardingStep } from '@/components/financeiro/OnboardingChecklist';
import { ActionCard } from '@/components/fin/ActionCard';
import { DataState } from '@/components/fin/DataState';
import { DeltaIndicator, type DeltaIndicatorProps } from '@/components/fin/DeltaIndicator';
import type { EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { Button } from '@/components/ui/button';
import { calcLimiteUsado } from '@/lib/cartoes-utils';
import { calcularSaldoBancario, valorMovimentado } from '@/lib/saldo-bancario';
import { calcularHistoricoKpis, type HistoricoKpis } from '@/lib/historico-kpis';
import { round2, num, somaPor, divSegura, variacaoPct, hojeISO, mesDe } from '@/lib/money';
import { toast } from '@/lib/toast';
import type { CartaoCorporativo, ContaPagar, ContaReceber, ContaBancaria, VendaCRM, PlanoContas } from '@/lib/crm-types';

interface KPIs {
  saldo: number;
  a_receber: number;          // PENDENTE total (todos meses)
  recebido: number;            // RECEBIDO total
  a_pagar: number;             // PENDENTE total
  pago: number;                // PAGO total
  resultado_projetado: number; // a_receber - a_pagar
  resultado_realizado: number; // recebido - pago (all-time)
  recebido_mes: number;        // RECEBIDO com baixa no mês corrente
  pago_mes: number;            // PAGO com baixa no mês corrente
  lucro_mes: number;           // recebido_mes - pago_mes (é o "Lucro do mês")
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

type FiltroTipo = 'todas' | 'entradas' | 'saidas';

type LinhaLancamento = {
  chave: string;
  descricao: string;
  valor: number;
  tipo: string;
  data: string;
  origem: string;
};

const CHAVE_ONBOARDING = 'onboarding-financeiro-dismissed';

const OPCOES_TIPO: { valor: FiltroTipo; rotulo: string }[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'entradas', rotulo: 'Só entradas' },
  { valor: 'saidas', rotulo: 'Só saídas' },
];

function lerDispensa(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CHAVE_ONBOARDING) === 'true';
}

function EsqueletoFaixa() {
  return (
    <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
      <div className="flex flex-col gap-[var(--fin-s-4)] lg:flex-row lg:items-center">
        <div className="flex flex-col gap-[var(--fin-s-2)] lg:w-[300px] lg:shrink-0 lg:pr-[var(--fin-s-5)]">
          <span className="block h-3 w-24 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-8 w-52 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-3 w-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        </div>
        <div className="grid gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:grid-cols-3 lg:grow lg:border-t-0 lg:border-l lg:pt-0 lg:pl-[var(--fin-s-5)]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] p-[var(--fin-s-4)]"
            >
              <span className="block h-3 w-20 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
              <span className="block h-5 w-32 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
              <span className="block h-3 w-28 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function FinanceiroAgHubPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [, setCartoesKpi] = useState<CartoesKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [ultimos, setUltimos] = useState<Array<{ descricao: string; valor: number; tipo: string; data: string; origem: string }>>([]);
  // Estado para onboarding checklist
  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([]);
  const [onboardingDispensado, setOnboardingDispensado] = useState(false);
  // Frescor dos dados: carimbo só é escrito quando load() termina com sucesso
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);
  const [recarregando, setRecarregando] = useState(false);
  // Filtro da lista de lançamentos
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todas');
  // Série histórica computada (10 meses), alimenta os deltas reais
  const [historico, setHistorico] = useState<HistoricoKpis | null>(null);

  const load = useCallback(async () => {
    let sucesso = true;
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
          const limite = somaPor(cartoes, c => c.limite_total);
          const usado = somaPor(cartoes, c => calcLimiteUsado(c.id, pagar));
          const pct = round2(divSegura(usado, limite) * 100);
          setCartoesKpi({ limite, usado, pct, count: cartoes.filter(c => c.ativo).length });
        }

        // Totais all-time. "Este mês" zerava quando vencimentos caíam em mês
        // futuro (caso comum com vendas CRM cujas parcelas vencem em 30/60d).
        // Saldo bancário é COMPUTADO: saldo_inicial + recebido - pago. Não
        // depende de saldo_atual persistido (que pode estar stale se o user
        // marcou baixas antes do override PUT entrar em produção).
        const saldoBancario = calcularSaldoBancario(contasBancarias, receber, pagar);
        // "Em aberto" = o que ainda falta entrar/sair, incluindo o saldo
        // devedor das contas PARCIAIS e das vencidas. "Recebido/Pago" = o que
        // já se moveu no caixa (valorMovimentado conta o acumulado da parcial).
        // Os dois lados usam vocabulário DIFERENTE para vencido: contas a
        // receber usam ATRASADO, contas a pagar usam VENCIDO. Um predicado
        // único com ATRASADO deixava TODA conta a pagar vencida fora do
        // KPI "A pagar" e, por consequência, do resultado projetado. A
        // tela subestimava justamente as dívidas mais urgentes.
        const receberEmAberto = (s: string | undefined) =>
          ['PENDENTE', 'PARCIAL', 'ATRASADO'].includes(String(s ?? ''));
        const pagarEmAberto = (s: string | undefined) =>
          ['PENDENTE', 'PARCIAL', 'VENCIDO'].includes(String(s ?? ''));
        const aReceberTotal = somaPor(
          receber.filter(r => receberEmAberto(r.status)),
          r => round2(num(r.valor_final) - valorMovimentado(r, 'valor_recebido')),
        );
        const recebidoTotal = somaPor(receber, r => valorMovimentado(r, 'valor_recebido'));
        const aPagarTotal = somaPor(
          pagar.filter(p => pagarEmAberto(p.status)),
          p => round2(num(p.valor_final) - valorMovimentado(p, 'valor_pago')),
        );
        const pagoTotal = somaPor(pagar, p => valorMovimentado(p, 'valor_pago'));

        // Lucro do MÊS: só as baixas cujo mês de recebimento/pagamento é o
        // mês corrente. O card se chama "Lucro do mês" e a série é mensal;
        // usar o all-time aqui descasava rótulo e número.
        const mesAtual = mesDe(hojeISO());
        const recebidoMes = somaPor(
          receber.filter(r => mesDe(r.data_recebimento || r.data_vencimento) === mesAtual),
          r => valorMovimentado(r, 'valor_recebido'),
        );
        const pagoMes = somaPor(
          pagar.filter(p => mesDe(p.data_pagamento || p.data_vencimento) === mesAtual),
          p => valorMovimentado(p, 'valor_pago'),
        );

        // Receita gerada (comissão) das vendas, independente de baixa.
        // É a margem bruta acumulada: faturamento_vendas − custo_vendas.
        // Aceita tanto o shape novo (valor_total/custo_total) quanto o
        // legado (valor_total_venda/valor_total_custo).
        const vendasAtivas = vendas.filter(v => {
          const s = String(v.status ?? '').toUpperCase();
          return s !== 'CANCELADO';
        });
        const faturamentoVendas = somaPor(vendasAtivas, v =>
          num(v.valor_final) || num(v.valor_total_venda) || num(v.valor_total));
        const custoVendas = somaPor(vendasAtivas, v =>
          num(v.valor_total_custo) || num(v.custo_total));
        const receitaGerada = Math.max(round2(faturamentoVendas - custoVendas), 0);
        const margemPct = round2(divSegura(receitaGerada, faturamentoVendas) * 100);

        setKpis({
          saldo: saldoBancario,
          a_receber: aReceberTotal,
          recebido: recebidoTotal,
          a_pagar: aPagarTotal,
          pago: pagoTotal,
          resultado_projetado: round2(aReceberTotal - aPagarTotal),
          resultado_realizado: round2(recebidoTotal - pagoTotal),
          recebido_mes: recebidoMes,
          pago_mes: pagoMes,
          lucro_mes: round2(recebidoMes - pagoMes),
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

        // Histórico real de 10 meses para os deltas
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
            description: temCaixa ? 'Pronto, sua Caixa Geral está ativa.' : 'Toda baixa de pagamento e de recebimento entra ou sai daqui.',
            done: temCaixa,
            href: '/financeiro-ag/contas-bancarias',
          },
          {
            key: 'plano-contas',
            label: 'Categorias de entrada e saída configuradas',
            description: temPlanoContas ? `${plano.length} categorias prontas.` : 'Carregue as categorias padrão de agência de viagens em 1 clique.',
            done: temPlanoContas,
            href: '/financeiro-ag/plano-contas',
          },
          {
            key: 'primeira-despesa',
            label: 'Primeira conta a pagar lançada',
            description: temDespesa ? 'Tudo certo.' : 'Lance uma conta a pagar para começar a controlar o caixa.',
            done: temDespesa,
            href: '/financeiro-ag/pagar',
          },
          {
            key: 'primeiro-pagamento',
            label: 'Primeiro pagamento confirmado',
            description: temPagamento ? 'Você já marcou pagamentos como concluídos.' : 'Marque uma conta como paga para atualizar o saldo bancário.',
            done: temPagamento,
            href: '/financeiro-ag/pagar',
          },
        ]);

        setUltimaAtualizacao(new Date());
        setErro(false);
      } catch { setErro(true); sucesso = false; }
      setLoading(false);
      return sucesso;
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => { setOnboardingDispensado(lerDispensa()); }, []);

    const recarregar = async () => {
      setRecarregando(true);
      const sucesso = await load();
      setRecarregando(false);
      if (sucesso) toast.success('Dados atualizados');
      else toast.error('Não foi possível atualizar os dados');
    };

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';
  const estadoValor: MoneyEstado = estado === 'carregando' ? 'carregando' : estado === 'erro' ? 'indisponivel' : 'ok';

  // Indicadores essenciais, com deltas de HISTÓRICO REAL.
  // calcularHistoricoKpis computa 10 meses de série a partir das CRs/CPs
  // já carregadas (data_recebimento/data_pagamento agrupadas por mês).
  const histSaldo = historico?.saldo || [];
  const histReceber = historico?.aReceber || [];
  const histPagar = historico?.aPagar || [];
  const histLucro = historico?.lucro || [];
  // Delta = variação da MESMA grandeza entre o mês corrente e o anterior da
  // própria série. variacaoPct devolve null quando não há base (mês anterior
  // zerado). Nesse caso o delta some da tela em vez de mentir "+100%".
  const deltaSerie = (serie: number[]): number | null =>
    serie.length < 2 ? null : variacaoPct(serie[serie.length - 1], serie[serie.length - 2]);
  const direcao = (delta: number | null): 'up' | 'down' | 'flat' =>
    delta === null || Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down';
  const dSaldo = deltaSerie(histSaldo);
  const dReceber = deltaSerie(histReceber);
  const dPagar = deltaSerie(histPagar);
  const dLucro = deltaSerie(histLucro);
  const kpiList = [
    {
      chave: 'saldo',
      label: 'Em caixa hoje',
      value: kpis?.saldo || 0,
      sub: 'Somatório das contas bancárias, atualizado a cada baixa.',
      explainer: 'Total acumulado nas suas contas bancárias. Atualiza automaticamente quando você confirma um recebimento ou pagamento.',
      tone: (kpis?.saldo || 0) >= 0 ? 'pos' : 'neg',
      polaridade: 'subirBom' as const,
      delta: dSaldo,
      deltaDir: direcao(dSaldo),
    },
    {
      chave: 'a_receber',
      label: 'A receber',
      value: kpis?.a_receber || 0,
      sub: 'Em aberto, de qualquer vencimento.',
      explainer: 'Soma de todas as contas a receber em aberto, independente do mês de vencimento.',
      tone: 'neutral' as const,
      polaridade: 'subirBom' as const,
      delta: dReceber,
      deltaDir: direcao(dReceber),
    },
    {
      chave: 'a_pagar',
      label: 'A pagar',
      value: kpis?.a_pagar || 0,
      sub: 'Em aberto, de qualquer vencimento.',
      explainer: 'Soma de todas as contas a pagar em aberto, independente do mês de vencimento.',
      tone: 'neutral' as const,
      polaridade: 'subirRuim' as const,
      delta: dPagar,
      deltaDir: direcao(dPagar),
    },
    {
      chave: 'lucro_mes',
      label: 'Resultado do mês',
      value: kpis?.lucro_mes || 0,
      sub: 'O que entrou menos o que saiu neste mês.',
      explainer: 'Resultado realizado do mês corrente: o que entrou no caixa menos o que saiu, pela data da baixa. Não inclui valores em aberto.',
      tone: (kpis?.lucro_mes || 0) >= 0 ? 'pos' : 'neg',
      polaridade: 'subirBom' as const,
      delta: dLucro,
      deltaDir: direcao(dLucro),
    },
  ];
  const [saldoKpi, ...kpisSecundarios] = kpiList;

  // Cor entra só quando o sinal muda a decisão: saldo positivo é neutro,
  // saldo negativo é vermelho porque exige ação.
  const tomDoValor = (tone: string): 'neutro' | 'negativo' => (tone === 'neg' ? 'negativo' : 'neutro');
  const deltaDe = (
    delta: number | null,
    dir: 'up' | 'down' | 'flat',
    polaridade: 'subirBom' | 'subirRuim',
  ): DeltaIndicatorProps | null =>
    delta === null || dir === 'flat' ? null : { pct: delta, direcao: dir, polaridade, base: 'vs. mês anterior' };

  const lancamentos: LinhaLancamento[] = ultimos
    .map((item, i) => ({ ...item, chave: `${item.tipo}-${i}` }))
    // Ordem de exibição por vencimento, intercalando entradas e saídas.
    // Datas são strings civis YYYY-MM-DD: comparação direta, sem new Date.
    .sort((a, b) => {
      if (!a.data && !b.data) return 0;
      if (!a.data) return 1;
      if (!b.data) return -1;
      return a.data.localeCompare(b.data);
    });
  const lancamentosFiltrados = lancamentos.filter(item => {
    if (filtroTipo === 'entradas') return item.tipo === 'receber';
    if (filtroTipo === 'saidas') return item.tipo === 'pagar';
    return true;
  });

  const colunas: FinColuna<LinhaLancamento>[] = [
    {
      id: 'vencimento',
      cabecalho: 'Vencimento',
      tipo: 'data',
      valor: (r) => r.data || null,
      minWidth: 92,
      sortable: true,
    },
    {
      id: 'descricao',
      cabecalho: 'Descrição',
      tipo: 'texto',
      minWidth: 240,
      sortable: true,
      acessor: (r) => r.descricao,
      render: (r) => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{r.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {r.tipo === 'receber' ? 'Conta a receber' : 'Conta a pagar'}
          </span>
        </span>
      ),
    },
    {
      id: 'origem',
      cabecalho: 'Origem',
      tipo: 'status',
      dominio: 'origem',
      valor: (r) => (r.origem === 'crm' ? 'CRM' : 'MANUAL'),
      prioridade: 1,
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      minWidth: 112,
      sortable: true,
      valor: (r) => (r.tipo === 'pagar' ? -r.valor : r.valor),
      sub: (r) => (r.tipo === 'receber' ? 'Entrada' : 'Saída'),
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      render: (r) => (
        <Button
          variant="outline"
          className="fin-t-body h-11 rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] shadow-none lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0"
          render={
            <Link
              href={r.tipo === 'receber' ? '/financeiro-ag/receber' : '/financeiro-ag/pagar'}
              aria-label={`Abrir ${r.descricao}`}
            />
          }
        >
          Abrir
        </Button>
      ),
    },
  ];

  const vazio: EmptyLessonProps =
    lancamentos.length === 0
      ? {
          motivo: 'sem-dado',
          titulo: 'Nenhuma conta lançada ainda',
          oQueE: 'Aqui aparecem as contas a pagar e a receber da agência, com vencimento, origem e valor.',
          comoComeca: [
            'Cadastre a conta bancária por onde o dinheiro entra e sai.',
            'Lance a primeira conta a pagar, por exemplo o acerto de um fornecedor.',
            'Marque como paga quando o dinheiro sair; o saldo em caixa se atualiza sozinho.',
          ],
          acao: { rotulo: 'Lançar conta a pagar', href: '/financeiro-ag/pagar' },
        }
      : {
          motivo: 'sem-resultado',
          titulo: 'Nenhuma conta neste filtro',
          oQueE: `Existem ${lancamentos.length} contas lançadas, mas nenhuma delas é do tipo escolhido.`,
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => setFiltroTipo('todas') },
        };

  const passosPendentes = onboardingSteps.some(s => !s.done);
  const configuracaoPendente = estado === 'ok' && onboardingSteps.length > 0 && passosPendentes && !onboardingDispensado;

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col">
        <PageHeader
          titulo="Financeiro"
          subtitulo="Saldo em caixa e as contas a pagar e a receber da agência."
          badge={<CrmStatusBadge variant="compacto" />}
          atualizadoEm={ultimaAtualizacao}
          onRecarregar={recarregar}
        />

        <div aria-busy={recarregando} className="mt-[var(--fin-s-6)] flex flex-col gap-[var(--fin-s-5)]">
          {configuracaoPendente ? (
            <div
              onClick={() => setOnboardingDispensado(lerDispensa())}
              className="flex flex-col gap-[var(--fin-s-3)]"
            >
              <p className="fin-t-body text-[var(--fin-text-2)]">
                Termine a configuração para o painel mostrar números confiáveis. Falta pouco.
              </p>
              <OnboardingChecklist steps={onboardingSteps} />
            </div>
          ) : (
            <>
              <DataState
                estado={estado}
                erro={{ mensagem: 'A consulta ao financeiro falhou. Nenhum lançamento foi alterado.', onTentarDeNovo: load }}
                esqueleto={<EsqueletoFaixa />}
              >
                <section
                  aria-labelledby="fin-em-caixa"
                  className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]"
                >
                  <div className="flex flex-col gap-[var(--fin-s-4)] lg:flex-row lg:items-center">
                    <div className="flex flex-col gap-[var(--fin-s-1)] lg:w-[300px] lg:shrink-0 lg:pr-[var(--fin-s-5)]">
                      <h2 id="fin-em-caixa" className="fin-t-overline text-[var(--fin-text-3)]">
                        {saldoKpi.label}
                      </h2>
                      <Money
                        valor={saldoKpi.value}
                        estado={estadoValor}
                        size="metric"
                        align="esquerda"
                        tone={tomDoValor(saldoKpi.tone)}
                      />
                      {(() => {
                        const delta = deltaDe(saldoKpi.delta, saldoKpi.deltaDir, saldoKpi.polaridade);
                        return delta ? <DeltaIndicator {...delta} /> : null;
                      })()}
                      <p className="fin-t-caption text-[var(--fin-text-2)]">{saldoKpi.sub}</p>
                    </div>

                    <div className="grid gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:grid-cols-3 lg:grow lg:border-t-0 lg:border-l lg:pt-0 lg:pl-[var(--fin-s-5)]">
                      {kpisSecundarios.map(kpi => (
                        <MetricCard
                          key={kpi.chave}
                          rotulo={kpi.label}
                          valor={kpi.value}
                          estado={estadoValor}
                          contexto={kpi.sub}
                          explicacao={kpi.explainer}
                          tone={tomDoValor(kpi.tone)}
                          delta={deltaDe(kpi.delta, kpi.deltaDir, kpi.polaridade)}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              </DataState>

              <section aria-labelledby="fin-lancamentos" className="flex flex-col gap-[var(--fin-s-3)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
                  <h2 id="fin-lancamentos" className="fin-t-subhead text-[var(--fin-text)]">
                    Contas a pagar e a receber
                  </h2>
                  <Link
                    href="/financeiro-ag/pagar"
                    className="fin-t-body inline-flex min-h-11 items-center rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-10"
                  >
                    Ver todas as contas a pagar
                  </Link>
                </div>

                {estado === 'ok' ? (
                  <FilterBar
                    selects={[
                      {
                        id: 'filtro-tipo',
                        rotulo: 'Tipo',
                        valor: filtroTipo,
                        opcoes: OPCOES_TIPO,
                        onChange: (v) => setFiltroTipo(v as FiltroTipo),
                      },
                    ]}
                    resumo={{
                      exibidos: lancamentosFiltrados.length,
                      total: lancamentos.length,
                      substantivo: 'contas lançadas recentemente',
                    }}
                    ativos={filtroTipo === 'todas' ? 0 : 1}
                    onLimpar={() => setFiltroTipo('todas')}
                  />
                ) : null}

                <FinTable
                  linhas={lancamentosFiltrados}
                  colunas={colunas}
                  chave={(r) => r.chave}
                  estado={estado}
                  erro={{ mensagem: 'A lista de contas não pôde ser carregada.', onTentarDeNovo: load }}
                  vazio={vazio}
                />
              </section>

              <section aria-label="Ações do financeiro" className="grid gap-[var(--fin-s-4)] sm:grid-cols-3">
                <ActionCard
                  rotulo="Nova conta a pagar"
                  descricao="Lançar uma despesa ou o acerto de um fornecedor"
                  icone={CreditCard}
                  href="/financeiro-ag/pagar"
                />
                <ActionCard
                  rotulo="Nova conta a receber"
                  descricao="Lançar uma parcela que o cliente ainda vai pagar"
                  icone={Receipt}
                  href="/financeiro-ag/receber"
                />
                <ActionCard
                  rotulo="Conciliar contas"
                  descricao="Comparar o extrato do banco com o que está lançado"
                  icone={ArrowRightLeft}
                  variante="primaria"
                  href="/financeiro-ag/conciliacao"
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
