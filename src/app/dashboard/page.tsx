'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { loadEntities, loadEquipe } from '@/lib/crm-storage';
import type {
  Cliente, VendaCRM, ContaReceber, ContaPagar,
  ContaBancaria, CACMensal, MetaVendedor, Membro,
  StatusVendaCRM,
} from '@/lib/crm-types';
import { nomeDoCliente } from '@/lib/cliente-nome';
import {
  ShoppingCart, Users, AlertTriangle, ChevronRight,
  FileText, Package, Receipt, CreditCard,
  Cake, MessageCircle,
  AlertCircle, CheckCircle2, Info,
} from 'lucide-react';
import {
  round2, num, soma, somaPor, percentual, divSegura, variacaoPct, paraBRL,
  hojeISO, dataLocal, mesDe,
} from '@/lib/money';
import { calcularSaldoBancario, valorMovimentado } from '@/lib/saldo-bancario';
// Componentes canônicos do padrão financeiro (/financeiro-ag). O painel usa
// os mesmos, para o sistema inteiro falar uma língua visual só.
import { PageHeader } from '@/components/fin/PageHeader';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { DeltaIndicator, type DeltaIndicatorProps } from '@/components/fin/DeltaIndicator';
import { DataState } from '@/components/fin/DataState';
import { ActionCard } from '@/components/fin/ActionCard';
import { Meter } from '@/components/fin/Meter';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (s: string) => dataLocal(s)?.toLocaleDateString('pt-BR') ?? '-';

// Hoje no fuso do tenant — toISOString() virava o dia às 21h no BRT.
const today = () => hojeISO();
const thisMonth = () => mesDe(hojeISO());

function daysUntil(dateStr: string): number {
  const d = dataLocal(dateStr);
  const now = dataLocal(hojeISO());
  if (!d || !now) return 0;
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function prevMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

function getMesLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(m) - 1]}/${y.slice(2)}`;
}

function getMonthName(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${meses[parseInt(m) - 1]} ${y}`;
}

// VendaCRM tem 2 formas no banco:
// 1) Legacy: campos completos (numero, produtos[], valor_final, valor_total_custo,
//    markup_realizado, status='CONFIRMADO'|...) — vindo da UI /vendas/nova
// 2) Nova (vinda do VENDA_FECHADA do CRM): valor_total/custo_total/comissao/
//    rentabilidade, status='vendido', sem produtos[] (vendas fechadas pelo
//    funil do CRM ainda não detalhadas por produto)
//
// O dashboard espera (1). normalizeVenda mapeia (2) para o shape (1) para
// que reduce/forEach em produtos não estourem.
//
// ATENÇÃO: `markup_realizado` tem DOIS significados no banco — percentual de
// markup na venda digitada em /vendas/nova e valor absoluto de comissão nas
// vendas vindas do CRM. Por isso ele NUNCA entra em somatório de dinheiro;
// normalizeVenda deriva `receita_agencia` em R$ e é esse campo que o
// dashboard soma.
type VendaDash = VendaCRM & { receita_agencia: number };

