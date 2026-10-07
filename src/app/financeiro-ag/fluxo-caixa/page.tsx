'use client';

import { ChevronLeft, ChevronRight, CircleAlert, Info } from 'lucide-react';
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
import { hojeISO, num, round2 } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';
import type { FunilPayload } from '@/lib/funil-types';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { Money } from '@/components/fin/Money';
import { Segmentado } from '@/components/fin/Segmentado';
import { CurvaDoSaldo } from './CurvaDoSaldo';
import { Caderno } from './Caderno';
import { DetalheDaLinha } from './DetalheDaLinha';

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

const ROTULO_AGRUPAMENTO: Record<Agrupamento, string> = { dia: 'Dia a dia', semana: 'Por semana', mes: 'Por mês' };

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
      setContasReceber(cr);
      setContasPagar(cp);
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
  }

  const eventosFolha = useMemo(() => {
    if (!incluirFolha || pessoasFolha.length === 0) return [];
    // Os ids já existentes impedem a folha de contar duas vezes quando o mês
    // virou conta a pagar de verdade.
    return eventosFolhaPrevistos(
      pessoasFolha, competenciasDaFolha(periodo, hoje), diaPagamentoFolha, contasPagar.map(c => c.id),
    );
  }, [incluirFolha, pessoasFolha, periodo, hoje, diaPagamentoFolha, contasPagar]);

  const lancamentos = useMemo(
    () => lancamentosDoCaixa({ receber: contasReceber, pagar: contasPagar, folha: eventosFolha, hoje }),
    [contasReceber, contasPagar, eventosFolha, hoje],
  );

  const caderno = useMemo(
    () => montarCaderno({ lancamentos, contas: contasBancarias, periodo, agrupamento, hoje }),
    [lancamentos, contasBancarias, periodo, agrupamento, hoje],
  );

  // O mesmo número do "Saldo atual" de sempre: o caderno fecha com ele.
  const noBancoAgora = useMemo(
    () => calcularSaldoBancario(contasBancarias, contasReceber, contasPagar),
    [contasBancarias, contasReceber, contasPagar],
  );

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

                <CurvaDoSaldo curva={caderno.curva} hoje={hoje} />

                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <p className="flex flex-wrap items-baseline gap-x-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                    No banco agora:
                    <span className={cn('fin-t-body-strong tabular-nums', noBancoAgora < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                      {formatBRL(noBancoAgora)}
                    </span>
                  </p>
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
              </section>

              {/* O caderno. */}
              <section aria-label="Caderno" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] py-[var(--fin-s-4)]')}>
                <div className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between sm:px-[var(--fin-s-5)]">
                  <div className="flex flex-col">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">Caderno</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">Toque numa linha para ver o que entrou e o que saiu.</p>
                  </div>
                  <Segmentado<Agrupamento>
                    rotulo="Mostrar o caderno"
                    valor={agrupamento}
                    onChange={setAgrupamento}
                    opcoes={agrupamentosDoPeriodo(tipo).map(a => ({ valor: a, rotulo: ROTULO_AGRUPAMENTO[a] }))}
                  />
                </div>

                <div className="px-[var(--fin-s-1)] sm:px-[var(--fin-s-2)]">
                  <Caderno caderno={caderno} onAbrir={setLinhaAberta} />
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
            </div>
          </DataState>
        )}

        <DetalheDaLinha
          linha={linhaAberta}
          agrupamento={agrupamento}
          ano={periodo.inicio.slice(0, 4)}
          hoje={hoje}
          onFechar={() => setLinhaAberta(null)}
        />
      </div>
    </div>
  );
}
