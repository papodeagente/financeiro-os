'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, ContaBancaria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/fin/PageHeader';
import { FilterBar } from '@/components/fin/FilterBar';
import { MetricCard } from '@/components/fin/MetricCard';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import { statusChipVariants } from '@/components/fin/StatusChip';
import { cn, formatDate } from '@/lib/utils';
import type { FunilPayload } from '@/lib/funil-types';
import {
  round2, num, somaPor, divSegura, hojeISO, dataLocal, paraISO, mesDe, dentroDoPeriodo,
} from '@/lib/money';
import { GraficoFluxo } from './GraficoFluxo';

function getWeekRange(date: Date): string {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

type Periodo = 'SEMANAL' | 'MENSAL';

interface FluxoLine {
  periodo: string;
  label: string;
  entradas: number;
  saidas: number;
  saldo: number;
  saldoAcumulado: number;
  detalhesEntradas: Array<{ desc: string; valor: number; data: string }>;
  detalhesSaidas: Array<{ desc: string; valor: number; data: string }>;
}

/** Movimento unitário de caixa: realizado (baixado) ou previsto (em aberto). */
interface Evento {
  desc: string;
  valor: number;
  data: string;
  realizado: boolean;
}

/** Linha do painel lateral de detalhe. Só apresentação: nada é recalculado aqui. */
type DetalheLinha = { id: string; desc: string; valor: number; data: string };

const COLUNAS_DETALHE: FinColuna<DetalheLinha>[] = [
  {
    id: 'desc',
    tipo: 'texto',
    cabecalho: 'Lançamento',
    render: (d) => <span className="fin-t-body text-[var(--fin-text)]">{d.desc}</span>,
  },
  { id: 'data', tipo: 'data', cabecalho: 'Data', valor: (d) => d.data || null },
  { id: 'valor', tipo: 'dinheiro', cabecalho: 'Valor', valor: (d) => d.valor },
];

function paraDetalhe(
  itens: Array<{ desc: string; valor: number; data: string }>,
  prefixo: string,
): DetalheLinha[] {
  return itens.map((d, i) => ({ id: `${prefixo}-${i}`, desc: d.desc, valor: d.valor, data: d.data }));
}

/** Alturas do esqueleto do gráfico: forma do conteúdo real, sem valor pintado. */
const ALTURAS_ESQUELETO = ['h-1/2', 'h-3/4', 'h-1/3', 'h-full', 'h-2/3', 'h-2/5'];

function nomeDoLancamento(quem: string | null | undefined, descricao: string | null | undefined): string {
  const partes = [quem, descricao].filter((p): p is string => Boolean(p && p.trim()));
  return partes.length > 0 ? partes.join(', ') : 'Lançamento sem descrição';
}

export default function FluxoCaixaPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [funis, setFunis] = useState<FunilPayload[]>([]);
  const [incluirFunis, setIncluirFunis] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('MENSAL');
  const [meses, setMeses] = useState(6);
  const [detalhe, setDetalhe] = useState<FluxoLine | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [cr, cp, cb, fs] = await Promise.all([
        loadEntities<ContaReceber>('contas-receber'),
        loadEntities<ContaPagar>('contas-pagar'),
        loadEntities<ContaBancaria>('contas-bancarias'),
        loadEntities<FunilPayload>('funis'),
      ]);
      setContasReceber(cr);
      setContasPagar(cp);
      setContasBancarias(cb);
      setFunis(fs);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta não respondeu. Nenhum valor é exibido enquanto os dados não chegarem.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  /**
   * Soma a receita/investimento projetado dos funis em execução.
   * A projeção é aplicada uniformemente sobre os períodos futuros (simplificação consciente:
   * o funil não carrega calendário próprio, é uma estimativa mensal distribuída por período).
   */
  const projecaoFunis = useMemo(() => {
    const ativos = funis.filter(f => f.status === 'em_execucao');
    let receita = 0;
    let investimento = 0;
    for (const f of ativos) {
      const kpis = f.data?.cenarios?.[0]?.kpis;
      if (!kpis) continue;
      receita = round2(receita + num(kpis.receita_liquida ?? kpis.receita_bruta ?? 0));
      investimento = round2(investimento + num(kpis.investimento_total ?? 0));
    }
    // Se for semanal, dividir por 4 (aproximação mês/semana)
    const divisor = periodo === 'MENSAL' ? 1 : 4;
    return {
      count: ativos.length,
      receita: round2(divSegura(receita, divisor)),
      investimento: round2(divSegura(investimento, divisor)),
    };
  }, [funis, periodo]);

  // Saldo computado: saldo_inicial + recebido - pago. Sempre bate com
  // o histórico de baixas, independente de saldo_atual persistido.
  const saldoAtual = useMemo(() =>
    calcularSaldoBancario(contasBancarias, contasReceber, contasPagar),
    [contasBancarias, contasReceber, contasPagar]
  );

  // Cada conta vira até DOIS eventos de caixa:
  //  · REALIZADO: o que já foi baixado (RECEBIDO/PAGO, ou a parcela já
  //    quitada de uma baixa PARCIAL), na data da baixa;
  //  · PREVISTO: o saldo ainda em aberto, na data de vencimento.
  // Separar os dois é o que permite montar o saldo base com dinheiro REAL e
  // tratar pendência vencida como projeção, nunca como caixa existente.
  const eventosEntrada = useMemo<Evento[]>(() => {
    const out: Evento[] = [];
    for (const cr of contasReceber) {
      if (cr.status === 'CANCELADO') continue;
      const desc = nomeDoLancamento(cr.cliente_nome, cr.descricao);
      const baixado = cr.status === 'RECEBIDO'
        ? round2(num(cr.valor_recebido) || num(cr.valor_final))
        : round2(num(cr.valor_recebido));
      if (baixado > 0) {
        out.push({ desc, valor: baixado, data: cr.data_recebimento || cr.data_vencimento || '', realizado: true });
      }
      const emAberto = cr.status === 'RECEBIDO'
        ? 0
        : round2(num(cr.valor_final) - num(cr.valor_recebido));
      if (emAberto > 0) {
        out.push({ desc, valor: emAberto, data: cr.data_vencimento || '', realizado: false });
      }
    }
    return out;
  }, [contasReceber]);

  const eventosSaida = useMemo<Evento[]>(() => {
    const out: Evento[] = [];
    for (const cp of contasPagar) {
      if (cp.status === 'CANCELADO') continue;
      const desc = nomeDoLancamento(cp.fornecedor_nome, cp.descricao);
      const baixado = cp.status === 'PAGO'
        ? round2(num(cp.valor_pago) || num(cp.valor_final))
        : round2(num(cp.valor_pago));
      if (baixado > 0) {
        out.push({ desc, valor: baixado, data: cp.data_pagamento || cp.data_vencimento || '', realizado: true });
      }
      const emAberto = cp.status === 'PAGO'
        ? 0
        : round2(num(cp.valor_final) - num(cp.valor_pago));
      if (emAberto > 0) {
        out.push({ desc, valor: emAberto, data: cp.data_vencimento || '', realizado: false });
      }
    }
    return out;
  }, [contasPagar]);

  const fluxo = useMemo(() => {
    const hoje = hojeISO();
    const today = dataLocal(hoje)!; // ancorado ao meio-dia, imune a fuso
    const lines: FluxoLine[] = [];

    // Constrói a linha do período. `extras` carrega os atrasados, que só
    // entram na PRIMEIRA linha (projeção de cobrança/pagamento imediato).
    const buildLine = (
      periodoId: string,
      label: string,
      isInPeriod: (date: string) => boolean,
      extras?: { entradas: Evento[]; saidas: Evento[] },
    ): FluxoLine => {
      const entradas = [
        ...eventosEntrada.filter(e => e.data && isInPeriod(e.data)),
        ...(extras?.entradas ?? []),
      ];
      const saidas = [
        ...eventosSaida.filter(e => e.data && isInPeriod(e.data)),
        ...(extras?.saidas ?? []),
      ];
      const totalEntradas = somaPor(entradas, e => e.valor);
      const totalSaidas = somaPor(saidas, e => e.valor);
      return {
        periodo: periodoId,
        label,
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: round2(totalEntradas - totalSaidas),
        saldoAcumulado: 0, // preenchido depois
        detalhesEntradas: entradas.map(e => ({ desc: e.desc, valor: e.valor, data: e.data })),
        detalhesSaidas: saidas.map(e => ({ desc: e.desc, valor: e.valor, data: e.data })),
      };
    };

    // Início do primeiro período (mês corrente ou semana corrente).
    let primeiroPeriodoStart: string;
    if (periodo === 'MENSAL') {
      primeiroPeriodoStart = `${mesDe(hoje)}-01`;
    } else {
      const ws = dataLocal(hoje)!;
      ws.setDate(ws.getDate() - ws.getDay());
      primeiroPeriodoStart = paraISO(ws);
    }

    // Linha base = saldo_inicial + APENAS movimento realizado anterior ao
    // primeiro período. Somar pendência vencida aqui inflava o saldo inicial
    // com dinheiro que nunca entrou.
    const linhaBase = round2(
      somaPor(contasBancarias, c => c.saldo_inicial)
      + somaPor(eventosEntrada.filter(e => e.realizado && e.data && e.data < primeiroPeriodoStart), e => e.valor)
      - somaPor(eventosSaida.filter(e => e.realizado && e.data && e.data < primeiroPeriodoStart), e => e.valor),
    );

    // Atrasados = em aberto com vencimento anterior ao primeiro período.
    // Viram projeção do primeiro período (é quando se espera resolver).
    const marcarAtraso = (e: Evento): Evento => ({ ...e, desc: `${e.desc} (em atraso)` });
    const atrasadosEntrada = eventosEntrada
      .filter(e => !e.realizado && e.data && e.data < primeiroPeriodoStart)
      .map(marcarAtraso);
    const atrasadosSaida = eventosSaida
      .filter(e => !e.realizado && e.data && e.data < primeiroPeriodoStart)
      .map(marcarAtraso);

    if (periodo === 'MENSAL') {
      for (let i = 0; i < meses; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1, 12, 0, 0, 0);
        const ym = mesDe(paraISO(d));
        const line = buildLine(
          ym,
          getMonthLabel(ym),
          (date) => mesDe(date) === ym,
          i === 0 ? { entradas: atrasadosEntrada, saidas: atrasadosSaida } : undefined,
        );
        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : linhaBase;
        line.saldoAcumulado = round2(prevAcum + line.saldo);
        lines.push(line);
      }
    } else {
      const weeks = meses * 4;
      for (let i = 0; i < weeks; i++) {
        const ws = dataLocal(hoje)!;
        ws.setDate(ws.getDate() - ws.getDay() + i * 7);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        const startStr = paraISO(ws);
        const endStr = paraISO(we);
        const line = buildLine(
          startStr,
          getWeekRange(ws),
          (date) => dentroDoPeriodo(date, startStr, endStr),
          i === 0 ? { entradas: atrasadosEntrada, saidas: atrasadosSaida } : undefined,
        );
        const prevAcum = lines.length > 0 ? lines[lines.length - 1].saldoAcumulado : linhaBase;
        line.saldoAcumulado = round2(prevAcum + line.saldo);
        lines.push(line);
      }
    }

    return lines;
  }, [eventosEntrada, eventosSaida, contasBancarias, periodo, meses]);

  // KPIs "Previstas" = tudo que ainda está em aberto (saldo devedor das
  // parciais incluído), em qualquer data.
  const totals = useMemo(() => ({
    entradas: somaPor(eventosEntrada.filter(e => !e.realizado), e => e.valor),
    saidas: somaPor(eventosSaida.filter(e => !e.realizado), e => e.valor),
  }), [eventosEntrada, eventosSaida]);

  // Visual bar scale
  const maxVal = useMemo(() =>
    Math.max(...fluxo.map(f => Math.max(f.entradas, f.saidas)), 1),
    [fluxo]
  );

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';
  const estadoValor = loading ? 'carregando' : erro ? 'indisponivel' : 'ok';

  const abertosEntrada = eventosEntrada.filter(e => !e.realizado).length;
  const abertosSaida = eventosSaida.filter(e => !e.realizado).length;
  const totalLancamentos = eventosEntrada.length + eventosSaida.length;

  const saldoPrevisto = fluxo.length > 0 ? fluxo[fluxo.length - 1].saldoAcumulado : null;
  const linhaNegativa = fluxo.find(f => f.saldoAcumulado < 0) ?? null;
  const idNegativo = linhaNegativa ? linhaNegativa.periodo : null;
  const quandoNegativo = linhaNegativa
    ? (periodo === 'MENSAL' ? linhaNegativa.label : formatDate(linhaNegativa.periodo))
    : null;

  const horizonteTexto = periodo === 'MENSAL'
    ? `${meses} meses`
    : `${meses * 4} semanas`;

  // Nenhuma contagem e nenhuma afirmação sobre o caixa enquanto o dado não
  // chegou: durante carregamento e erro o contexto só descreve o recorte.
  const dadosProntos = estado === 'ok';

  const contextoSaldoPrevisto = !dadosProntos
    ? `Projeção para o fim dos próximos ${horizonteTexto}`
    : quandoNegativo
      ? `Saldo negativo a partir de ${quandoNegativo}, dentro de ${horizonteTexto}`
      : `Nenhum período negativo nos próximos ${horizonteTexto}`;

  const contextoEntradas = dadosProntos
    ? `${abertosEntrada} ${abertosEntrada === 1 ? 'recebimento em aberto' : 'recebimentos em aberto'}, em qualquer data`
    : 'Recebimentos ainda em aberto, em qualquer data';

  const contextoSaidas = dadosProntos
    ? `${abertosSaida} ${abertosSaida === 1 ? 'pagamento em aberto' : 'pagamentos em aberto'}, em qualquer data`
    : 'Pagamentos ainda em aberto, em qualquer data';

  const totaisTabela = useMemo(() => ([
    { colunaId: 'entradas', valor: somaPor(fluxo, f => f.entradas), rotulo: `Entradas somadas em ${horizonteTexto}` },
    { colunaId: 'saidas', valor: somaPor(fluxo, f => f.saidas), rotulo: `Saídas somadas em ${horizonteTexto}` },
  ]), [fluxo, horizonteTexto]);

  const colunas = useMemo<FinColuna<FluxoLine>[]>(() => ([
    {
      id: 'periodo',
      tipo: 'texto',
      cabecalho: 'Período',
      sortable: true,
      minWidth: 180,
      acessor: (f) => f.periodo,
      render: (f) => (
        <span className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{f.label}</span>
          {f.periodo === idNegativo ? (
            <span className={statusChipVariants({ tone: 'negativo' })}>Saldo negativo</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'entradas',
      tipo: 'dinheiro',
      cabecalho: 'Entradas',
      sortable: true,
      valor: (f) => f.entradas,
      sub: (f) => (f.detalhesEntradas.length > 0
        ? `${f.detalhesEntradas.length} ${f.detalhesEntradas.length === 1 ? 'lançamento' : 'lançamentos'}`
        : null),
    },
    {
      id: 'saidas',
      tipo: 'dinheiro',
      cabecalho: 'Saídas',
      sortable: true,
      valor: (f) => f.saidas,
      sub: (f) => (f.detalhesSaidas.length > 0
        ? `${f.detalhesSaidas.length} ${f.detalhesSaidas.length === 1 ? 'lançamento' : 'lançamentos'}`
        : null),
    },
    {
      id: 'saldo',
      tipo: 'dinheiro',
      cabecalho: 'Saldo do período',
      sortable: true,
      prioridade: 1,
      valor: (f) => f.saldo,
      tone: (f) => (f.saldo < 0 ? 'negativo' : 'neutro'),
    },
    {
      id: 'acumulado',
      tipo: 'dinheiro',
      cabecalho: 'Saldo acumulado',
      sortable: true,
      valor: (f) => f.saldoAcumulado,
      tone: (f) => (f.saldoAcumulado < 0 ? 'negativo' : 'neutro'),
    },
  ]), [idNegativo]);

  const filtrosAtivos =
    (periodo !== 'MENSAL' ? 1 : 0) + (meses !== 6 ? 1 : 0) + (incluirFunis ? 1 : 0);

  const semDado =
    estado === 'ok' &&
    eventosEntrada.length === 0 &&
    eventosSaida.length === 0 &&
    contasBancarias.length === 0;

  const projecaoVisivel = incluirFunis && projecaoFunis.count > 0 ? projecaoFunis : null;

  const esqueletoGrafico = (
    <div className="flex h-32 items-end gap-[var(--fin-s-2)]">
      {ALTURAS_ESQUELETO.map((altura, i) => (
        <span
          key={i}
          className={cn(
            'flex-1 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]',
            altura,
          )}
        />
      ))}
    </div>
  );

  return (
    <div className="bg-[var(--fin-bg)] text-[var(--fin-text)] py-[var(--fin-page-pad)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)] px-[var(--fin-page-pad)]">

        <PageHeader
          titulo="Fluxo de caixa"
          subtitulo="Projeção de entradas e saídas com base no que já foi baixado e no que continua em aberto"
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
        />

        <FilterBar
          selects={[
            {
              id: 'granularidade',
              rotulo: 'Ver por',
              valor: periodo,
              opcoes: [
                { valor: 'SEMANAL', rotulo: 'Semana' },
                { valor: 'MENSAL', rotulo: 'Mês' },
              ],
              onChange: (v) => setPeriodo(v as Periodo),
            },
            {
              id: 'horizonte',
              rotulo: 'Horizonte',
              valor: String(meses),
              opcoes: [
                { valor: '3', rotulo: '3 meses' },
                { valor: '6', rotulo: '6 meses' },
                { valor: '12', rotulo: '12 meses' },
              ],
              onChange: (v) => setMeses(parseInt(v)),
            },
            ...(projecaoFunis.count > 0 ? [{
              id: 'projecao-crm',
              rotulo: 'Projeção do CRM',
              valor: incluirFunis ? 'sim' : 'nao',
              opcoes: [
                { valor: 'nao', rotulo: 'Não incluir' },
                { valor: 'sim', rotulo: `Incluir (${projecaoFunis.count})` },
              ],
              onChange: (v: string) => setIncluirFunis(v === 'sim'),
            }] : []),
          ]}
          resumo={{
            exibidos: fluxo.length,
            total: periodo === 'MENSAL' ? 12 : 48,
            substantivo: periodo === 'MENSAL' ? 'meses projetados' : 'semanas projetadas',
            escopo: dadosProntos
              ? `sobre ${totalLancamentos} ${totalLancamentos === 1 ? 'lançamento cadastrado' : 'lançamentos cadastrados'}`
              : undefined,
          }}
          ativos={filtrosAtivos}
          onLimpar={() => {
            setPeriodo('MENSAL');
            setMeses(6);
            setIncluirFunis(false);
          }}
        />

        <div className="grid gap-[var(--fin-s-4)] md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            rotulo="Saldo previsto"
            valor={saldoPrevisto}
            estado={estadoValor}
            emphasis="destaque"
            tone={saldoPrevisto !== null && saldoPrevisto < 0 ? 'negativo' : 'neutro'}
            contexto={contextoSaldoPrevisto}
            explicacao="Quanto sobra no caixa ao fim do horizonte escolhido, somando o que já entrou e saiu com o que ainda está em aberto."
          />
          <MetricCard
            rotulo="Saldo atual"
            valor={saldoAtual}
            estado={estadoValor}
            tone={saldoAtual < 0 ? 'negativo' : 'neutro'}
            contexto="Saldo inicial mais recebido menos pago"
          />
          <MetricCard
            rotulo="Entradas previstas"
            valor={totals.entradas}
            estado={estadoValor}
            contexto={contextoEntradas}
          />
          <MetricCard
            rotulo="Saídas previstas"
            valor={totals.saidas}
            estado={estadoValor}
            contexto={contextoSaidas}
          />
        </div>

        {semDado ? (
          <EmptyLesson
            motivo="sem-dado"
            titulo="Ainda não há nada para projetar"
            oQueE="O fluxo de caixa mostra, período a período, quanto dinheiro entra e quanto sai, somando o que já foi baixado com o que continua em aberto."
            comoComeca={[
              'Cadastre as contas bancárias com o saldo inicial de cada uma.',
              'Lance as contas a receber com a data de vencimento.',
              'Lance as contas a pagar com a data de vencimento.',
            ]}
            acao={{ rotulo: 'Cadastrar conta bancária', href: '/financeiro-ag/contas-bancarias' }}
          />
        ) : (
          <>
            {estado === 'erro' ? null : (
              <Card className="gap-[var(--fin-s-4)] p-[var(--fin-s-4)]">
                <h2 className="fin-t-subhead text-[var(--fin-text)]">Entradas e saídas por período</h2>
                <DataState estado={estado} esqueleto={esqueletoGrafico}>
                  <GraficoFluxo barras={fluxo} maxVal={maxVal} projecao={projecaoVisivel} />
                </DataState>
              </Card>
            )}

            <FinTable
              linhas={fluxo}
              colunas={colunas}
              chave={(f) => f.periodo}
              estado={estado}
              erro={erro ? { mensagem: erro, onTentarDeNovo: load } : null}
              totais={totaisTabela}
              onLinhaClick={(f) => setDetalhe(f)}
              vazio={{
                motivo: 'sem-resultado',
                titulo: 'Nenhum período para mostrar',
                oQueE: 'Escolha um horizonte maior para ver a projeção dos próximos meses.',
              }}
            />
          </>
        )}

        <RecordSheet
          aberto={detalhe !== null}
          onOpenChange={(aberto) => { if (!aberto) setDetalhe(null); }}
          titulo={detalhe ? detalhe.label : 'Período'}
          descricao="Lançamentos que compõem as entradas e as saídas deste período"
          largura={640}
          resumo={detalhe ? (
            <span className="flex items-center justify-between gap-[var(--fin-s-3)]">
              <span className="fin-t-body text-[var(--fin-text-2)]">Saldo do período</span>
              <Money
                valor={detalhe.saldo}
                estado="ok"
                size="metricSm"
                tone={detalhe.saldo < 0 ? 'negativo' : 'neutro'}
              />
            </span>
          ) : undefined}
          acaoPrimaria={{ rotulo: 'Fechar', onClick: () => setDetalhe(null) }}
        >
          {detalhe ? (
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              <section className="flex flex-col gap-[var(--fin-s-3)]">
                <h3 className="fin-t-subhead text-[var(--fin-text)]">
                  Entradas ({detalhe.detalhesEntradas.length})
                </h3>
                <FinTable
                  linhas={paraDetalhe(detalhe.detalhesEntradas, 'entrada')}
                  colunas={COLUNAS_DETALHE}
                  chave={(d) => d.id}
                  densidade="compacta"
                  estado="ok"
                  vazio={{
                    motivo: 'sem-resultado',
                    titulo: 'Nenhuma entrada neste período',
                    oQueE: 'Não há recebimento baixado nem em aberto com data dentro deste período.',
                  }}
                />
              </section>

              <section className="flex flex-col gap-[var(--fin-s-3)]">
                <h3 className="fin-t-subhead text-[var(--fin-text)]">
                  Saídas ({detalhe.detalhesSaidas.length})
                </h3>
                <FinTable
                  linhas={paraDetalhe(detalhe.detalhesSaidas, 'saida')}
                  colunas={COLUNAS_DETALHE}
                  chave={(d) => d.id}
                  densidade="compacta"
                  estado="ok"
                  vazio={{
                    motivo: 'sem-resultado',
                    titulo: 'Nenhuma saída neste período',
                    oQueE: 'Não há pagamento baixado nem em aberto com data dentro deste período.',
                  }}
                />
              </section>
            </div>
          ) : null}
        </RecordSheet>
      </div>
    </div>
  );
}
