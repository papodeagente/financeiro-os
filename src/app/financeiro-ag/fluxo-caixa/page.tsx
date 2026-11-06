'use client';

import { BarChart3, ChevronLeft, ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ContaReceber, ContaPagar, ContaBancaria, Agencia } from '@/lib/crm-types';
import { loadEntities, loadAgencia } from '@/lib/crm-storage';
import {
  eventosFolhaPrevistos, DIA_PAGAMENTO_FOLHA_PADRAO, type EntradaPessoa,
} from '@/lib/folha-pagamento';
import {
  TIPOS_DE_PERIODO, agrupamentoPadrao, agrupamentosDoPeriodo, competenciasDaFolha,
  lancamentosDoCaixa, montarCaderno, periodoContem, periodoQueContem, periodoVizinho, rotuloDoDia,
  type Agrupamento, type LinhaDoCaderno, type TipoDePeriodo,
} from '@/lib/caderno-caixa';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import {
  alertaDeSaldo, comparativoDoPeriodo, gradeContaPorDia, lancamentosDaConta, titulosDaConta,
  type FiltroDeConta, type LinhaDaGrade,
} from '@/lib/fluxo-comparativo';
import type { DocumentoExportado, FiltroAplicado } from '@/lib/exportacao/documento';
import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { GradePorConta, type MedidaDaGrade } from './GradePorConta';
import { hojeISO, num, round2 } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';
import type { FunilPayload } from '@/lib/funil-types';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { Money } from '@/components/fin/Money';
import { Segmentado } from '@/components/fin/Segmentado';
import { MoneyField } from '@/components/fin/MoneyField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurvaDoSaldo } from './CurvaDoSaldo';
import { Caderno } from './Caderno';
import { DetalheDaLinha } from './DetalheDaLinha';
import { PrevistoRealizado } from './PrevistoRealizado';
import { lerEmpresasVisiveis } from '@/components/fin/useEmpresas';
import { contasNoRecorte } from '@/lib/empresas';

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

const ROTULO_AGRUPAMENTO: Record<Agrupamento, string> = { dia: 'Dia a dia', semana: 'Por semana', mes: 'Por mês' };

/** Saldo mínimo escolhido: fica no navegador (05/11/2026). */
const CHAVE_MINIMO = 'fluxo-caixa-saldo-minimo';
const TODAS_AS_CONTAS = 'todas';
const CONTROLE =
  'fin-t-body h-11 min-w-56 gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10';

/** "1 out", "31 dez": a ponta do período no rótulo do saldo. */
function diaEMes(iso: string): string {
  return rotuloDoDia(iso).split(', ')[1] ?? iso;
}

function Interruptor({ ligado, onChange, children }: { ligado: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-1 fin-t-body text-[var(--fin-text-2)] lg:min-h-9"
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--fin-dur-rapida)]',
          ligado ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-border-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-[var(--fin-surface)] shadow-[var(--fin-e-card)] transition-transform duration-[var(--fin-dur-rapida)]',
            ligado ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      {children}
    </button>
  );
}

/** Um termo da conta do período: "Saldo em 1 out", "+ Entrou", "− Saiu", "= Saldo em 31 out". */
function Termo({
  sinal, rotulo, valor, tom = 'neutro', nota, destaque = false, largoNoCelular = false,
}: {
  sinal?: '+' | '−' | '=';
  rotulo: string;
  valor: number;
  tom?: 'neutro' | 'positivo' | 'negativo';
  nota?: string;
  destaque?: boolean;
  /** Ocupa as duas colunas no celular. */
  largoNoCelular?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1',
        // No celular o saldo final ganha a linha toda: em meia coluna o
        // número grande não cabe.
        largoNoCelular && 'col-span-2 lg:col-span-1',
        destaque && 'col-span-2 border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] lg:col-span-1 lg:border-t-0 lg:pt-0',
      )}
    >
      <span className="flex items-center gap-1.5 fin-t-caption text-[var(--fin-text-3)]">
        {sinal ? (
          <span
            aria-hidden="true"
            className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--fin-surface-2)] fin-t-caption font-semibold leading-none text-[var(--fin-text-2)]"
          >
            {sinal}
          </span>
        ) : null}
        {rotulo}
      </span>
      <Money
        valor={valor}
        estado="ok"
        size={destaque ? 'metric' : 'metricSm'}
        tone={tom}
        align="esquerda"
        className="min-w-0"
      />
      {nota ? <span className="fin-t-caption text-[var(--fin-text-3)]">{nota}</span> : null}
    </div>
  );
}