function normalizeVenda(v: Partial<VendaCRM> & Record<string, unknown>): VendaDash {
  const statusRaw = String(v.status ?? '').toLowerCase();
  const status: StatusVendaCRM =
    statusRaw === 'vendido' ? 'CONFIRMADO' :
    (['ORCAMENTO', 'RESERVADO', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO'] as const).includes(v.status as StatusVendaCRM)
      ? v.status as StatusVendaCRM
      : 'CONFIRMADO';

  const valor_total_venda =
    (v.valor_final as number | undefined)
    ?? (v.valor_total_venda as number | undefined)
    ?? (v.valor_total as number | undefined)
    ?? 0;
  const valor_total_custo =
    (v.valor_total_custo as number | undefined)
    ?? (v.custo_total as number | undefined)
    ?? 0;
  // markup_realizado = receita real da agência (comissão efetiva).
  // Só aceita campos que representem comissão de verdade. NÃO faz fallback
  // para rentabilidade/(valor−custo) — isso é margem bruta, não receita.
  // Se CRM não enviar comissão, fica 0 (KPI "Margem Bruta" mostra o resto).
  const markup_realizado =
    (v.markup_realizado as number | undefined)
    ?? (v.comissao as number | undefined)
    ?? 0;

  const produtos = (v.produtos as VendaCRM['produtos']) ?? [];
  // Receita da agência EM R$, na ordem de confiabilidade:
  //  1) comissão por produto (comissao_fornecedor é % do valor de venda);
  //  2) comissão absoluta reportada pelo CRM (campo `comissao`);
  //  3) valor final - custo, quando há custo de fornecedor registrado.
  // Sem nenhuma das três a receita é 0 (KPI mostra "aguardando comissão").
  const comissaoProdutos = somaPor(produtos, p =>
    percentual(paraBRL(p.valor_venda, p.moeda, p.cambio), p.comissao_fornecedor));
  const comissaoCRM = num(v.comissao);
  const receita_agencia =
    comissaoProdutos > 0 ? comissaoProdutos
    : comissaoCRM > 0 ? round2(comissaoCRM)
    : num(valor_total_custo) > 0 ? Math.max(round2(num(valor_total_venda) - num(valor_total_custo)), 0)
    : 0;

  return {
    receita_agencia,
    id: (v.id as string) ?? '',
    numero: (v.numero as string) ?? (v.crm_venda_id as string) ?? String(v.id ?? '').slice(0, 8) ?? '—',
    data_venda: (v.data_venda as string) ?? '',
    tipo: (v.tipo as 'AVULSA' | 'GRUPO') ?? (v.grupo_id ? 'GRUPO' : 'AVULSA'),
    grupo_id: (v.grupo_id as string | null) ?? null,
    cliente_id: (v.cliente_id as string) ?? '',
    vendedor_id: (v.vendedor_id as string) ?? '',
    passageiros: (v.passageiros as VendaCRM['passageiros']) ?? [],
    pagantes: (v.pagantes as VendaCRM['pagantes']) ?? [],
    produtos,
    valor_total_custo,
    valor_total_venda,
    markup_realizado,
    desconto: (v.desconto as number) ?? 0,
    valor_final: valor_total_venda,
    forma_pagamento: (v.forma_pagamento as VendaCRM['forma_pagamento']) ?? 'AVISTA_PIX',
    parcelas: (v.parcelas as number) ?? 1,
    pagamento_detalhado: (v.pagamento_detalhado as VendaCRM['pagamento_detalhado']) ?? [],
    status,
    motivo_cancelamento: (v.motivo_cancelamento as string) ?? '',
    recibo_emitido: (v.recibo_emitido as boolean) ?? false,
    intermediario_id: (v.intermediario_id as string | null) ?? null,
    comissao_intermediario: (v.comissao_intermediario as number) ?? 0,
    centro_custo: (v.centro_custo as string) ?? '',
    numero_po: (v.numero_po as string) ?? '',
    anexos: (v.anexos as VendaCRM['anexos']) ?? [],
    observacoes: (v.observacoes as string) ?? '',
    campos_personalizados: (v.campos_personalizados as Record<string, string>) ?? {},
  };
}

// ============================================================
// TIPOS INTERNOS
// ============================================================

interface Alerta {
  id: string;
  tipo: string;
  prioridade: 'CRITICO' | 'ATENCAO' | 'POSITIVO' | 'INFO';
  titulo: string;
  descricao: string;
  link: string;
  linkLabel: string;
}

// O tipo KPI foi removido junto com os cartões de borda colorida: cada número
// do painel agora é montado no JSX com MetricCard, que exige contexto e cuida
// de formatação, estado de carregamento e delta.

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

// Casca de seção e de painel. Ficam FORA do componente de propósito: definidas
// dentro, o React as trataria como um tipo novo a cada render e remontaria a
// subárvore inteira, perdendo estado e piscando a tela.
function Secao({ id, titulo, acao, children }: {
  id: string;
  titulo: string;
  acao?: { rotulo: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
        <h2 id={id} className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        {acao ? (
          <Link
            href={acao.href}
            className="fin-t-body inline-flex min-h-11 items-center rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-10"
          >
            {acao.rotulo}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
      <div className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <h3 className="fin-t-body-strong text-[var(--fin-text)]">{titulo}</h3>
      </div>
      <div className="p-[var(--fin-s-4)]">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendas, setVendas] = useState<VendaDash[]>([]);
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [cacData, setCacData] = useState<CACMensal[]>([]);
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Devolve a promessa: o PageHeader do padrão financeiro espera uma função
  // assíncrona para saber quando o "Recarregar" terminou.
  const fetchAll = useCallback(() => {
    setLoading(true);
    return Promise.all([
      loadEntities<Cliente>('clientes'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<CACMensal>('cac-mensal'),
      loadEntities<MetaVendedor>('metas'),
      loadEquipe<Membro>(),
    ]).then(([cl, vn, cr, cp, cb, cac, mt, mb]) => {
      setClientes(cl);
      // Normaliza vendas vindas de fontes diferentes (UI antiga + handler do
      // VENDA_FECHADA do CRM). Garante produtos[]/valor_final/etc presentes.
      setVendas(vn.map(v => normalizeVenda(v as Partial<VendaCRM> & Record<string, unknown>)));
      setReceber(cr); setPagar(cp);
      setContas(cb); setCacData(cac); setMetas(mt); setMembros(mb);
      setLoading(false);
      setLastUpdate(new Date());
    });
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const mesAtual = thisMonth();
  const mesAnterior = prevMonth(mesAtual);

  // ============================================================
  // CALCULOS
  // ============================================================

  const calc = useMemo(() => {
    const vendasMes = vendas.filter(v => v.data_venda?.startsWith(mesAtual) && v.status !== 'CANCELADO');
    const vendasMesAnt = vendas.filter(v => v.data_venda?.startsWith(mesAnterior) && v.status !== 'CANCELADO');

    const faturamento = somaPor(vendasMes, v => v.valor_final);
    const faturamentoAnt = somaPor(vendasMesAnt, v => v.valor_final);

    const qtdVendas = vendasMes.length;
    const qtdVendasAnt = vendasMesAnt.length;

    const ticketMedio = round2(divSegura(faturamento, qtdVendas));
    const ticketMedioAnt = round2(divSegura(faturamentoAnt, qtdVendasAnt));

    // Receita da agência = comissão REAL em R$ por venda (receita_agencia,
    // derivada em normalizeVenda). NUNCA somar markup_realizado nem
    // comissao_fornecedor crus — os dois são PERCENTUAIS em parte da base.
    const calcReceita = (vs: VendaDash[]) => somaPor(vs, v => v.receita_agencia);
    const receita = calcReceita(vendasMes);
    const receitaAnt = calcReceita(vendasMesAnt);

    // Margem Bruta = Faturamento - CMV. Representa quanto sobrou após
    // pagar fornecedores, ANTES das despesas operacionais.
    const calcMargemBruta = (vs: VendaDash[]) =>
      somaPor(vs, v => Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0));
    const margemBruta = calcMargemBruta(vendasMes);
    const margemBrutaAnt = calcMargemBruta(vendasMesAnt);
    const margemBrutaPct = round2(divSegura(margemBruta, faturamento) * 100);
    const margemBrutaPctAnt = round2(divSegura(margemBrutaAnt, faturamentoAnt) * 100);

    // Lucro e Margem — mesma lógica do DRE (receita bruta - total despesas)
    const calcDRELucro = (mes: string) => {
      const mVendas = vendas.filter(v => v.data_venda?.startsWith(mes) && v.status !== 'CANCELADO');
      const mReceber = receber.filter(r => r.data_vencimento?.startsWith(mes) && (r.status === 'RECEBIDO' || r.status === 'PENDENTE'));
      // O custo do fornecedor já entra como CMV (valor_total_custo da venda).
      // A conta a pagar auto-gerada da MESMA venda é o mesmo custo — contar as
      // duas dobrava a despesa. Mesmo filtro usado na página de DRE.
      const mPagar = pagar.filter(p =>
        p.data_vencimento?.startsWith(mes)
        && (p.status === 'PAGO' || p.status === 'PENDENTE')
        && !(p.auto_gerado && p.origem === 'VENDA'));

      // RECEITA DA AGÊNCIA, não volume vendido.
      //
      // Aqui estava o erro mais caro do dashboard: recBrutaVendas somava
      // v.valor_final, ou seja, o pacote inteiro que o cliente contratou.
      // Numa agência isso é 7 a 12 vezes maior que a receita real, porque
      // hotel, aéreo e receptivo são repasse, não faturamento próprio. O
      // lucro fechava (o CMV era subtraído depois), mas a margem saía
      // dividida pelo volume, e os dois cartões desta tela levam para o DRE,
      // que mostra o número certo. Duas telas, dois números.
      //
      // Mesma fórmula da página de DRE: comissão da venda, clampada por
      // venda para que um prejuízo isolado não vire receita negativa.
      // Duas somas, de propósito, porque servem a perguntas diferentes.
      //
      // receitaBruta usa a margem CLAMPADA por venda: receita da empresa não
      // é negativa, e é a base do percentual de margem.
      //
      // lucroLiq usa a margem SEM clamp. Uma viagem vendida abaixo do custo é
      // prejuízo e precisa reduzir o resultado do mês. Clampar aqui apagaria
      // a perda e o cartão "Lucro do Mês" mostraria um número melhor do que a
      // realidade, justamente no mês em que o dono mais precisa enxergá-la.
      const margemPorVenda = mVendas.map(v => round2(num(v.valor_final) - num(v.valor_total_custo)));
      const recBrutaVendas = somaPor(margemPorVenda, m => Math.max(m, 0));
      const margemVendas = soma(margemPorVenda);

      const recComissoes = somaPor(mReceber.filter(cr => cr.origem === 'COMISSAO_FORNECEDOR'), cr => cr.valor_final);
      const recFee = somaPor(mReceber.filter(cr => cr.origem === 'FEE'), cr => cr.valor_final);
      const recOutras = somaPor(mReceber.filter(cr => cr.origem === 'OUTROS'), cr => cr.valor_final);

      const receitaBruta = soma([recBrutaVendas, recComissoes, recFee, recOutras]);
      const resultadoVendas = soma([margemVendas, recComissoes, recFee, recOutras]);

      // O custo do fornecedor já está dentro da margem (venda menos custo).
      // Somá-lo de novo aqui cobraria o mesmo custo duas vezes — por isso o
      // filtro acima já exclui a conta a pagar auto-gerada da própria venda.
      const totalDespesas = somaPor(mPagar, p => p.valor_final);

      const lucroLiq = round2(resultadoVendas - totalDespesas);
      const margemLiq = round2(divSegura(lucroLiq, receitaBruta) * 100);
      return { receitaBruta, lucroLiq, margemLiq };
    };

    const dreMes = calcDRELucro(mesAtual);
    const dreMesAnt = calcDRELucro(mesAnterior);

    const lucro = dreMes.lucroLiq;
    const lucroAnt = dreMesAnt.lucroLiq;
    const margem = dreMes.margemLiq;
    const margemAnt = dreMesAnt.margemLiq;

    // CAC
    const cacMes = cacData.find(c => c.mes === mesAtual);
    const cacMesAnt = cacData.find(c => c.mes === mesAnterior);
    const cacValor = cacMes?.cac || 0;
    const cacValorAnt = cacMesAnt?.cac || 0;

    // Saldo em caixa
    // Saldo computado: saldo_inicial + recebido - pago. Não depende de
    // saldo_atual persistido nas contas (pode ficar stale).
    const saldoCaixa = calcularSaldoBancario(contas, receber, pagar);

    // Deltas.
    //
    // variacaoPct devolve null de propósito quando o mês anterior é zero:
    // não existe variação percentual sobre base zero. O fallback antigo
    // ("100" quando havia valor, "0" quando não) fabricava um número —
    // "+100%" num mês que simplesmente não tinha com o que comparar, e
    // "0%" lido na tela como "estável". Agora o delta some do cartão.
    const delta = (atual: number, anterior: number): number | null =>
      variacaoPct(atual, anterior);

    return {
      faturamento, faturamentoAnt, qtdVendas, qtdVendasAnt,
      ticketMedio, ticketMedioAnt, receita, receitaAnt,
      margem, margemAnt, cacValor, cacValorAnt,
      saldoCaixa, lucro, lucroAnt,
      margemBruta, margemBrutaAnt, margemBrutaPct, margemBrutaPctAnt,
      receitaBrutaDRE: dreMes.receitaBruta,
      delta,
      vendasMes,
    };
  }, [vendas, receber, pagar, contas, cacData, mesAtual, mesAnterior]);

  // KPIs
  // O array de KPIs antigo saiu junto com os cartões de borda colorida: o
  // painel agora monta cada número no próprio JSX, com o contexto que o
  // MetricCard exige. Ver a seção RENDER.

  // ============================================================
  // ALERTAS
  // ============================================================

  const alertas: Alerta[] = useMemo(() => {
    const list: Alerta[] = [];
    const hj = today();

    // Parcelas vencidas (a receber)
    const parcelasAtrasadas = receber.filter(r => r.status === 'ATRASADO' || (r.status === 'PENDENTE' && r.data_vencimento < hj));
    if (parcelasAtrasadas.length > 0) {
      const total = somaPor(parcelasAtrasadas, r => r.valor_final);
      list.push({
        id: 'parcelas_vencidas', tipo: 'PARCELA_VENCIDA', prioridade: 'CRITICO',
        titulo: `${parcelasAtrasadas.length} parcela(s) vencida(s) — ${BRL(total)} a receber`,
        descricao: [...new Set(parcelasAtrasadas.map(r => r.cliente_nome).filter(Boolean))].slice(0, 3).join(', '),
        link: '/financeiro-ag/receber', linkLabel: 'Cobrar',
      });
    }

    // Pagamentos vencidos (a pagar)
    const pagamentosVencidos = pagar.filter(p => p.status === 'VENCIDO' || (p.status === 'PENDENTE' && p.data_vencimento < hj));
    if (pagamentosVencidos.length > 0) {
      const total = somaPor(pagamentosVencidos, p => p.valor_final);
      list.push({
        id: 'pagamentos_vencidos', tipo: 'PAGAMENTO_VENCIDO', prioridade: 'CRITICO',
        titulo: `${pagamentosVencidos.length} pagamento(s) vencido(s) — ${BRL(total)}`,
        descricao: [...new Set(pagamentosVencidos.map(p => p.fornecedor_nome).filter(Boolean))].slice(0, 3).join(', '),
        link: '/financeiro-ag/pagar', linkLabel: 'Pagar',
      });
    }

    // Pagamentos proximos (5 dias)
    const pagProximos = pagar.filter(p => p.status === 'PENDENTE' && daysUntil(p.data_vencimento) >= 0 && daysUntil(p.data_vencimento) <= 5);
    if (pagProximos.length > 0) {
      const total = somaPor(pagProximos, p => p.valor_final);
      list.push({
        id: 'pag_proximos', tipo: 'PAGAMENTO_PROXIMO', prioridade: 'ATENCAO',
        titulo: `${pagProximos.length} pagamento(s) nos proximos 5 dias — ${BRL(total)}`,
        descricao: pagProximos.slice(0, 2).map(p => `${p.fornecedor_nome} (${fmtDate(p.data_vencimento)})`).join(', '),
        link: '/financeiro-ag/pagar', linkLabel: 'Ver',
      });
    }

    // CAC subiu
    if (calc.cacValor > 0 && calc.cacValorAnt > 0 && calc.cacValor > calc.cacValorAnt * 1.05) {
      const pctSubiu = (variacaoPct(calc.cacValor, calc.cacValorAnt) ?? 0).toFixed(0);
      list.push({
        id: 'cac_subiu', tipo: 'CAC_SUBIU', prioridade: 'ATENCAO',
        titulo: `CAC subiu ${pctSubiu}% vs mes anterior`,
        descricao: `De ${BRL(calc.cacValorAnt)} para ${BRL(calc.cacValor)}`,
        link: '/cac/dashboard', linkLabel: 'CAC',
      });
    }

    // Orcamentos sem resposta > 7 dias
    const orcamentosPendentes = vendas.filter(v => v.status === 'ORCAMENTO' && v.data_venda && daysUntil(v.data_venda) < -7);
    if (orcamentosPendentes.length > 0) {
      list.push({
        id: 'orcamentos_antigos', tipo: 'ORCAMENTO_SEM_RESPOSTA', prioridade: 'ATENCAO',
        titulo: `${orcamentosPendentes.length} orcamento(s) aguardando resposta ha +7 dias`,
        descricao: 'Possivel follow-up necessario',
        link: '/vendas/orcamentos', linkLabel: 'Orcamentos',
      });
    }

    // Meta atingida
    const metasMes = metas.filter(m => m.mes_referencia === mesAtual);
    metasMes.forEach(m => {
      if (m.meta_valor > 0 && m.realizado_valor >= m.meta_valor) {
        list.push({
          id: `meta_${m.id}`, tipo: 'META_ATINGIDA', prioridade: 'POSITIVO',
          titulo: `Meta de vendas atingida! ${m.vendedor_nome}`,
          descricao: `${BRL(m.realizado_valor)} / ${BRL(m.meta_valor)}`,
          link: '/equipe/metas', linkLabel: 'Metas',
        });
      }
    });

    // Parcelas vencendo hoje
    const parcelasHoje = receber.filter(r => r.status === 'PENDENTE' && r.data_vencimento === hj);
    if (parcelasHoje.length > 0) {
      const total = somaPor(parcelasHoje, r => r.valor_final);
      list.push({
        id: 'parcelas_hoje', tipo: 'PARCELA_HOJE', prioridade: 'INFO',
        titulo: `${parcelasHoje.length} parcela(s) vencem hoje — ${BRL(total)}`,
        descricao: parcelasHoje.slice(0, 2).map(r => r.cliente_nome).join(', '),
        link: '/financeiro-ag/receber', linkLabel: 'Ver',
      });
    }

    // Sort: CRITICO > ATENCAO > POSITIVO > INFO
    const prioOrder = { CRITICO: 0, ATENCAO: 1, POSITIVO: 2, INFO: 3 };
    list.sort((a, b) => prioOrder[a.prioridade] - prioOrder[b.prioridade]);
    return list;
  }, [receber, pagar, vendas, metas, calc, mesAtual]);

  // ============================================================
  // GRAFICOS (dados)
  // ============================================================

  const chartFaturamento = useMemo(() => {
    const months: { mes: string; label: string; faturamento: number; receita: number }[] = [];
    let m = mesAtual;
    for (let i = 0; i < 6; i++) {
      const vs = vendas.filter(v => v.data_venda?.startsWith(m) && v.status !== 'CANCELADO');
      const fat = somaPor(vs, v => v.valor_final);
      // Mesma regra do KPI: receita da agência em R$, nunca percentual cru.
      const rec = somaPor(vs, v => v.receita_agencia);
      months.unshift({ mes: m, label: getMesLabel(m), faturamento: fat, receita: rec });
      m = prevMonth(m);
    }
    return months;
  }, [vendas, mesAtual]);

  const chartFluxo = useMemo(() => {
    const months: { mes: string; label: string; entradas: number; saidas: number; saldo: number }[] = [];
    let m = mesAtual;
    let saldoAcum = 0;
    const raw: { mes: string; entradas: number; saidas: number }[] = [];
    for (let i = 0; i < 6; i++) {
      // Dois erros na mesma linha antes: PARCIAL ficava de fora (dinheiro
      // real que entrou some do gráfico) e o valor somado era o previsto,
      // não o baixado (uma conta quitada com desconto aparecia pelo cheio).
      // valorMovimentado resolve os dois: é a mesma regra do saldo.
      const ent = somaPor(
        receber.filter(r => (r.data_recebimento || r.data_vencimento)?.startsWith(m)),
        r => valorMovimentado(r, 'valor_recebido'));
      const sai = somaPor(
        pagar.filter(p => (p.data_pagamento || p.data_vencimento)?.startsWith(m)),
        p => valorMovimentado(p, 'valor_pago'));
      raw.unshift({ mes: m, entradas: ent, saidas: sai });
      m = prevMonth(m);
    }
    raw.forEach(r => {
      saldoAcum = round2(saldoAcum + round2(r.entradas - r.saidas));
      months.push({ mes: r.mes, label: getMesLabel(r.mes), entradas: r.entradas, saidas: r.saidas, saldo: saldoAcum });
    });
    return months;
  }, [receber, pagar, mesAtual]);

  const chartComposicao = useMemo(() => {
    const map: Record<string, number> = {};
    calc.vendasMes.forEach(v => {
      v.produtos.forEach(p => {
        const tipo = p.tipo || 'OUTROS';
        map[tipo] = round2((map[tipo] || 0) + paraBRL(p.valor_venda, p.moeda, p.cambio));
      });
    });
    const cores: Record<string, string> = {
      AEREO: '#60a5fa', HOTEL: '#a78bfa', PACOTE: '#34d399', SEGURO: '#fbbf24',
      RECEPTIVO: '#22d3ee', CRUZEIRO: '#818cf8', CARRO: '#fb923c', INGRESSO: '#f472b6',
      GRUPO: '#2dd4bf', OUTROS: '#94a3b8',
    };
    const total = soma(Object.values(map));
    return Object.entries(map).map(([tipo, valor]) => ({
      tipo, valor, pct: round2(divSegura(valor, total) * 100),
      cor: cores[tipo] || '#94a3b8',
    })).sort((a, b) => b.valor - a.valor);
  }, [calc.vendasMes]);

  // ============================================================
  // ANIVERSARIANTES E DATAS
  // ============================================================

  const aniversariantes = useMemo(() => {
    const hj = today();
    const [, mm, dd] = hj.split('-');
    const hjMMDD = `${mm}-${dd}`;

    return clientes
      .filter(c => c.status === 'ATIVO' && c.data_nascimento)
      .map(c => {
        const dn = c.data_nascimento;
        const [ay] = dn.split('-');
        const dnMMDD = dn.slice(5);
        const anoAtual = parseInt(hj.slice(0, 4));
        const idade = anoAtual - parseInt(ay);
        const diasAte = (() => {
          const diff = daysUntil(`${anoAtual}-${dnMMDD}`);
          return diff < 0 ? diff + 365 : diff;
        })();
        return {
          nome: nomeDoCliente(c),
          data: dn, idade, diasAte,
          whatsapp: c.whatsapp || c.telefone_principal,
          email: c.email,
          isHoje: dnMMDD === hjMMDD,
          isSemana: diasAte > 0 && diasAte <= 7,
        };
      })
      .filter(a => a.diasAte <= 30)
      .sort((a, b) => a.diasAte - b.diasAte);
  }, [clientes]);

  const datasImportantes = useMemo(() => {
    const eventos: { data: string; titulo: string; descricao: string; link: string }[] = [];
    const hj = today();

    // Vencimentos a receber proximos 7 dias
    receber.filter(r => r.status === 'PENDENTE' && daysUntil(r.data_vencimento) >= 0 && daysUntil(r.data_vencimento) <= 7)
      .forEach(r => eventos.push({
        data: r.data_vencimento,
        titulo: `Vencimento parcela ${r.parcela_numero}/${r.total_parcelas}`,
        descricao: `${r.cliente_nome} — ${BRL(r.valor_final)}`,
        link: '/financeiro-ag/receber',
      }));

    // Vencimentos a pagar proximos 7 dias
    pagar.filter(p => p.status === 'PENDENTE' && daysUntil(p.data_vencimento) >= 0 && daysUntil(p.data_vencimento) <= 7)
      .forEach(p => eventos.push({
        data: p.data_vencimento,
        titulo: `Pagamento ${p.fornecedor_nome}`,
        descricao: BRL(p.valor_final),
        link: '/financeiro-ag/pagar',
      }));

    return eventos.sort((a, b) => a.data.localeCompare(b.data)).slice(0, 8);
  }, [receber, pagar]);

  // ============================================================
  // RESUMO TEXTUAL
  // ============================================================

  const resumo = useMemo(() => {
    const parts: string[] = [];
    if (calc.qtdVendas > 0) {
      parts.push(`Foram fechadas ${calc.qtdVendas} vendas totalizando ${BRL(calc.faturamento)} em faturamento.`);
    } else {
      parts.push('Nenhuma venda registrada no mes.');
    }
    if (calc.receita > 0) {
      const pctReceita = (divSegura(calc.receita, calc.faturamento) * 100).toFixed(0);
      parts.push(`A receita da agencia (comissoes + markup) foi de ${BRL(calc.receita)} (${pctReceita}%).`);
    }
    if (calc.cacValor > 0) {
      parts.push(`O CAC ficou em ${BRL(calc.cacValor)} por cliente.`);
    }
    parts.push(`O lucro líquido ${calc.lucro >= 0 ? 'fechou positivo' : 'ficou negativo'} em ${BRL(calc.lucro)}.`);
    if (contas.length > 0) {
      parts.push(`Saldo total em caixa: ${BRL(calc.saldoCaixa)} (${contas.length} conta${contas.length > 1 ? 's' : ''}).`);
    }
    return parts;
  }, [calc, contas]);

  // ============================================================
  // RENDER — padrão do módulo financeiro (/financeiro-ag)
  // ============================================================
  // Mesma gramática visual da tela de Financeiro: cabeçalho canônico, uma
  // faixa com o número principal e três de apoio, seções com subtítulo, e
  // as ações no rodapé. Nada de cartão com borda colorida no topo, ícone
  // colorido por métrica ou caixa em gradiente: cor aqui só entra quando o
  // sinal muda a decisão.

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : 'ok';
  const estadoValor: MoneyEstado = loading ? 'carregando' : 'ok';

  const maxFat = Math.max(...chartFaturamento.map(m => m.faturamento), 1);
  const maxFluxo = Math.max(...chartFluxo.map(m => Math.max(m.entradas, m.saidas)), 1);

  // Delta só aparece quando existe base de comparação. variacaoPct devolve
  // null no mês anterior zerado, e nesse caso o indicador some da tela em vez
  // de estampar um "+100%" que não significa nada.
  const deltaDe = (
    atual: number,
    anterior: number,
    polaridade: 'subirBom' | 'subirRuim' = 'subirBom',
  ): DeltaIndicatorProps | null => {
    const pct = calc.delta(atual, anterior);
    if (pct === null || Math.abs(pct) < 0.05) return null;
    return { pct, direcao: pct > 0 ? 'up' : 'down', polaridade, base: 'vs. mês anterior' };
  };

  const tomDoValor = (v: number): 'neutro' | 'negativo' => (v < 0 ? 'negativo' : 'neutro');

  // Faixa da margem: o mesmo semáforo que o resto do sistema usa.
  const faixaMargem: 'saudavel' | 'atencao' | 'critico' =
    calc.margemBrutaPct >= 15 ? 'saudavel' : calc.margemBrutaPct >= 10 ? 'atencao' : 'critico';

  const despesasDoMes = round2(calc.receitaBrutaDRE - calc.lucro);

  const prioTom: Record<string, string> = {
    CRITICO: 'var(--fin-negative)',
    ATENCAO: 'var(--fin-warning)',
    POSITIVO: 'var(--fin-positive)',
    INFO: 'var(--fin-accent)',
  };
  const prioIcone: Record<string, React.ReactNode> = {
    CRITICO: <AlertCircle className="h-4 w-4 shrink-0 text-[var(--fin-negative-text)]" />,
    ATENCAO: <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" />,
    POSITIVO: <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--fin-positive)]" />,
    INFO: <Info className="h-4 w-4 shrink-0 text-[var(--fin-accent)]" />,
  };

  const pendencias = [
    { rotulo: 'Orçamentos aguardando', qtd: vendas.filter(v => v.status === 'ORCAMENTO').length, href: '/vendas/orcamentos' },
    { rotulo: 'Contas a receber em aberto', qtd: receber.filter(r => r.status === 'PENDENTE' || r.status === 'ATRASADO').length, href: '/financeiro-ag/receber' },
    { rotulo: 'Contas a pagar em aberto', qtd: pagar.filter(p => p.status === 'PENDENTE' || p.status === 'VENCIDO').length, href: '/financeiro-ag/pagar' },
  ];

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col">
        <PageHeader
          titulo="Painel"
          subtitulo={`${getMonthName(mesAtual)}. ${calc.qtdVendas} ${calc.qtdVendas === 1 ? 'venda fechada' : 'vendas fechadas'} até agora.`}
          atualizadoEm={lastUpdate}
          onRecarregar={fetchAll}
        />

        <div className="mt-[var(--fin-s-6)] flex flex-col gap-[var(--fin-s-5)]">
          {/* ---------------------------------------------------------------
              FAIXA PRINCIPAL
              O número grande é o VOLUME vendido, e o rótulo diz isso. Em
              agência de viagens o que o cliente paga não é receita: a maior
              parte pertence ao fornecedor. Os três cartões de apoio trazem o
              que de fato sobra, o ticket e o caixa.
          ---------------------------------------------------------------- */}
          <DataState
            estado={estado}
            erro={null}
            esqueleto={
              <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
                <div className="flex flex-col gap-[var(--fin-s-4)] lg:flex-row lg:items-center">
                  <div className="flex flex-col gap-[var(--fin-s-2)] lg:w-[300px] lg:shrink-0 lg:pr-[var(--fin-s-5)]">
                    <span className="block h-3 w-24 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                    <span className="block h-8 w-52 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                    <span className="block h-3 w-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                  </div>
                  <div className="grid gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:grid-cols-3 lg:grow lg:border-t-0 lg:border-l lg:pt-0 lg:pl-[var(--fin-s-5)]">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] p-[var(--fin-s-4)]">
                        <span className="block h-3 w-20 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                        <span className="block h-5 w-32 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                        <span className="block h-3 w-28 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            }
          >
            <section
              aria-labelledby="dash-faturamento"
              className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]"
            >
              <div className="flex flex-col gap-[var(--fin-s-4)] lg:flex-row lg:items-center">
                <div className="flex flex-col gap-[var(--fin-s-1)] lg:w-[300px] lg:shrink-0 lg:pr-[var(--fin-s-5)]">
                  <h2 id="dash-faturamento" className="fin-t-overline text-[var(--fin-text-3)]">
                    Faturamento do mês
                  </h2>
                  <Money valor={calc.faturamento} estado={estadoValor} size="metric" align="esquerda" />
                  {(() => {
                    const d = deltaDe(calc.faturamento, calc.faturamentoAnt);
                    return d ? <DeltaIndicator {...d} /> : null;
                  })()}
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    Volume vendido no mês. Boa parte pertence aos fornecedores, então não é a receita da agência.
                  </p>
                </div>

                <div className="grid gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:grid-cols-3 lg:grow lg:border-t-0 lg:border-l lg:pt-0 lg:pl-[var(--fin-s-5)]">
                  <MetricCard
                    rotulo="Receita da agência"
                    valor={calc.receita}
                    estado={estadoValor}
                    contexto="O que sobra depois de repassar os fornecedores."
                    explicacao="Comissão e markup que ficam com a agência. É este número, e não o faturamento, que paga as contas da empresa."
                    tone={tomDoValor(calc.receita)}
                    delta={deltaDe(calc.receita, calc.receitaAnt)}
                  />
                  <MetricCard
                    rotulo="Ticket médio"
                    valor={calc.ticketMedio}
                    estado={estadoValor}
                    contexto={`Média das ${calc.qtdVendas} ${calc.qtdVendas === 1 ? 'venda fechada' : 'vendas fechadas'} no mês.`}
                    explicacao="Faturamento do mês dividido pelo número de vendas fechadas."
                    delta={deltaDe(calc.ticketMedio, calc.ticketMedioAnt)}
                  />
                  <MetricCard
                    rotulo="Em caixa hoje"
                    valor={calc.saldoCaixa}
                    estado={estadoValor}
                    contexto={contas.length > 0 ? `Somatório de ${contas.length} ${contas.length === 1 ? 'conta bancária' : 'contas bancárias'}.` : 'Nenhuma conta bancária cadastrada ainda.'}
                    explicacao="Saldo reconstruído a partir das baixas confirmadas. Não é lucro: parte já tem dono, como fornecedores e comissões a pagar."
                    tone={tomDoValor(calc.saldoCaixa)}
                  />
                </div>
              </div>
            </section>
          </DataState>

          {/* ---------------------------------------------------------------
              RESULTADO
              Antes esta área repetia o mesmo valor em três cartões: margem
              bruta, receita da agência e lucro do mês davam o mesmo número
              sempre que não havia comissão de fornecedor nem despesa. Agora
              a receita aparece uma vez, o lucro traz no contexto a despesa
              que o separa dela, e o percentual vira medidor em vez de um
              quarto cartão de dinheiro.
          ---------------------------------------------------------------- */}
          <Secao id="dash-resultado" titulo="Resultado do mês" acao={{ rotulo: 'Abrir o resultado completo', href: '/financeiro-ag/dre' }}>
            <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                rotulo="Lucro do mês"
                valor={calc.lucro}
                estado={estadoValor}
                contexto={
                  despesasDoMes > 0
                    ? `Receita da agência menos ${BRL(despesasDoMes)} de despesas lançadas.`
                    : 'Nenhuma despesa lançada neste mês, então o lucro é igual à receita.'
                }
                explicacao="Receita da agência no mês menos as despesas operacionais lançadas com vencimento no mês. Não inclui o custo dos fornecedores, que já foi descontado na receita."
                tone={tomDoValor(calc.lucro)}
                delta={deltaDe(calc.lucro, calc.lucroAnt)}
              />

              <div className="flex flex-col justify-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
                <span className="fin-t-overline text-[var(--fin-text-3)]">Margem sobre o faturamento</span>
                <Meter
                  pct={Math.max(0, Math.min(100, calc.margemBrutaPct))}
                  faixa={faixaMargem}
                  descricao={`${BRL(calc.margemBruta)} de margem sobre ${BRL(calc.faturamento)} vendidos.`}
                />
              </div>

              {calc.cacValor > 0 ? (
                <MetricCard
                  rotulo="Custo por cliente novo"
                  valor={calc.cacValor}
                  estado={estadoValor}
                  contexto="Investimento comercial dividido pelos clientes conquistados."
                  explicacao="Quanto custou trazer cada cliente novo no mês. Comparar com o ticket médio mostra se a aquisição se paga."
                  delta={deltaDe(calc.cacValor, calc.cacValorAnt, 'subirRuim')}
                />
              ) : (
                <div className="flex flex-col justify-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-dashed border-[var(--fin-border)] p-[var(--fin-s-4)]">
                  <span className="fin-t-overline text-[var(--fin-text-3)]">Custo por cliente novo</span>
                  <p className="fin-t-body text-[var(--fin-text-2)]">
                    Sem investimento comercial registrado neste mês.
                  </p>
                  <Link
                    href="/cac/dashboard"
                    className="fin-t-caption text-[var(--fin-accent)] underline underline-offset-4"
                  >
                    Registrar investimento
                  </Link>
                </div>
              )}
            </div>
          </Secao>

          {/* ---------------------------------------------------------------
              ATENÇÃO
          ---------------------------------------------------------------- */}
          <Secao id="dash-alertas" titulo={alertas.length > 0 ? `Precisa de atenção (${alertas.length})` : 'Precisa de atenção'}>
            <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
              {alertas.length === 0 ? (
                <div className="flex flex-col items-center gap-[var(--fin-s-2)] px-[var(--fin-s-4)] py-[var(--fin-s-6)] text-center">
                  <CheckCircle2 className="h-6 w-6 text-[var(--fin-positive)]" />
                  <p className="fin-t-body text-[var(--fin-text-2)]">
                    Nada exigindo ação agora. Contas vencendo e margens fora do esperado aparecem aqui.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--fin-border)]">
                  {alertas.slice(0, 7).map(a => (
                    <li
                      key={a.id}
                      className="flex items-start gap-[var(--fin-s-3)] border-l-2 px-[var(--fin-s-4)] py-[var(--fin-s-3)]"
                      style={{ borderLeftColor: prioTom[a.prioridade] }}
                    >
                      {prioIcone[a.prioridade]}
                      <div className="flex min-w-0 flex-1 flex-col gap-[var(--fin-s-1)]">
                        <span className="fin-t-body-strong text-[var(--fin-text)]">{a.titulo}</span>
                        {a.descricao ? (
                          <span className="fin-t-caption text-[var(--fin-text-2)]">{a.descricao}</span>
                        ) : null}
                      </div>
                      <Link
                        href={a.link}
                        className="fin-t-caption inline-flex min-h-11 shrink-0 items-center gap-1 text-[var(--fin-accent)] underline underline-offset-4 lg:min-h-10"
                      >
                        {a.linkLabel} <ChevronRight className="h-3 w-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Secao>

          {/* ---------------------------------------------------------------
              HISTÓRICO
          ---------------------------------------------------------------- */}
          <Secao id="dash-historico" titulo="Como o mês se formou">
            <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-3">
              <Painel titulo="Faturamento dos últimos 6 meses">
                <div className="flex h-[160px] items-end justify-between gap-[var(--fin-s-2)]">
                  {chartFaturamento.map((m, idx) => {
                    const h = Math.max((m.faturamento / maxFat) * 132, 3);
                    const atual = idx === chartFaturamento.length - 1;
                    return (
                      <div key={m.mes} className="flex flex-1 flex-col items-center gap-[var(--fin-s-1)]" title={`${m.label}: ${BRL(m.faturamento)}`}>
                        <div className="flex h-[132px] w-full items-end justify-center">
                          <div
                            className="w-full max-w-[28px] rounded-[var(--fin-r-sm)]"
                            style={{
                              height: h,
                              background: atual ? 'var(--fin-accent)' : 'var(--fin-surface-sunken)',
                            }}
                          />
                        </div>
                        <span className={`fin-t-caption ${atual ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]'}`}>
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Painel>

              <Painel titulo="Entradas e saídas de caixa">
                <div className="flex h-[132px] items-end justify-between gap-[var(--fin-s-1)]">
                  {chartFluxo.map(m => (
                    <div key={m.mes} className="flex flex-1 flex-col items-center gap-[var(--fin-s-1)]">
                      <div className="flex h-[110px] items-end gap-[2px]">
                        <div
                          className="w-3 rounded-[var(--fin-r-sm)] bg-[var(--fin-positive)]"
                          style={{ height: Math.max((m.entradas / maxFluxo) * 106, 2) }}
                          title={`Entradas: ${BRL(m.entradas)}`}
                        />
                        <div
                          className="w-3 rounded-[var(--fin-r-sm)] bg-[var(--fin-negative)]"
                          style={{ height: Math.max((m.saidas / maxFluxo) * 106, 2) }}
                          title={`Saídas: ${BRL(m.saidas)}`}
                        />
                      </div>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-[var(--fin-s-3)] flex items-center justify-center gap-[var(--fin-s-4)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
                  <span className="fin-t-caption flex items-center gap-1.5 text-[var(--fin-text-3)]">
                    <span className="h-2 w-2 rounded-[2px] bg-[var(--fin-positive)]" /> Entradas
                  </span>
                  <span className="fin-t-caption flex items-center gap-1.5 text-[var(--fin-text-3)]">
                    <span className="h-2 w-2 rounded-[2px] bg-[var(--fin-negative)]" /> Saídas
                  </span>
                </div>
              </Painel>

              <Painel titulo="Composição das vendas">
                {chartComposicao.length === 0 ? (
                  <p className="fin-t-body py-[var(--fin-s-5)] text-center text-[var(--fin-text-3)]">
                    Nenhuma venda com produto detalhado neste mês.
                  </p>
                ) : (
                  <div className="flex flex-col gap-[var(--fin-s-2)]">
                    {chartComposicao.slice(0, 6).map(c => (
                      <div key={c.tipo} className="flex items-center gap-[var(--fin-s-2)]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />
                        <span className="fin-t-caption flex-1 text-[var(--fin-text-2)]">{c.tipo}</span>
                        <Money valor={c.valor} estado={estadoValor} size="caption" />
                        <span className="fin-t-caption w-10 text-right text-[var(--fin-text-3)]">
                          {c.pct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                    <div className="mt-[var(--fin-s-2)] flex h-2.5 overflow-hidden rounded-full">
                      {chartComposicao.map(c => (
                        <div key={c.tipo} style={{ width: `${c.pct}%`, backgroundColor: c.cor }} />
                      ))}
                    </div>
                  </div>
                )}
              </Painel>
            </div>
          </Secao>

          {/* ---------------------------------------------------------------
              LEITURA DO MÊS
          ---------------------------------------------------------------- */}
          {resumo.length > 0 ? (
            <Secao id="dash-resumo" titulo={`Leitura de ${getMonthName(mesAtual)}`}>
              <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
                <div className="flex max-w-[68ch] flex-col gap-[var(--fin-s-2)]">
                  {resumo.map((p, i) => (
                    <p key={i} className="fin-t-body text-[var(--fin-text-2)]">{p}</p>
                  ))}
                </div>
              </div>
            </Secao>
          ) : null}

          {/* ---------------------------------------------------------------
              AGENDA
          ---------------------------------------------------------------- */}
          <Secao id="dash-agenda" titulo="Próximos dias">
            <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-2">
              <Painel titulo="Vencimentos dos próximos 7 dias">
                {datasImportantes.length === 0 ? (
                  <p className="fin-t-body py-[var(--fin-s-5)] text-center text-[var(--fin-text-3)]">
                    Nenhuma conta vencendo nos próximos 7 dias.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {datasImportantes.map((e, i) => (
                      <li key={`${e.data}-${i}`} className="flex items-center gap-[var(--fin-s-3)] py-[var(--fin-s-2)] first:pt-0 last:pb-0">
                        <span className="fin-t-caption w-[68px] shrink-0 text-[var(--fin-text-3)] tabular-nums">
                          {fmtDate(e.data)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{e.titulo}</span>
                          <span className="fin-t-caption truncate text-[var(--fin-text-2)]">{e.descricao}</span>
                        </span>
                        <Link
                          href={e.link}
                          className="fin-t-caption inline-flex min-h-11 shrink-0 items-center text-[var(--fin-accent)] underline underline-offset-4 lg:min-h-10"
                        >
                          Abrir
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Painel>

              <Painel titulo="Aniversários de clientes">
                {aniversariantes.length === 0 ? (
                  <p className="fin-t-body py-[var(--fin-s-5)] text-center text-[var(--fin-text-3)]">
                    Nenhum aniversário nos próximos 30 dias.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {aniversariantes.slice(0, 8).map((a, i) => (
                      <li key={`${a.nome}-${i}`} className="flex items-center gap-[var(--fin-s-3)] py-[var(--fin-s-2)] first:pt-0 last:pb-0">
                        <Cake className={`h-4 w-4 shrink-0 ${a.isHoje ? 'text-[var(--fin-accent)]' : 'text-[var(--fin-text-3)]'}`} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{a.nome}</span>
                          <span className="fin-t-caption text-[var(--fin-text-2)]">
                            {a.isHoje ? 'Hoje' : a.diasAte === 1 ? 'Amanhã' : `Em ${a.diasAte} dias`}
                            {a.idade ? ` · faz ${a.idade} anos` : ''}
                          </span>
                        </span>
                        {a.whatsapp ? (
                          <a
                            href={`https://wa.me/${a.whatsapp.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="fin-t-caption inline-flex min-h-11 shrink-0 items-center gap-1 text-[var(--fin-accent)] underline underline-offset-4 lg:min-h-10"
                          >
                            <MessageCircle className="h-3 w-3" /> Parabenizar
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Painel>
            </div>
          </Secao>

          {/* ---------------------------------------------------------------
              AÇÕES
          ---------------------------------------------------------------- */}
          <Secao id="dash-acoes" titulo="O que fazer agora">
            <div className="flex flex-col gap-[var(--fin-s-4)]">
              <div className="grid gap-[var(--fin-s-4)] sm:grid-cols-2 lg:grid-cols-3">
                <ActionCard
                  rotulo="Nova venda"
                  descricao="Registrar uma venda fechada e gerar as parcelas"
                  icone={ShoppingCart}
                  variante="primaria"
                  href="/vendas/nova"
                />
                <ActionCard
                  rotulo="Novo orçamento"
                  descricao="Montar uma proposta para o cliente avaliar"
                  icone={FileText}
                  href="/vendas/orcamentos"
                />
                <ActionCard
                  rotulo="Novo cliente"
                  descricao="Cadastrar quem vai viajar ou contratar"
                  icone={Users}
                  href="/pessoas/clientes"
                />
                <ActionCard
                  rotulo="Novo produto"
                  descricao="Montar um roteiro para vender"
                  icone={Package}
                  href="/grupos"
                />
                <ActionCard
                  rotulo="Registrar recebimento"
                  descricao="Dar baixa no que o cliente pagou"
                  icone={Receipt}
                  href="/financeiro-ag/receber"
                />
                <ActionCard
                  rotulo="Registrar pagamento"
                  descricao="Dar baixa no que foi pago ao fornecedor"
                  icone={CreditCard}
                  href="/financeiro-ag/pagar"
                />
              </div>

              <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-3">
                {pendencias.map(p => (
                  <Link
                    key={p.href}
                    href={p.href}
                    className="flex items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                  >
                    <span className="fin-t-body text-[var(--fin-text-2)]">{p.rotulo}</span>
                    <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{p.qtd}</span>
                  </Link>
                ))}
              </div>
            </div>
          </Secao>
        </div>
      </div>
    </div>
  );
}
