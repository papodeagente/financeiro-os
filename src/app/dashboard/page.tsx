'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { loadEntities } from '@/lib/crm-storage';
import type {
  Cliente, VendaCRM, ContaReceber, ContaPagar,
  ContaBancaria, CACMensal, MetaVendedor, Membro,
} from '@/lib/crm-types';
import {
  TrendingUp, TrendingDown, ShoppingCart, Users, DollarSign,
  Target, Wallet, BarChart3, AlertTriangle, ChevronRight,
  RefreshCw, Plus, FileText, Package, Receipt, CreditCard,
  Cake, Calendar, MessageCircle, Mail, ArrowUpRight,
  ArrowDownRight, Minus, Trophy, Gauge, Clock,
  PieChart as PieChartIcon, AlertCircle, CheckCircle2,
  Info, Zap, ExternalLink,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const fmtDate = (s: string) => {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

const today = () => new Date().toISOString().split('T')[0];
const thisMonth = () => today().slice(0, 7);

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getMonthName(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const meses = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${meses[parseInt(m) - 1]} ${y}`;
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

interface KPI {
  label: string;
  valor: string;
  valorNum: number;
  delta: number | null;
  deltaLabel: string;
  meta: number | null;
  metaLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  invertDelta?: boolean; // true = menor e melhor (CAC)
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export default function DashboardPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [cacData, setCacData] = useState<CACMensal[]>([]);
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      loadEntities<Cliente>('clientes'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<CACMensal>('cac-mensal'),
      loadEntities<MetaVendedor>('metas'),
      loadEntities<Membro>('membros'),
    ]).then(([cl, vn, cr, cp, cb, cac, mt, mb]) => {
      setClientes(cl); setVendas(vn); setReceber(cr); setPagar(cp);
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

    const faturamento = vendasMes.reduce((s, v) => s + (v.valor_final || 0), 0);
    const faturamentoAnt = vendasMesAnt.reduce((s, v) => s + (v.valor_final || 0), 0);

    const qtdVendas = vendasMes.length;
    const qtdVendasAnt = vendasMesAnt.length;

    const ticketMedio = qtdVendas > 0 ? faturamento / qtdVendas : 0;
    const ticketMedioAnt = qtdVendasAnt > 0 ? faturamentoAnt / qtdVendasAnt : 0;

    // Receita = comissao + markup (soma dos produtos)
    const calcReceita = (vs: VendaCRM[]) =>
      vs.reduce((s, v) => s + (v.markup_realizado || 0) + v.produtos.reduce((ps, p) => ps + (p.comissao_fornecedor || 0), 0), 0);
    const receita = calcReceita(vendasMes);
    const receitaAnt = calcReceita(vendasMesAnt);

    // Margem liquida
    const receitasMes = receber.filter(r => r.status === 'RECEBIDO' && (r.data_recebimento || r.data_vencimento)?.startsWith(mesAtual))
      .reduce((s, r) => s + r.valor_final, 0);
    const despesasMes = pagar.filter(p => p.status === 'PAGO' && (p.data_pagamento || p.data_vencimento)?.startsWith(mesAtual))
      .reduce((s, p) => s + p.valor_final, 0);
    const receitasMesAnt = receber.filter(r => r.status === 'RECEBIDO' && (r.data_recebimento || r.data_vencimento)?.startsWith(mesAnterior))
      .reduce((s, r) => s + r.valor_final, 0);
    const despesasMesAnt = pagar.filter(p => p.status === 'PAGO' && (p.data_pagamento || p.data_vencimento)?.startsWith(mesAnterior))
      .reduce((s, p) => s + p.valor_final, 0);

    const lucro = receitasMes - despesasMes;
    const lucroAnt = receitasMesAnt - despesasMesAnt;
    const margem = receitasMes > 0 ? (lucro / receitasMes) * 100 : 0;
    const margemAnt = receitasMesAnt > 0 ? (lucroAnt / receitasMesAnt) * 100 : 0;

    // CAC
    const cacMes = cacData.find(c => c.mes === mesAtual);
    const cacMesAnt = cacData.find(c => c.mes === mesAnterior);
    const cacValor = cacMes?.cac || 0;
    const cacValorAnt = cacMesAnt?.cac || 0;

    // Saldo em caixa
    const saldoCaixa = contas.reduce((s, c) => s + (c.saldo_atual || 0), 0);

    // Deltas
    const delta = (atual: number, anterior: number) =>
      anterior > 0 ? ((atual - anterior) / anterior) * 100 : (atual > 0 ? 100 : 0);

    return {
      faturamento, faturamentoAnt, qtdVendas, qtdVendasAnt,
      ticketMedio, ticketMedioAnt, receita, receitaAnt,
      margem, margemAnt, cacValor, cacValorAnt,
      saldoCaixa, lucro, lucroAnt,
      receitasMes, despesasMes,
      delta,
      vendasMes,
    };
  }, [vendas, receber, pagar, contas, cacData, mesAtual, mesAnterior]);

  // KPIs
  const kpis: KPI[] = useMemo(() => [
    {
      label: 'Faturamento', valor: BRL(calc.faturamento), valorNum: calc.faturamento,
      delta: calc.faturamentoAnt > 0 ? calc.delta(calc.faturamento, calc.faturamentoAnt) : null,
      deltaLabel: 'vs mes anterior',
      meta: metas.reduce((s, m) => s + (m.meta_valor || 0), 0) || null,
      metaLabel: 'Meta',
      icon: TrendingUp, color: 'text-[var(--t-green)]', bgColor: 'bg-[var(--t-green)]/10',
    },
    {
      label: 'Vendas', valor: String(calc.qtdVendas), valorNum: calc.qtdVendas,
      delta: calc.qtdVendasAnt > 0 ? calc.delta(calc.qtdVendas, calc.qtdVendasAnt) : null,
      deltaLabel: 'vs mes anterior',
      meta: metas.reduce((s, m) => s + (m.meta_quantidade || 0), 0) || null,
      metaLabel: 'Meta',
      icon: ShoppingCart, color: 'text-blue-400', bgColor: 'bg-blue-400/10',
    },
    {
      label: 'Ticket Medio', valor: BRL(calc.ticketMedio), valorNum: calc.ticketMedio,
      delta: calc.ticketMedioAnt > 0 ? calc.delta(calc.ticketMedio, calc.ticketMedioAnt) : null,
      deltaLabel: 'vs mes anterior', meta: null, metaLabel: '',
      icon: BarChart3, color: 'text-purple-400', bgColor: 'bg-purple-400/10',
    },
    {
      label: 'Receita (Agencia)', valor: BRL(calc.receita), valorNum: calc.receita,
      delta: calc.receitaAnt > 0 ? calc.delta(calc.receita, calc.receitaAnt) : null,
      deltaLabel: 'vs mes anterior', meta: null, metaLabel: '',
      icon: DollarSign, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10',
    },
    {
      label: 'Margem Liquida', valor: `${calc.margem.toFixed(1)}%`, valorNum: calc.margem,
      delta: calc.margemAnt > 0 ? calc.margem - calc.margemAnt : null,
      deltaLabel: 'pp vs anterior', meta: null, metaLabel: '',
      icon: Gauge, color: calc.margem >= 15 ? 'text-emerald-400' : calc.margem >= 10 ? 'text-[var(--t-amber)]' : 'text-red-400',
      bgColor: calc.margem >= 15 ? 'bg-emerald-400/10' : calc.margem >= 10 ? 'bg-amber-400/10' : 'bg-red-400/10',
    },
    {
      label: 'CAC', valor: BRL(calc.cacValor), valorNum: calc.cacValor,
      delta: calc.cacValorAnt > 0 ? calc.delta(calc.cacValor, calc.cacValorAnt) : null,
      deltaLabel: 'vs mes anterior', meta: null, metaLabel: '',
      icon: Target, color: 'text-orange-400', bgColor: 'bg-orange-400/10',
      invertDelta: true,
    },
    {
      label: 'Saldo em Caixa', valor: BRL(calc.saldoCaixa), valorNum: calc.saldoCaixa,
      delta: null, deltaLabel: 'soma de todas as contas', meta: null, metaLabel: '',
      icon: Wallet, color: 'text-cyan-400', bgColor: 'bg-cyan-400/10',
    },
    {
      label: 'Lucro do Mes', valor: BRL(calc.lucro), valorNum: calc.lucro,
      delta: calc.lucroAnt !== 0 ? calc.delta(calc.lucro, Math.abs(calc.lucroAnt)) : null,
      deltaLabel: 'vs mes anterior', meta: null, metaLabel: '',
      icon: Trophy, color: calc.lucro >= 0 ? 'text-emerald-400' : 'text-red-400',
      bgColor: calc.lucro >= 0 ? 'bg-emerald-400/10' : 'bg-red-400/10',
    },
  ], [calc, metas]);

  // ============================================================
  // ALERTAS
  // ============================================================

  const alertas: Alerta[] = useMemo(() => {
    const list: Alerta[] = [];
    const hj = today();

    // Parcelas vencidas (a receber)
    const parcelasAtrasadas = receber.filter(r => r.status === 'ATRASADO' || (r.status === 'PENDENTE' && r.data_vencimento < hj));
    if (parcelasAtrasadas.length > 0) {
      const total = parcelasAtrasadas.reduce((s, r) => s + r.valor_final, 0);
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
      const total = pagamentosVencidos.reduce((s, p) => s + p.valor_final, 0);
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
      const total = pagProximos.reduce((s, p) => s + p.valor_final, 0);
      list.push({
        id: 'pag_proximos', tipo: 'PAGAMENTO_PROXIMO', prioridade: 'ATENCAO',
        titulo: `${pagProximos.length} pagamento(s) nos proximos 5 dias — ${BRL(total)}`,
        descricao: pagProximos.slice(0, 2).map(p => `${p.fornecedor_nome} (${fmtDate(p.data_vencimento)})`).join(', '),
        link: '/financeiro-ag/pagar', linkLabel: 'Ver',
      });
    }

    // CAC subiu
    if (calc.cacValor > 0 && calc.cacValorAnt > 0 && calc.cacValor > calc.cacValorAnt * 1.05) {
      const pctSubiu = ((calc.cacValor - calc.cacValorAnt) / calc.cacValorAnt * 100).toFixed(0);
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
      const total = parcelasHoje.reduce((s, r) => s + r.valor_final, 0);
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
      const fat = vs.reduce((s, v) => s + (v.valor_final || 0), 0);
      const rec = vs.reduce((s, v) => s + (v.markup_realizado || 0) + v.produtos.reduce((ps, p) => ps + (p.comissao_fornecedor || 0), 0), 0);
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
      const ent = receber.filter(r => r.status === 'RECEBIDO' && (r.data_recebimento || r.data_vencimento)?.startsWith(m))
        .reduce((s, r) => s + r.valor_final, 0);
      const sai = pagar.filter(p => p.status === 'PAGO' && (p.data_pagamento || p.data_vencimento)?.startsWith(m))
        .reduce((s, p) => s + p.valor_final, 0);
      raw.unshift({ mes: m, entradas: ent, saidas: sai });
      m = prevMonth(m);
    }
    raw.forEach(r => {
      saldoAcum += r.entradas - r.saidas;
      months.push({ mes: r.mes, label: getMesLabel(r.mes), entradas: r.entradas, saidas: r.saidas, saldo: saldoAcum });
    });
    return months;
  }, [receber, pagar, mesAtual]);

  const chartComposicao = useMemo(() => {
    const map: Record<string, number> = {};
    calc.vendasMes.forEach(v => {
      v.produtos.forEach(p => {
        const tipo = p.tipo || 'OUTROS';
        map[tipo] = (map[tipo] || 0) + p.valor_venda;
      });
    });
    const cores: Record<string, string> = {
      AEREO: '#60a5fa', HOTEL: '#a78bfa', PACOTE: '#34d399', SEGURO: '#fbbf24',
      RECEPTIVO: '#22d3ee', CRUZEIRO: '#818cf8', CARRO: '#fb923c', INGRESSO: '#f472b6',
      GRUPO: '#2dd4bf', OUTROS: '#94a3b8',
    };
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map).map(([tipo, valor]) => ({
      tipo, valor, pct: total > 0 ? (valor / total) * 100 : 0,
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
          const thisYear = new Date(`${anoAtual}-${dnMMDD}T00:00:00`);
          const now = new Date(hj + 'T00:00:00');
          const diff = Math.ceil((thisYear.getTime() - now.getTime()) / 86400000);
          return diff < 0 ? diff + 365 : diff;
        })();
        return {
          nome: c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia,
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
      const pctReceita = calc.faturamento > 0 ? ((calc.receita / calc.faturamento) * 100).toFixed(0) : '0';
      parts.push(`A receita da agencia (comissoes + markup) foi de ${BRL(calc.receita)} (${pctReceita}%).`);
    }
    if (calc.cacValor > 0) {
      parts.push(`O CAC ficou em ${BRL(calc.cacValor)} por cliente.`);
    }
    parts.push(`O fluxo de caixa ${calc.lucro >= 0 ? 'fechou positivo' : 'ficou negativo'} em ${BRL(calc.lucro)}.`);
    if (contas.length > 0) {
      parts.push(`Saldo total em caixa: ${BRL(calc.saldoCaixa)} (${contas.length} conta${contas.length > 1 ? 's' : ''}).`);
    }
    return parts;
  }, [calc, contas]);

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const maxFat = Math.max(...chartFaturamento.map(m => m.faturamento), 1);
  const maxFluxo = Math.max(...chartFluxo.map(m => Math.max(m.entradas, m.saidas)), 1);

  const prioIcon = {
    CRITICO: <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />,
    ATENCAO: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
    POSITIVO: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
    INFO: <Info className="w-4 h-4 text-blue-400 shrink-0" />,
  };

  const prioBorder = {
    CRITICO: 'border-l-red-400',
    ATENCAO: 'border-l-amber-400',
    POSITIVO: 'border-l-emerald-400',
    INFO: 'border-l-blue-400',
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* FAIXA 1: BARRA DE CONTEXTO */}
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">
              {getGreeting()} <span className="text-[var(--t-green)]">Bruno</span>
            </h1>
            <p className="text-sm text-[var(--t-text-secondary)] mt-1">
              {getMonthName(mesAtual)} &middot; Ultima atualizacao: {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchAll}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--t-bg-secondary)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Atualizar
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8 space-y-6">

        {/* FAIXA 2: KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            const deltaPositive = kpi.invertDelta ? (kpi.delta !== null && kpi.delta < 0) : (kpi.delta !== null && kpi.delta > 0);
            const deltaNeutral = kpi.delta === null || kpi.delta === 0;
            const metaPct = kpi.meta && kpi.meta > 0 ? Math.min((kpi.valorNum / kpi.meta) * 100, 100) : null;
            const metaCor = metaPct !== null
              ? metaPct >= 80 ? 'bg-emerald-400' : metaPct >= 50 ? 'bg-amber-400' : 'bg-red-400'
              : '';
            const metaAtingida = metaPct !== null && metaPct >= 100;

            return (
              <div key={i} className="bg-[var(--t-surface)] rounded-2xl p-5 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors relative overflow-hidden">
                {metaAtingida && (
                  <div className="absolute top-2 right-2 text-lg" title="Meta atingida!">
                    <Trophy className="w-5 h-5 text-amber-400" />
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">{kpi.label}</span>
                  <div className={`w-8 h-8 rounded-lg ${kpi.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${kpi.color}`} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-[var(--t-text)] leading-none">{kpi.valor}</div>
                <div className="flex items-center gap-2 mt-2">
                  {!deltaNeutral && (
                    <span className={`text-xs font-medium flex items-center gap-0.5 ${deltaPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {deltaPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {PCT(kpi.delta!)}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--t-text-muted)]">{kpi.deltaLabel}</span>
                </div>
                {metaPct !== null && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-[var(--t-text-secondary)] mb-1">
                      <span>{kpi.metaLabel}: {kpi.label === 'Vendas' ? kpi.meta : BRL(kpi.meta!)}</span>
                      <span>{metaPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--t-border)] overflow-hidden">
                      <div className={`h-full rounded-full ${metaCor} transition-all`} style={{ width: `${metaPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* FAIXA 3: ALERTAS + ACOES RAPIDAS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Alertas */}
          <div className="lg:col-span-2 bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Alertas Ativos ({alertas.length})
              </h2>
            </div>
            {alertas.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <div className="text-sm text-[var(--t-text-secondary)]">Tudo em ordem! Nenhum alerta ativo.</div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {alertas.slice(0, 7).map(a => (
                  <div key={a.id} className={`px-5 py-3 flex items-start gap-3 border-l-2 ${prioBorder[a.prioridade]} hover:bg-[var(--t-surface-hover)] transition-colors`}>
                    {prioIcon[a.prioridade]}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)]">{a.titulo}</div>
                      {a.descricao && <div className="text-xs text-[var(--t-text-secondary)] mt-0.5">{a.descricao}</div>}
                    </div>
                    <Link href={a.link} className="shrink-0 text-xs text-[var(--t-green)] hover:underline flex items-center gap-1">
                      {a.linkLabel} <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acoes Rapidas */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Acoes Rapidas
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { href: '/vendas/nova', icon: ShoppingCart, label: 'Nova Venda', primary: true },
                { href: '/vendas/orcamentos', icon: FileText, label: 'Novo Orcamento', primary: false },
                { href: '/pessoas/clientes', icon: Users, label: 'Novo Cliente', primary: false },
                { href: '/grupos', icon: Package, label: 'Novo Grupo', primary: false },
                { href: '/financeiro-ag/receber', icon: Receipt, label: 'Registrar Recebimento', primary: false },
                { href: '/financeiro-ag/pagar', icon: CreditCard, label: 'Registrar Pagamento', primary: false },
              ].map(a => (
                <Link key={a.href} href={a.href}>
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    a.primary
                      ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium shadow-lg hover:opacity-90'
                      : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]'
                  }`} style={a.primary ? { boxShadow: '0 4px 15px var(--t-green-shadow)' } : {}}>
                    <a.icon className="w-4 h-4" />
                    {a.label}
                  </div>
                </Link>
              ))}
            </div>
            {/* Quick counters */}
            <div className="px-4 pb-4 space-y-1.5 border-t border-[var(--t-border)] pt-3 mx-4">
              {[
                { label: 'Orcamentos pendentes', count: vendas.filter(v => v.status === 'ORCAMENTO').length, href: '/vendas/orcamentos' },
                { label: 'Contas a receber', count: receber.filter(r => r.status === 'PENDENTE' || r.status === 'ATRASADO').length, href: '/financeiro-ag/receber' },
                { label: 'Contas a pagar', count: pagar.filter(p => p.status === 'PENDENTE' || p.status === 'VENCIDO').length, href: '/financeiro-ag/pagar' },
              ].map(q => (
                <Link key={q.href} href={q.href} className="flex items-center justify-between text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)] transition-colors">
                  <span>{q.label}</span>
                  <span className="bg-[var(--t-bg)] px-2 py-0.5 rounded-full text-[10px] font-medium">{q.count}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* FAIXA 4: GRAFICOS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Grafico 1: Faturamento */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)]">Faturamento (6 meses)</h2>
            </div>
            <div className="px-4 py-4">
              <div className="flex items-end gap-1.5 justify-between" style={{ height: 160 }}>
                {chartFaturamento.map(m => {
                  const h = Math.max((m.faturamento / maxFat) * 140, 4);
                  return (
                    <div key={m.mes} className="flex flex-col items-center flex-1" title={`${m.label}: ${BRL(m.faturamento)}`}>
                      <div className="flex items-end" style={{ height: 140 }}>
                        <div className="w-full max-w-[32px] rounded-t bg-[var(--t-green)]/70 transition-all mx-auto" style={{ height: h }} />
                      </div>
                      <span className="text-[9px] text-[var(--t-text-muted)] mt-1">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Grafico 2: Entradas vs Saidas */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)]">Entradas vs Saidas</h2>
            </div>
            <div className="px-4 py-4">
              <div className="flex items-end gap-1 justify-between" style={{ height: 160 }}>
                {chartFluxo.map(m => {
                  const hEnt = Math.max((m.entradas / maxFluxo) * 130, 2);
                  const hSai = Math.max((m.saidas / maxFluxo) * 130, 2);
                  return (
                    <div key={m.mes} className="flex flex-col items-center flex-1">
                      <div className="flex items-end gap-0.5" style={{ height: 130 }}>
                        <div className="w-3 rounded-t bg-emerald-500/70" style={{ height: hEnt }} title={`Entradas: ${BRL(m.entradas)}`} />
                        <div className="w-3 rounded-t bg-red-500/70" style={{ height: hSai }} title={`Saidas: ${BRL(m.saidas)}`} />
                      </div>
                      <span className="text-[9px] text-[var(--t-text-muted)] mt-1">{m.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 justify-center mt-2 pt-2 border-t border-[var(--t-border)]">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-500/70" /><span className="text-[9px] text-[var(--t-text-muted)]">Entradas</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-red-500/70" /><span className="text-[9px] text-[var(--t-text-muted)]">Saidas</span></div>
              </div>
            </div>
          </div>

          {/* Grafico 3: Composicao */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)]">Composicao de Vendas</h2>
            </div>
            <div className="px-4 py-4">
              {chartComposicao.length === 0 ? (
                <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Sem dados no mes</div>
              ) : (
                <div className="space-y-2">
                  {chartComposicao.slice(0, 6).map(c => (
                    <div key={c.tipo} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.cor }} />
                      <span className="text-xs text-[var(--t-text-secondary)] flex-1">{c.tipo}</span>
                      <span className="text-xs text-[var(--t-text)] font-medium">{BRL(c.valor)}</span>
                      <span className="text-[10px] text-[var(--t-text-muted)] w-10 text-right">{c.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                  {/* Mini bar */}
                  <div className="flex rounded-full overflow-hidden h-2 mt-3">
                    {chartComposicao.map(c => (
                      <div key={c.tipo} style={{ width: `${c.pct}%`, backgroundColor: c.cor }} className="transition-all" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RESUMO TEXTUAL */}
        <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] p-5">
          <h2 className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-[var(--t-green)]" />
            Resumo — {getMonthName(mesAtual)}
          </h2>
          <div className="text-sm text-[var(--t-text-secondary)] space-y-1 leading-relaxed">
            {resumo.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>

        {/* FAIXA 5: ANIVERSARIANTES + DATAS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Aniversariantes */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2">
                <Cake className="w-4 h-4 text-pink-400" /> Aniversariantes
              </h2>
            </div>
            {aniversariantes.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--t-text-muted)]">
                Nenhum aniversariante no periodo
              </div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {/* Hoje */}
                {aniversariantes.filter(a => a.isHoje).length > 0 && (
                  <div className="px-5 py-2">
                    <span className="text-[10px] text-pink-400 uppercase tracking-wider font-medium">Hoje</span>
                  </div>
                )}
                {aniversariantes.filter(a => a.isHoje).map((a, i) => (
                  <div key={`hoje-${i}`} className="px-5 py-3 flex items-center gap-3 bg-pink-500/5">
                    <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center">
                      <Cake className="w-4 h-4 text-pink-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)] font-medium">{a.nome}</div>
                      <div className="text-[11px] text-[var(--t-text-secondary)]">{a.idade} anos</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {a.whatsapp && (
                        <a href={`https://wa.me/55${a.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Feliz aniversario, ${a.nome?.split(' ')[0]}! A ENTUR Viagens deseja tudo de melhor!`)}`}
                          target="_blank" rel="noreferrer"
                          className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500/20 transition-colors"
                          title="WhatsApp">
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                        </a>
                      )}
                      {a.email && (
                        <a href={`mailto:${a.email}?subject=Feliz Aniversario!&body=Ola ${a.nome?.split(' ')[0]}! A ENTUR Viagens deseja um feliz aniversario!`}
                          className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center hover:bg-blue-500/20 transition-colors"
                          title="E-mail">
                          <Mail className="w-3.5 h-3.5 text-blue-400" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}

                {/* Esta semana */}
                {aniversariantes.filter(a => a.isSemana).length > 0 && (
                  <div className="px-5 py-2">
                    <span className="text-[10px] text-[var(--t-text-secondary)] uppercase tracking-wider font-medium">Esta semana</span>
                  </div>
                )}
                {aniversariantes.filter(a => a.isSemana).map((a, i) => (
                  <div key={`semana-${i}`} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--t-bg)] flex items-center justify-center">
                      <Cake className="w-4 h-4 text-[var(--t-text-muted)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)]">{a.nome}</div>
                      <div className="text-[11px] text-[var(--t-text-secondary)]">{fmtDate(a.data)} — {a.idade} anos — em {a.diasAte} dia(s)</div>
                    </div>
                    {a.whatsapp && (
                      <a href={`https://wa.me/55${a.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                        className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500/20 transition-colors">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                      </a>
                    )}
                  </div>
                ))}

                {/* Este mes */}
                {aniversariantes.filter(a => !a.isHoje && !a.isSemana && a.diasAte <= 30).length > 0 && (
                  <div className="px-5 py-2">
                    <span className="text-[10px] text-[var(--t-text-secondary)] uppercase tracking-wider font-medium">Este mes (+{aniversariantes.filter(a => !a.isHoje && !a.isSemana).length})</span>
                  </div>
                )}
                {aniversariantes.filter(a => !a.isHoje && !a.isSemana).slice(0, 3).map((a, i) => (
                  <div key={`mes-${i}`} className="px-5 py-2.5 flex items-center gap-3 text-sm text-[var(--t-text-secondary)]">
                    <Cake className="w-3.5 h-3.5 text-[var(--t-text-muted)]" />
                    <span className="flex-1">{a.nome} — {fmtDate(a.data)}</span>
                    <span className="text-[10px]">em {a.diasAte}d</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Datas Importantes */}
          <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <h2 className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" /> Proximos 7 Dias
              </h2>
            </div>
            {datasImportantes.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--t-text-muted)]">
                Nenhum evento nos proximos 7 dias
              </div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {datasImportantes.map((e, i) => {
                  const dias = daysUntil(e.data);
                  return (
                    <Link key={i} href={e.link} className="px-5 py-3 flex items-start gap-3 hover:bg-[var(--t-surface-hover)] transition-colors">
                      <div className="w-10 text-center shrink-0 mt-0.5">
                        <div className="text-xs font-bold text-[var(--t-text)]">{e.data.slice(8, 10)}</div>
                        <div className="text-[9px] text-[var(--t-text-muted)] uppercase">{getMesLabel(e.data.slice(0, 7)).split('/')[0]}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--t-text)]">{e.titulo}</div>
                        <div className="text-xs text-[var(--t-text-secondary)]">{e.descricao}</div>
                      </div>
                      <span className={`text-[10px] shrink-0 px-2 py-0.5 rounded-full ${
                        dias === 0 ? 'bg-amber-500/10 text-amber-400' :
                        dias <= 2 ? 'bg-red-500/10 text-red-400' :
                        'bg-[var(--t-bg)] text-[var(--t-text-muted)]'
                      }`}>
                        {dias === 0 ? 'Hoje' : dias === 1 ? 'Amanha' : `${dias}d`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Ultimas Vendas (mantido como faixa bonus) */}
        <div className="bg-[var(--t-surface)] rounded-2xl border border-[var(--t-border)] overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--t-border)]">
            <h2 className="text-sm font-medium text-[var(--t-text)]">Ultimas Vendas</h2>
            <Link href="/vendas" className="text-xs text-[var(--t-green)] flex items-center gap-1 hover:underline">
              Ver todas <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {vendas.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--t-text-muted)]">Nenhuma venda registrada</div>
          ) : (
            <div className="divide-y divide-[var(--t-border)]">
              {[...vendas].sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || '')).slice(0, 6).map(v => {
                const cliente = clientes.find(c => c.id === v.cliente_id);
                const nome = cliente ? (cliente.tipo === 'PF' ? cliente.nome_completo : cliente.nome_fantasia || cliente.razao_social) : 'Cliente';
                const statusColor: Record<string, string> = {
                  ORCAMENTO: 'bg-amber-500/10 text-amber-400',
                  RESERVADO: 'bg-blue-500/10 text-blue-400',
                  CONFIRMADO: 'bg-emerald-500/10 text-emerald-400',
                  CANCELADO: 'bg-red-500/10 text-red-400',
                  CONCLUIDO: 'bg-[var(--t-bg)] text-[var(--t-text-secondary)]',
                };
                return (
                  <div key={v.id} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--t-surface-hover)] transition-colors">
                    <div className="w-9 h-9 rounded-full bg-[var(--t-green)]/10 flex items-center justify-center shrink-0">
                      <DollarSign className="w-4 h-4 text-[var(--t-green)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--t-text)] truncate">{nome}</div>
                      <div className="text-[11px] text-[var(--t-text-secondary)]">#{v.numero} &middot; {fmtDate(v.data_venda)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-[var(--t-text)]">{BRL(v.valor_final || 0)}</div>
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${statusColor[v.status] || ''}`}>{v.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