export default function FluxoCaixaPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [funis, setFunis] = useState<FunilPayload[]>([]);
  const [incluirFunis, setIncluirFunis] = useState(false);
  const [pessoasFolha, setPessoasFolha] = useState<EntradaPessoa[]>([]);
  const [diaPagamentoFolha, setDiaPagamentoFolha] = useState(DIA_PAGAMENTO_FOLHA_PADRAO);
  // Ligada por padrão: folha não é aposta como a projeção de funil, é
  // compromisso assumido. Esconder por padrão faria o caixa parecer melhor.
  const [incluirFolha, setIncluirFolha] = useState(true);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const hoje = hojeISO();
  const [tipo, setTipo] = useState<TipoDePeriodo>('mes');
  const [ancora, setAncora] = useState(hoje);
  const [agrupamento, setAgrupamento] = useState<Agrupamento>(agrupamentoPadrao('mes'));
  const [linhaAberta, setLinhaAberta] = useState<LinhaDoCaderno | null>(null);
  // 05/11/2026: conta escolhida (padrão: todas, o caderno de sempre), visão
  // do Previsto × Realizado e saldo mínimo.
  const [contaId, setContaId] = useState<string>(TODAS_AS_CONTAS);
  const [visaoComparativo, setVisaoComparativo] = useState<Agrupamento>(agrupamentoPadrao('mes'));
  const [saldoMinimo, setSaldoMinimo] = useState(0);
  // E7, G3: grade conta × dia (saldo no fim do dia ou movimento do dia).
  const [medidaGrade, setMedidaGrade] = useState<MedidaDaGrade>('saldo');
  const [contaDoDetalhe, setContaDoDetalhe] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const salvo = Number(window.localStorage.getItem(CHAVE_MINIMO));
    if (Number.isFinite(salvo) && salvo > 0) setSaldoMinimo(salvo);
  }, []);

  function trocarMinimo(v: number) {
    const valor = Number.isFinite(v) && v > 0 ? round2(v) : 0;
    setSaldoMinimo(valor);
    if (typeof window !== 'undefined') {
      if (valor > 0) window.localStorage.setItem(CHAVE_MINIMO, String(valor));
      else window.localStorage.removeItem(CHAVE_MINIMO);
    }
  }

  const periodo = useMemo(() => periodoQueContem(tipo, ancora), [tipo, ancora]);
  const estaNoPeriodoDeHoje = periodoContem(periodo, hoje);

  async function load() {
    setLoading(true);
    try {
      const [cr, cp, cb, fs, folhaResp, ag] = await Promise.all([
        loadEntities<ContaReceber>('contas-receber'),
        loadEntities<ContaPagar>('contas-pagar'),
        loadEntities<ContaBancaria>('contas-bancarias'),
        loadEntities<FunilPayload>('funis'),
        // Sem permissão de folha a tela continua com receber e pagar.
        fetch('/api/folha').then(r => (r.ok ? r.json() : null)).catch(() => null),
        loadAgencia<Agencia>().catch(() => null),
      ]);
      // Várias empresas (E7): o rateado entre empresas entra só com a parte das
      // empresas marcadas. Uma empresa só: as listas como vieram.
      const visiveis = await lerEmpresasVisiveis();
      setContasReceber(contasNoRecorte(cr, visiveis));
      setContasPagar(contasNoRecorte(cp, visiveis));
      setContasBancarias(cb);
      setFunis(fs);
      setPessoasFolha(folhaResp?.pessoas ?? []);
      setDiaPagamentoFolha(Number(ag?.dia_pagamento_folha) || DIA_PAGAMENTO_FOLHA_PADRAO);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta não respondeu. Nenhum valor é exibido enquanto os dados não chegarem.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function trocarTipo(novo: TipoDePeriodo) {
    setTipo(novo);
    setAgrupamento(agrupamentoPadrao(novo));
    setVisaoComparativo(agrupamentoPadrao(novo));
  }

  const eventosFolha = useMemo(() => {
    if (!incluirFolha || pessoasFolha.length === 0) return [];
    // Os ids já existentes impedem a folha de contar duas vezes quando o mês
    // virou conta a pagar de verdade.
    return eventosFolhaPrevistos(
      pessoasFolha, competenciasDaFolha(periodo, hoje), diaPagamentoFolha, contasPagar.map(c => c.id),
    );
  }, [incluirFolha, pessoasFolha, periodo, hoje, diaPagamentoFolha, contasPagar]);

  // Conta escolhida que sumiu (apagada): volta para todas.
  const contaEscolhida = contaId === TODAS_AS_CONTAS ? null : (contasBancarias.find(c => c.id === contaId) ?? null);
  const filtro: FiltroDeConta = useMemo(() => ({
    contaId: contaEscolhida?.id ?? null,
    caixaGeralId: contasBancarias.find(c => c.nome === 'Caixa Geral')?.id ?? null,
  }), [contaEscolhida, contasBancarias]);

  // Todas as contas: exatamente o caderno de sempre (mesma chamada).
  const { lancamentos, semConta } = useMemo(() => {
    if (!filtro.contaId) {
      return {
        lancamentos: lancamentosDoCaixa({ receber: contasReceber, pagar: contasPagar, folha: eventosFolha, hoje }),
        semConta: { quantidade: 0, valor: 0 },
      };
    }
    return lancamentosDaConta({ receber: contasReceber, pagar: contasPagar, folha: eventosFolha, filtro, hoje });
  }, [contasReceber, contasPagar, eventosFolha, filtro, hoje]);

  const caderno = useMemo(
    () => montarCaderno({
      lancamentos, contas: contaEscolhida ? [contaEscolhida] : contasBancarias, periodo, agrupamento, hoje,
    }),
    [lancamentos, contaEscolhida, contasBancarias, periodo, agrupamento, hoje],
  );

  // O mesmo número do "Saldo atual" de sempre: o caderno fecha com ele.
  const noBancoAgora = useMemo(() => {
    if (!contaEscolhida) return calcularSaldoBancario(contasBancarias, contasReceber, contasPagar);
    const t = titulosDaConta({ receber: contasReceber, pagar: contasPagar, filtro });
    return calcularSaldoBancario([contaEscolhida], t.receber, t.pagar);
  }, [contaEscolhida, contasBancarias, contasReceber, contasPagar, filtro]);

  const comparativo = useMemo(
    () => comparativoDoPeriodo({
      receber: contasReceber, pagar: contasPagar, folha: eventosFolha, periodo, visao: visaoComparativo, filtro, hoje,
    }),
    [contasReceber, contasPagar, eventosFolha, periodo, visaoComparativo, filtro, hoje],
  );

  const alerta = useMemo(() => alertaDeSaldo(caderno.curva, saldoMinimo, hoje), [caderno.curva, saldoMinimo, hoje]);

  // Todas as contas liberadas, cada uma numa linha; a soma é o caderno de todas.
  const grade = useMemo(
    () => gradeContaPorDia({
      receber: contasReceber, pagar: contasPagar, folha: eventosFolha, contas: contasBancarias,
      caixaGeralId: filtro.caixaGeralId, periodo, hoje,
    }),
    [contasReceber, contasPagar, eventosFolha, contasBancarias, filtro.caixaGeralId, periodo, hoje],
  );

  function abrirDiaDaConta(l: LinhaDaGrade, dia: string, i: number) {
    setContaDoDetalhe(l.nome);
    setLinhaAberta({
      chave: `${l.id}|${dia}`, inicio: dia, fim: dia, rotulo: rotuloDoDia(dia),
      entradas: l.entradas[i], saidas: l.saidas[i], saldo: l.saldos[i],
      lancamentos: l.lancamentosPorDia[dia] ?? [], contemHoje: dia === hoje, futura: dia > hoje,
    });
  }

  const filtrosDoArquivo = (): FiltroAplicado[] => [
    { rotulo: 'Período', valor: periodo.rotulo },
    ...(contaEscolhida ? [{ rotulo: 'Conta', valor: contaEscolhida.nome || 'Conta sem nome' }] : []),
  ];

  /** O caderno na tela: uma linha por dia, semana ou mês. */
  function documentoDoCaderno(): DocumentoExportado {
    return {
      titulo: 'Fluxo de caixa',
      subtitulo: `${ROTULO_AGRUPAMENTO[agrupamento]} · previsto pelo vencimento, realizado pela data da baixa`,
      filtros: filtrosDoArquivo(),
      colunas: [
        { id: 'rotulo', rotulo: agrupamento === 'dia' ? 'Dia' : agrupamento === 'semana' ? 'Semana' : 'Mês', tipo: 'texto' },
        { id: 'entradas', rotulo: 'Entrou', tipo: 'dinheiro' },
        { id: 'saidas', rotulo: 'Saiu', tipo: 'dinheiro' },
        { id: 'saldo', rotulo: 'Saldo no fim', tipo: 'dinheiro' },
        { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      ],
      linhas: [
        { rotulo: `Saldo em ${diaEMes(periodo.inicio)}`, saldo: caderno.saldoInicial },
        ...caderno.linhas.map(l => ({
          rotulo: l.rotulo, entradas: l.entradas, saidas: l.saidas, saldo: l.saldo,
          situacao: l.contemHoje ? 'Hoje' : l.futura ? 'Previsto' : 'Realizado',
        })),
      ],
      totais: { entradas: caderno.entradas, saidas: caderno.saidas, saldo: caderno.saldoFinal },
    };
  }

  /** A grade conta × dia, em pé: um dia por linha, uma conta por coluna (cabe no papel). */
  function documentoDaGrade(): DocumentoExportado {
    const medida = medidaGrade === 'saldo' ? 'Saldo no fim do dia' : 'Movimento do dia';
    const valores = (l: { saldos: number[]; movimentos: number[] }, i: number) => (medidaGrade === 'saldo' ? l.saldos[i] : l.movimentos[i]);
    return {
      titulo: 'Fluxo de caixa por conta e dia',
      subtitulo: `${medida} · dias depois de hoje são previsão`,
      filtros: [{ rotulo: 'Período', valor: periodo.rotulo }, { rotulo: 'Mostrar', valor: medida }],
      colunas: [
        { id: 'dia', rotulo: 'Dia', tipo: 'data' },
        ...grade.linhas.map(l => ({ id: `c_${l.id}`, rotulo: l.nome, tipo: 'dinheiro' as const })),
        { id: 'total', rotulo: 'Total', tipo: 'dinheiro' },
      ],
      linhas: [
        ...(medidaGrade === 'saldo'
          ? [{ dia: 'Saldo anterior', total: grade.total.saldoInicial, ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, l.saldoInicial])) }]
          : []),
        ...grade.dias.map((d, i) => ({
          dia: d, total: valores(grade.total, i),
          ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, valores(l, i)])),
        })),
      ],
      ...(medidaGrade === 'movimento'
        ? { totais: { total: grade.total.movimentos.reduce((a, b) => round2(a + b), 0), ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, l.movimentos.reduce((a, b) => round2(a + b), 0)])) } }
        : {}),
      orientacao: grade.linhas.length > 5 ? 'paisagem' : 'retrato',
    };
  }

  // Estimativa mensal dos funis em execução. Não é dinheiro contratado:
  // aparece escrita, fora do saldo, multiplicada pelos meses do período.
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
    const meses = TIPOS_DE_PERIODO.find(t => t.id === tipo)?.meses ?? 1;
    return { count: ativos.length, receita: round2(receita * meses), investimento: round2(investimento * meses) };
  }, [funis, tipo]);

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';
  const semDado =
    estado === 'ok' && contasReceber.length === 0 && contasPagar.length === 0 && contasBancarias.length === 0;

  const temFolha = pessoasFolha.some(p => p.vinculo?.na_folha);
  const periodoFechado = periodo.fim < hoje;
  const periodoFuturo = periodo.inicio > hoje;

  const notaEntrou = periodoFuturo ? 'previsto'
    : caderno.jaEntrou === caderno.entradas ? (caderno.entradas > 0 ? 'tudo já entrou' : undefined)
      : `${formatBRL(caderno.jaEntrou)} já entrou`;
  const notaSaiu = periodoFuturo ? 'previsto'
    : caderno.jaSaiu === caderno.saidas ? (caderno.saidas > 0 ? 'tudo já saiu' : undefined)
      : `${formatBRL(caderno.jaSaiu)} já saiu`;

  const esqueleto = (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <div className={cn(CARTAO, 'h-80 animate-pulse')} />
      <div className={cn(CARTAO, 'h-96 animate-pulse')} />
    </div>
  );

  return (
    <div className="bg-[var(--fin-bg)] py-[var(--fin-page-pad)] text-[var(--fin-text)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)] px-[var(--fin-page-pad)]">
        <PageHeader
          empresas
          icone={BarChart3}
          titulo="Fluxo de caixa"
          subtitulo="O que entra e o que sai, como num caderno: saldo anterior, mais as entradas, menos as saídas"
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
        />

        {/* Escolha do período: o tipo à esquerda, a página do caderno à direita. */}
        <div className="flex flex-col gap-[var(--fin-s-3)] md:flex-row md:items-center md:justify-between">
          <Segmentado<TipoDePeriodo>
            rotulo="Período"
            valor={tipo}
            onChange={trocarTipo}
            opcoes={TIPOS_DE_PERIODO.map(t => ({ valor: t.id, rotulo: t.rotulo }))}
            cheio="celular"
          />

          <div className="flex items-center justify-between gap-[var(--fin-s-2)] md:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Período anterior"
              onClick={() => setAncora(periodoVizinho(periodo, -1).inicio)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <div className="flex min-w-0 flex-1 flex-col items-center md:min-w-[12.5rem] md:flex-none" aria-live="polite">
              <span className="fin-t-subhead text-[var(--fin-text)]">{periodo.rotulo}</span>
              <span className="fin-t-caption text-[var(--fin-text-3)]">
                {periodo.meses || (estaNoPeriodoDeHoje ? 'este mês' : periodoFechado ? 'já fechado' : 'ainda vem')}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Próximo período"
              onClick={() => setAncora(periodoVizinho(periodo, 1).inicio)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={estaNoPeriodoDeHoje}
              onClick={() => setAncora(hoje)}
              className="h-11 lg:h-9"
            >
              Hoje
            </Button>
          </div>
        </div>

        {contasBancarias.length > 1 ? (
          <div className="flex flex-wrap items-center gap-[var(--fin-s-3)]">
            <Select value={contaEscolhida ? contaEscolhida.id : TODAS_AS_CONTAS} onValueChange={v => setContaId(String(v))}>
              <SelectTrigger
                id="fluxo-conta"
                aria-label="Conta"
                className={cn(CONTROLE, 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0')}
              >
                <span className="fin-t-overline shrink-0 text-[var(--fin-text-3)]">Conta</span>
                <SelectValue>{() => contaEscolhida?.nome || 'Todas as contas'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS_AS_CONTAS} className="fin-t-body">Todas as contas</SelectItem>
                {contasBancarias.map(c => (
                  <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.nome || 'Conta sem nome'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contaEscolhida && semConta.quantidade > 0 ? (
              <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
                <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[var(--fin-text-3)]" />
                {semConta.quantidade === 1
                  ? `1 previsão sem conta escolhida (${formatBRL(semConta.valor)}) fica fora desta conta.`
                  : `${semConta.quantidade} previsões sem conta escolhida (${formatBRL(semConta.valor)}) ficam fora desta conta.`}
                {' '}Em Todas as contas elas entram.
              </p>
            ) : null}
          </div>
        ) : null}

        {semDado ? (
          <EmptyLesson
            motivo="sem-dado"
            titulo="Ainda não há nada no caderno"
            oQueE="O fluxo de caixa mostra, dia a dia, quanto dinheiro entra e quanto sai, somando o que já foi baixado com o que continua em aberto."
            comoComeca={[
              'Cadastre as contas bancárias com o saldo inicial de cada uma.',
              'Lance as contas a receber com a data de vencimento.',
              'Lance as contas a pagar com a data de vencimento.',
            ]}
            acao={{ rotulo: 'Cadastrar conta bancária', href: '/financeiro-ag/contas-bancarias' }}
          />
        ) : (
          <DataState
            estado={estado}
            erro={erro ? { mensagem: erro, onTentarDeNovo: load } : null}
            esqueleto={esqueleto}
          >
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              {/* A conta do período, de ponta a ponta. */}
              <section aria-label={`Resumo de ${periodo.rotulo}`} className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-5)] p-[var(--fin-s-5)] sm:p-[var(--fin-s-6)]')}>
                <div className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-5)] lg:grid-cols-4">
                  <Termo
                    largoNoCelular
                    rotulo={`Saldo em ${diaEMes(periodo.inicio)}`}
                    valor={caderno.saldoInicial}
                    tom={caderno.saldoInicial < 0 ? 'negativo' : 'neutro'}
                  />
                  <Termo sinal="+" rotulo="Entrou" valor={caderno.entradas} tom="positivo" nota={notaEntrou} />
                  <Termo sinal="−" rotulo="Saiu" valor={caderno.saidas} nota={notaSaiu} />
                  <Termo
                    sinal="="
                    rotulo={`Saldo em ${diaEMes(periodo.fim)}`}
                    valor={caderno.saldoFinal}
                    tom={caderno.saldoFinal < 0 ? 'negativo' : 'neutro'}
                    nota={periodoFechado ? 'fechado' : 'previsto'}
                    destaque
                  />
                </div>

                <CurvaDoSaldo curva={caderno.curva} hoje={hoje} minimo={saldoMinimo} />

                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <p className="flex flex-wrap items-baseline gap-x-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                    {contaEscolhida ? `Em ${contaEscolhida.nome || 'esta conta'} agora:` : 'No banco agora:'}
                    <span className={cn('fin-t-body-strong tabular-nums', noBancoAgora < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                      {formatBRL(noBancoAgora)}
                    </span>
                  </p>
                  {saldoMinimo > 0 && alerta.primeiroAbaixoDoMinimo ? (
                    <p className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      O saldo previsto fica abaixo do mínimo de {formatBRL(saldoMinimo)} em {rotuloDoDia(alerta.primeiroAbaixoDoMinimo)}
                      {alerta.menor ? ` e chega a ${formatBRL(alerta.menor.saldo)} em ${rotuloDoDia(alerta.menor.data)}` : ''}.
                    </p>
                  ) : null}
                  {caderno.primeiroDiaNegativo ? (
                    <p className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-negative-text)]">
                      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      O saldo fica negativo em {rotuloDoDia(caderno.primeiroDiaNegativo)}.
                    </p>
                  ) : null}
                  {caderno.vencidasForaDoPeriodo.quantidade > 0 ? (
                    <p className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
                      {caderno.vencidasForaDoPeriodo.quantidade === 1
                        ? `1 conta venceu neste período e segue em aberto (${formatBRL(caderno.vencidasForaDoPeriodo.valor)}). Ela está prevista para hoje.`
                        : `${caderno.vencidasForaDoPeriodo.quantidade} contas venceram neste período e seguem em aberto (${formatBRL(caderno.vencidasForaDoPeriodo.valor)}). Elas estão previstas para hoje.`}
                    </p>
                  ) : null}
                  {incluirFunis && projecaoFunis.count > 0 ? (
                    <p className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
                      Projeção do CRM para o período: +{formatBRL(projecaoFunis.receita)} e −{formatBRL(projecaoFunis.investimento)}.
                      É estimativa de {projecaoFunis.count === 1 ? '1 funil' : `${projecaoFunis.count} funis`} e não entra no saldo.
                    </p>
                  ) : null}
                </div>

                <div className="border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
                  <div className="w-full max-w-60">
                    <MoneyField
                      rotulo="Saldo mínimo"
                      valor={saldoMinimo}
                      onChange={trocarMinimo}
                      ajuda="Linha de aviso no gráfico. Vazio desliga o aviso."
                    />
                  </div>
                </div>
              </section>

              {/* O caderno. */}
              <section aria-label="Caderno" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] py-[var(--fin-s-4)]')}>
                <div className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between sm:px-[var(--fin-s-5)]">
                  <div className="flex flex-col">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">Caderno</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">Toque numa linha para ver o que entrou e o que saiu.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
                    <Segmentado<Agrupamento>
                      rotulo="Mostrar o caderno"
                      valor={agrupamento}
                      onChange={setAgrupamento}
                      opcoes={agrupamentosDoPeriodo(tipo).map(a => ({ valor: a, rotulo: ROTULO_AGRUPAMENTO[a] }))}
                    />
                    <BotaoExportar origem="fluxo-de-caixa" documento={documentoDoCaderno} />
                  </div>
                </div>

                <div className="px-[var(--fin-s-1)] sm:px-[var(--fin-s-2)]">
                  <Caderno caderno={caderno} onAbrir={l => { setContaDoDetalhe(null); setLinhaAberta(l); }} />
                </div>

                {temFolha || projecaoFunis.count > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-[var(--fin-s-5)] gap-y-1 border-t border-[var(--fin-border)] px-[var(--fin-s-4)] pt-[var(--fin-s-3)] sm:px-[var(--fin-s-5)]">
                    <span className="fin-t-caption text-[var(--fin-text-3)]">Na previsão:</span>
                    {temFolha ? (
                      <Interruptor ligado={incluirFolha} onChange={setIncluirFolha}>Folha de pagamento</Interruptor>
                    ) : null}
                    {projecaoFunis.count > 0 ? (
                      <Interruptor ligado={incluirFunis} onChange={setIncluirFunis}>Projeção do CRM</Interruptor>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* Por conta e dia (E7, G3): cada conta numa linha, cada dia numa coluna. */}
              {contasBancarias.length > 0 ? (
                <section aria-labelledby="t-por-conta" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] py-[var(--fin-s-4)]')}>
                  <div className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between sm:px-[var(--fin-s-5)]">
                    <div className="flex flex-col">
                      <h2 id="t-por-conta" className="fin-t-subhead text-[var(--fin-text)]">Por conta e dia</h2>
                      <p className="fin-t-caption text-[var(--fin-text-3)]">
                        {medidaGrade === 'saldo'
                          ? 'Quanto cada conta tem no fim de cada dia. Depois de hoje, é previsão.'
                          : 'Quanto entrou menos o que saiu em cada conta, dia a dia. Toque num valor para ver os lançamentos.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
                      <Segmentado<MedidaDaGrade>
                        rotulo="Mostrar"
                        valor={medidaGrade}
                        onChange={setMedidaGrade}
                        opcoes={[{ valor: 'saldo', rotulo: 'Saldo' }, { valor: 'movimento', rotulo: 'Movimento' }]}
                      />
                      <BotaoExportar origem="fluxo-por-conta" documento={documentoDaGrade} />
                    </div>
                  </div>
                  <div className="border-y border-[var(--fin-border)]">
                    <GradePorConta grade={grade} medida={medidaGrade} hoje={hoje} onAbrir={abrirDiaDaConta} />
                  </div>
                  {grade.linhas.some(l => l.tipo !== 'conta') ? (
                    <p className="flex items-start gap-[var(--fin-s-2)] px-[var(--fin-s-4)] fin-t-caption text-[var(--fin-text-2)] sm:px-[var(--fin-s-5)]">
                      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[var(--fin-text-3)]" />
                      {grade.linhas.some(l => l.tipo === 'sem_conta') ? 'Previsto sem conta: contas em aberto sem conta bancária escolhida e a folha ainda não lançada. ' : ''}
                      {grade.linhas.some(l => l.tipo === 'outras') ? 'Outras contas: títulos de uma conta que não aparece nesta lista. ' : ''}
                      Com elas, a soma bate com o caderno de todas as contas.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {/* Previsto × Realizado (05/11/2026): o combinado ao lado do que aconteceu. */}
              <section aria-labelledby="t-previsto-realizado" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] py-[var(--fin-s-4)]')}>
                <div className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between sm:px-[var(--fin-s-5)]">
                  <div className="flex flex-col">
                    <h2 id="t-previsto-realizado" className="fin-t-subhead text-[var(--fin-text)]">Previsto × Realizado</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      Previsto pelo vencimento. Realizado pela data da baixa, a entrada já sem a taxa da plataforma. Desvio é a diferença.
                    </p>
                  </div>
                  <Segmentado<Agrupamento>
                    rotulo="Ver por"
                    valor={visaoComparativo}
                    onChange={setVisaoComparativo}
                    opcoes={(['dia', 'semana', 'mes'] as Agrupamento[]).map(a => ({ valor: a, rotulo: ROTULO_AGRUPAMENTO[a] }))}
                  />
                </div>

                <div className="border-y border-[var(--fin-border)]">
                  <PrevistoRealizado comparativo={comparativo} rotuloPeriodo={periodo.rotulo} />
                </div>

                {comparativo.atrasados.quantidade > 0 ? (
                  <p className="flex items-start gap-[var(--fin-s-2)] px-[var(--fin-s-4)] fin-t-caption text-[var(--fin-text-2)] sm:px-[var(--fin-s-5)]">
                    <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[var(--fin-text-3)]" />
                    Vencido e em aberto: {formatBRL(comparativo.atrasados.entradas)} a receber e {formatBRL(comparativo.atrasados.saidas)} a pagar.
                    {' '}No caderno e na curva esse dinheiro está previsto para hoje.
                  </p>
                ) : null}
              </section>
            </div>
          </DataState>
        )}

        <DetalheDaLinha
          linha={linhaAberta}
          agrupamento={contaDoDetalhe ? 'dia' : agrupamento}
          contexto={contaDoDetalhe}
          ano={periodo.inicio.slice(0, 4)}
          hoje={hoje}
          onFechar={() => { setLinhaAberta(null); setContaDoDetalhe(null); }}
        />
      </div>
    </div>
  );
}
