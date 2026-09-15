'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight, ArrowUpRight, CircleCheck, OctagonAlert, TriangleAlert,
} from 'lucide-react';

import type { DashboardFinanceiro } from '@/lib/dashboard-financeiro';
import type { LadoDoLancamento, RecorteDoDetalhe } from '@/lib/dashboard-detalhe';
import { calcularFatoresDeSaude, classificarSaude, gerarInsights, type Insight } from '@/lib/dashboard-insights';
import { janelaDeComparacao } from '@/lib/periodo-financeiro';
import { round2 } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { SerieFinanceira } from '@/components/fin/SerieFinanceira';
import { ProjecaoDeCaixa } from '@/components/fin/ProjecaoDeCaixa';
import { Cascata, type PassoDaCascata } from '@/components/fin/Cascata';
import { PainelDeSaude } from '@/components/fin/PainelDeSaude';
import { Resposta } from '@/components/fin/Resposta';
import { FiltroDePeriodo, usePeriodoDaUrl } from '@/components/fin/FiltroDePeriodo';
import {
  BotaoDePrivacidade, PrivacidadeProvider, ValorProtegido, usePrivacidade,
} from '@/components/fin/Privacidade';
import { GavetaDeLancamentos, type PedidoDeDetalhe } from '@/components/fin/GavetaDeLancamentos';

/**
 * A Central de Inteligência Financeira da agência.
 *
 * O PAINEL ANTIGO mostrava o FATURAMENTO como número grande. Numa agência de
 * viagens o que o cliente paga pertence em boa parte ao fornecedor: numa viagem
 * de R$ 20.000 com R$ 16.500 de operadora, a agência ganhou R$ 3.500. Estampar
 * o volume como receita multiplica o faturamento por sete na cabeça do dono.
 *
 * TRÊS NÍVEIS, nesta ordem:
 *   1. O que está acontecendo  — saldo, entradas, saídas, resultado.
 *   2. Por que está acontecendo — séries, composições, rankings, margem.
 *   3. O que precisa ser feito  — alarmes, agenda, insights, drill-down.
 *
 * E o que os dados NÃO permitem ficou de fora por decisão, não por esquecimento:
 * orçado x realizado (não existe orçamento conciliável no banco), receita por
 * categoria (categoria_id nasce vazia em toda conta gerada por venda), saldo por
 * banco e forma de pagamento (os campos existem e ninguém os preenche). Um
 * gráfico bonito sobre campo vazio é pior que bloco nenhum: ele afirma.
 */

const PCT = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const dataBR = (iso: string) => (iso && iso.length >= 10 ? iso.split('-').reverse().join('/') : '—');
const diaEMes = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const VEREDITO = {
  bom: { rotulo: 'Saudável', icone: CircleCheck, tom: 'positivo' as const },
  atencao: { rotulo: 'Atenção', icone: TriangleAlert, tom: 'aviso' as const },
  risco: { rotulo: 'Risco', icone: OctagonAlert, tom: 'negativo' as const },
  'sem-base': { rotulo: 'Sem base suficiente', icone: TriangleAlert, tom: 'neutro' as const },
};

const TOM_DO_INSIGHT = {
  critico: 'border-[var(--fin-negative)] bg-[var(--fin-negative-soft)]',
  atencao: 'border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]',
  positivo: 'border-[var(--fin-positive)] bg-[var(--fin-positive-soft)]',
  neutro: 'border-[var(--fin-border)] bg-[var(--fin-surface-2)]',
};

const ICONE_DO_INSIGHT = {
  critico: OctagonAlert,
  atencao: TriangleAlert,
  positivo: CircleCheck,
  neutro: ArrowUpRight,
};

/** Variação com base honesta: nulo é "sem base", nunca zero e nunca +100%. */
function Variacao({ pct, base }: { pct: number | null; base: string }) {
  if (pct === null || Math.abs(pct) < 0.05) {
    return <span className="fin-t-caption text-[var(--fin-text-3)]">{`sem base para comparar com ${base}`}</span>;
  }
  const sobe = pct > 0;
  const Glifo = sobe ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="fin-t-caption inline-flex items-center gap-1 text-[var(--fin-text-3)]">
      <Glifo className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-semibold tabular-nums text-[var(--fin-text-2)]">
        {`${sobe ? '+' : '−'}${PCT(Math.abs(pct))}`}
      </span>
      {base}
    </span>
  );
}

function Painel() {
  const { formatar } = usePrivacidade();
  const [janela, estadoDoPeriodo, trocarPeriodo] = usePeriodoDaUrl();
  const [dados, setDados] = useState<DashboardFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [gaveta, setGaveta] = useState<PedidoDeDetalhe | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const busca = new URLSearchParams({ de: janela.de, ate: janela.ate });
      const r = await fetch(`/api/dashboard?${busca}`);
      if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
      setDados(await r.json());
      setAtualizadoEm(new Date());
    } catch (e) {
      // A falha CHEGA à tela. Com a manchete em 44px, anunciar "R$ 0,00 em
      // caixa" durante uma queda é pior do que não desenhar nada.
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, [janela.de, janela.ate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const comparacao = useMemo(() => janelaDeComparacao(janela), [janela]);
  const rotuloDaComparacao = janela.comparacao === 'ano-anterior' ? 'vs. ano passado' : 'vs. período anterior';

  const fatores = useMemo(() => (dados ? calcularFatoresDeSaude(dados) : []), [dados]);
  const veredito = useMemo(() => classificarSaude(fatores), [fatores]);
  const insights: Insight[] = useMemo(
    () => (dados ? gerarInsights(dados, formatar) : []),
    [dados, formatar],
  );

  const abrir = (p: Omit<PedidoDeDetalhe, 'de' | 'ate'>) =>
    setGaveta({ ...p, de: janela.de, ate: janela.ate });

  const abrirRecorte = (
    titulo: string,
    subtitulo: string,
    lado: LadoDoLancamento,
    recorte: RecorteDoDetalhe,
    campo: PedidoDeDetalhe['campo'],
    referencia?: string,
  ) => abrir({ titulo, subtitulo, lado, recorte, campo, referencia });

  // ── Derivados de tela ──────────────────────────────────────────────────
  const faixasDeAging = (faixas: DashboardFinanceiro['aging']['receber']): Parte[] =>
    faixas.map((f, i) => ({
      id: f.id,
      rotulo: f.rotulo,
      valor: f.valor,
      papel: 'seq' as const,
      // O prazo é ORDINAL: os quatro degraus da rampa, do mais urgente ao mais
      // distante. Vencido NÃO ganha vermelho aqui — o vermelho da tela já é o
      // alarme de caixa negativo, e duas coisas vermelhas competem.
      indiceSeq: (Math.min(3, Math.floor((i / Math.max(1, faixas.length - 1)) * 3)) + 1) as 1 | 2 | 3 | 4,
    }));

  const linhas = (itens: Array<{ id: string; nome: string; valor: number }>): LinhaBarra[] =>
    itens.map(i => ({ id: i.id, nome: i.nome, valor: i.valor }));

  const passosDoResultado: PassoDaCascata[] = useMemo(() => {
    if (!dados) return [];
    const d = dados;
    return [
      { id: 'volume', rotulo: 'Volume vendido', valor: d.vendas.volume, papel: 'inicio', detalhe: `${d.vendas.quantidade} ${d.vendas.quantidade === 1 ? 'venda' : 'vendas'} no período` },
      { id: 'repasse', rotulo: 'Repasse a fornecedores', valor: d.vendas.custo, papel: 'subtrai', detalhe: 'O que pertence à operadora, ao hotel e à cia aérea' },
      { id: 'receita', rotulo: 'Receita da agência', valor: d.vendas.receitaAgencia, papel: 'total', detalhe: 'A margem: o que de fato fica com a empresa' },
      { id: 'despesa', rotulo: 'Despesa própria', valor: d.caixa.despesasProprias.atual, papel: 'subtrai', detalhe: 'Paga no período, já sem o repasse' },
      { id: 'resultado', rotulo: 'Resultado', valor: round2(d.vendas.receitaAgencia - d.caixa.despesasProprias.atual), papel: 'total', detalhe: 'Receita da agência menos despesa própria' },
    ];
  }, [dados]);

  const temMovimento = Boolean(
    dados &&
      (dados.caixa.entradas.atual !== 0 ||
        dados.caixa.saidas.atual !== 0 ||
        dados.posicao.receber.emAberto > 0 ||
        dados.posicao.pagar.emAberto > 0 ||
        dados.vendas.quantidade > 0),
  );

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          titulo="Dashboard Financeiro"
          subtitulo="Visão geral da saúde financeira da sua agência"
          atualizadoEm={atualizadoEm}
          onRecarregar={carregar}
        />

        <div className="fin-no-print flex flex-wrap items-center justify-between gap-3">
          <FiltroDePeriodo janela={janela} estado={estadoDoPeriodo} onChange={trocarPeriodo} />
          <BotaoDePrivacidade />
        </div>

        <DataState
          estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
          erro={
            erro
              ? {
                  mensagem: `Não foi possível carregar os dados de ${dataBR(janela.de)} a ${dataBR(janela.ate)}. Nada foi alterado.`,
                  onTentarDeNovo: () => { carregar(); },
                }
              : null
          }
          esqueleto={
            <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
              <div className="h-[200px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
              <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`${CARTAO} h-[112px]`} />
                ))}
              </div>
              <div className="h-[280px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
            </div>
          }
        >
          {dados && !temMovimento ? (
            <div className={`${CARTAO} p-[var(--fin-s-5)]`}>
              <EmptyLesson
                motivo="sem-dado"
                titulo="Ainda não há movimento financeiro neste período"
                oQueE="Este painel lê as contas a receber, as contas a pagar e as vendas para mostrar quanto a agência tem, quanto ganhou e para onde o dinheiro foi."
                comoComeca={[
                  'Cadastre as contas bancárias com o saldo de abertura',
                  'Registre uma venda: as contas a receber e a pagar nascem dela',
                  'Dê baixa quando o dinheiro entrar ou sair',
                ]}
                acao={{ rotulo: 'Registrar venda', href: '/vendas/nova' }}
              />
            </div>
          ) : dados ? (
            <>
              {/* ══ NÍVEL 1 — O QUE ESTÁ ACONTECENDO ═══════════════════════ */}
              <Resposta
                overline="EM CAIXA HOJE"
                valor={<ValorProtegido valor={dados.caixa.saldo} size="resposta" align="esquerda" />}
                frase={
                  `No período entraram ${formatar(dados.caixa.entradas.atual)} e saíram ${formatar(dados.caixa.saidas.atual)}` +
                  (dados.caixa.repasses > 0
                    ? `, dos quais ${formatar(dados.caixa.repasses)} foram repasse a fornecedores.`
                    : '.') +
                  ` Sobraram ${formatar(dados.caixa.resultado.atual)}.`
                }
                chip={{
                  icone: VEREDITO[veredito].icone,
                  rotulo: VEREDITO[veredito].rotulo,
                  tom: VEREDITO[veredito].tom,
                }}
                marca={
                  <ProjecaoDeCaixa
                    saldoHoje={dados.caixa.saldo}
                    dataDeHoje={dados.periodo.hoje}
                    pontos={dados.projecao}
                    formatar={formatar}
                    altura={180}
                    onAtivar={() => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto')}
                  />
                }
              />
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                O saldo vem do histórico de baixas, não do valor guardado em cada conta. A projeção é aritmética
                do que já está lançado, não previsão.
              </p>

              {/* ── Os quatro números de apoio ───────────────────────────── */}
              <ul className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
                <li className={`${CARTAO} flex flex-col gap-1 p-[var(--fin-s-4)]`}>
                  <span className="fin-t-overline text-[var(--fin-text-3)]">Resultado do período</span>
                  <ValorProtegido
                    valor={dados.caixa.resultado.atual}
                    size="metricSm"
                    align="esquerda"
                    tone={dados.caixa.resultado.atual < 0 ? 'negativo' : 'neutro'}
                  />
                  <Variacao pct={dados.caixa.resultado.variacao} base={rotuloDaComparacao} />
                </li>

                <li className={`${CARTAO} flex flex-col gap-1 p-[var(--fin-s-4)]`}>
                  <span className="fin-t-overline text-[var(--fin-text-3)]">Receita da agência</span>
                  <ValorProtegido valor={dados.vendas.receitaAgencia} size="metricSm" align="esquerda" />
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {dados.vendas.margemPct === null
                      ? 'nenhuma venda no período'
                      : `${PCT(dados.vendas.margemPct)} de ${formatar(dados.vendas.volume)} vendidos`}
                  </span>
                </li>

                <li className={`${CARTAO} flex flex-col gap-1 p-[var(--fin-s-4)]`}>
                  <button
                    type="button"
                    className="flex flex-col items-start gap-1 text-left"
                    onClick={() => abrirRecorte('A receber em aberto', 'Tudo que ainda falta entrar', 'receber', 'em-aberto', 'valorEmAberto')}
                  >
                    <span className="fin-t-overline text-[var(--fin-text-3)]">A receber</span>
                    <ValorProtegido valor={dados.posicao.receber.emAberto} size="metricSm" align="esquerda" />
                  </button>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {dados.posicao.receber.vencido > 0
                      ? `${formatar(dados.posicao.receber.vencido)} vencidos em ${dados.posicao.receber.contasVencidas} ${dados.posicao.receber.contasVencidas === 1 ? 'parcela' : 'parcelas'}`
                      : `nada vencido, em ${dados.posicao.receber.contas} ${dados.posicao.receber.contas === 1 ? 'parcela' : 'parcelas'}`}
                  </span>
                </li>

                <li className={`${CARTAO} flex flex-col gap-1 p-[var(--fin-s-4)]`}>
                  <button
                    type="button"
                    className="flex flex-col items-start gap-1 text-left"
                    onClick={() => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto')}
                  >
                    <span className="fin-t-overline text-[var(--fin-text-3)]">A pagar</span>
                    <ValorProtegido valor={dados.posicao.pagar.emAberto} size="metricSm" align="esquerda" />
                  </button>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {dados.posicao.pagar.vencido > 0
                      ? `${formatar(dados.posicao.pagar.vencido)} vencidos em ${dados.posicao.pagar.contasVencidas} ${dados.posicao.pagar.contasVencidas === 1 ? 'conta' : 'contas'}`
                      : `nada vencido, em ${dados.posicao.pagar.contas} ${dados.posicao.pagar.contas === 1 ? 'conta' : 'contas'}`}
                  </span>
                </li>
              </ul>

              {/* ══ NÍVEL 3 — O QUE PRECISA SER FEITO (vem cedo de propósito) */}
              {insights.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Precisa da sua atenção</h2>
                  <ul className="grid gap-2 lg:grid-cols-2">
                    {insights.slice(0, 6).map(i => {
                      const Icone = ICONE_DO_INSIGHT[i.tom];
                      return (
                        <li
                          key={i.id}
                          className={`flex items-start gap-3 rounded-[var(--fin-r-md)] border p-[var(--fin-s-3)] ${TOM_DO_INSIGHT[i.tom]}`}
                        >
                          <Icone className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-2)]" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="fin-t-body text-[var(--fin-text)]">{i.texto}</p>
                            {/* A evidência é o que permite conferir. Insight sem
                                número para checar é opinião. */}
                            {i.evidencia && (
                              <p className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{i.evidencia}</p>
                            )}
                          </div>
                          {i.acao && (
                            <Link
                              href={i.acao.href}
                              className="fin-t-caption shrink-0 self-center whitespace-nowrap text-[var(--fin-accent)] underline underline-offset-2"
                            >
                              {i.acao.rotulo}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* ══ NÍVEL 2 — POR QUE ESTÁ ACONTECENDO ═════════════════════ */}
              <PainelDeSaude fatores={fatores} />

              <GraficoMoldura
                titulo="Entrou, saiu e sobrou"
                sublinha="Mês a mês, em regime de caixa: o corte é pela data em que o dinheiro se moveu."
                estado={dados.serie.length < 2 ? 'insuficiente' : 'ok'}
                vazio={{ frase: 'A comparação mês a mês nasce quando houver movimento em dois meses do período escolhido.' }}
                descricao="Entradas, saídas e resultado por mês, na mesma escala de reais."
                tabela={{
                  colunas: ['Mês', 'Entrou', 'Saiu', 'Sobrou'],
                  linhas: dados.serie.map(p => [p.mes, formatar(p.entradas), formatar(p.saidas), formatar(p.resultado)]),
                }}
              >
                <SerieFinanceira
                  pontos={dados.serie.map(p => ({
                    chave: p.mes,
                    rotulo: `${p.mes.slice(5, 7)}/${p.mes.slice(2, 4)}`,
                    entradas: p.entradas,
                    saidas: p.saidas,
                    resultado: p.resultado,
                  }))}
                  formatar={formatar}
                  altura={240}
                  destaque={dados.serie.length - 1}
                />
              </GraficoMoldura>

              <GraficoMoldura
                titulo="Do que o cliente pagou até o que sobrou"
                sublinha="Numa agência, a maior parte do que o cliente paga pertence ao fornecedor. A cascata mostra onde o dinheiro para."
                estado={dados.vendas.quantidade === 0 ? 'sem-dado' : 'ok'}
                vazio={{ frase: 'Nenhuma venda registrada no período.', acao: { rotulo: 'Registrar venda', href: '/vendas/nova' } }}
                descricao="Volume vendido menos repasse a fornecedores é a receita da agência; menos a despesa própria é o resultado."
                tabela={{
                  colunas: ['Etapa', 'Valor'],
                  linhas: passosDoResultado.map(p => [p.rotulo, formatar(p.valor)]),
                }}
              >
                <Cascata passos={passosDoResultado} formatar={formatar} altura={260} />
              </GraficoMoldura>

              {/* ── Aging dos dois lados, em escala comum ────────────────── */}
              <GraficoMoldura
                titulo="Quando o dinheiro entra e quando ele sai"
                sublinha="As duas faixas estão na mesma escala de reais, então dá para comparar de relance. Toque numa faixa para ver os lançamentos."
                estado={dados.posicao.receber.emAberto + dados.posicao.pagar.emAberto > 0 ? 'ok' : 'sem-dado'}
                vazio={{ frase: 'Nada a receber e nada a pagar em aberto.' }}
                descricao="Saldo em aberto por prazo, a receber e a pagar."
                tabela={{
                  colunas: ['Prazo', 'A receber', 'A pagar'],
                  linhas: [
                    ...new Set([...dados.aging.receber.map(f => f.rotulo), ...dados.aging.pagar.map(f => f.rotulo)]),
                  ].map(rotulo => [
                    rotulo,
                    formatar(dados.aging.receber.find(f => f.rotulo === rotulo)?.valor ?? 0),
                    formatar(dados.aging.pagar.find(f => f.rotulo === rotulo)?.valor ?? 0),
                  ]),
                }}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">
                      {`A receber ${formatar(dados.posicao.receber.emAberto)}`}
                    </p>
                    <BarraDeParte
                      partes={faixasDeAging(dados.aging.receber)}
                      total={Math.max(dados.posicao.receber.emAberto, dados.posicao.pagar.emAberto)}
                      formatar={formatar}
                      trilhoVazioRotulo="nada a receber em aberto"
                      onAtivar={id =>
                        abrirRecorte(
                          'A receber',
                          dados.aging.receber.find(f => f.id === id)?.rotulo ?? '',
                          'receber',
                          id.startsWith('vencido') ? 'vencido' : id === 'hoje' ? 'vence-hoje' : 'em-aberto',
                          'valorEmAberto',
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">
                      {`A pagar ${formatar(dados.posicao.pagar.emAberto)}`}
                    </p>
                    <BarraDeParte
                      partes={faixasDeAging(dados.aging.pagar)}
                      total={Math.max(dados.posicao.receber.emAberto, dados.posicao.pagar.emAberto)}
                      formatar={formatar}
                      trilhoVazioRotulo="nada a pagar em aberto"
                      onAtivar={id =>
                        abrirRecorte(
                          'A pagar',
                          dados.aging.pagar.find(f => f.id === id)?.rotulo ?? '',
                          'pagar',
                          id.startsWith('vencido') ? 'vencido' : id === 'hoje' ? 'vence-hoje' : 'em-aberto',
                          'valorEmAberto',
                        )
                      }
                    />
                  </div>
                </div>
              </GraficoMoldura>

              {/* ── Composições ─────────────────────────────────────────── */}
              <div className="grid gap-[var(--fin-s-4)] xl:grid-cols-2">
                <GraficoMoldura
                  titulo="De onde veio o dinheiro"
                  sublinha="Entradas do período por origem. A comissão de operadora é receita da agência por inteiro; o que vem do cliente é, em boa parte, repasse."
                  estado={dados.receitaPorOrigem.length === 0 ? 'sem-dado' : 'ok'}
                  vazio={{ frase: 'Nenhuma entrada registrada no período.' }}
                  descricao="Entradas do período por origem."
                  tabela={{
                    colunas: ['Origem', 'Valor'],
                    linhas: dados.receitaPorOrigem.map(o => [o.nome, formatar(o.valor)]),
                  }}
                >
                  <BarrasNomeadas
                    linhas={linhas(dados.receitaPorOrigem)}
                    formatar={formatar}
                    ordenacao="dada"
                    onAtivar={id => abrirRecorte('Entradas por origem', '', 'receber', 'origem', 'valorRealizado', id)}
                  />
                </GraficoMoldura>

                <GraficoMoldura
                  titulo="Para onde o dinheiro foi"
                  sublinha="Despesa PRÓPRIA da agência por categoria — o repasse ao fornecedor fica fora, porque ele já saiu dentro da margem da venda."
                  estado={dados.despesaPorCategoria.length === 0 ? 'sem-dado' : 'ok'}
                  vazio={{ frase: 'Nenhuma despesa própria paga no período.' }}
                  descricao="Despesa própria do período por categoria do plano de contas."
                  tabela={{
                    colunas: ['Categoria', 'Valor'],
                    linhas: dados.despesaPorCategoria.map(c => [c.nome, formatar(c.valor)]),
                  }}
                >
                  <BarrasNomeadas
                    linhas={linhas(dados.despesaPorCategoria)}
                    formatar={formatar}
                    onAtivar={id => abrirRecorte('Despesa por categoria', '', 'pagar', 'categoria', 'valorRealizado', id)}
                  />
                </GraficoMoldura>
              </div>

              {/* ── Fornecedores: volume e margem não são a mesma pessoa ── */}
              <div className="grid gap-[var(--fin-s-4)] xl:grid-cols-2">
                <GraficoMoldura
                  titulo="Para quem a agência mais pagou"
                  sublinha="Inclui o repasse: é para onde o dinheiro de fato foi."
                  estado={dados.fornecedores.length === 0 ? 'sem-dado' : 'ok'}
                  vazio={{ frase: 'Nenhum pagamento a fornecedor no período.' }}
                  descricao="Fornecedores pelo valor pago no período."
                  tabela={{
                    colunas: ['Fornecedor', 'Pago'],
                    linhas: dados.fornecedores.map(f => [f.nome, formatar(f.valor)]),
                  }}
                >
                  <BarrasNomeadas
                    linhas={linhas(dados.fornecedores)}
                    formatar={formatar}
                    onAtivar={id => abrirRecorte('Contas deste fornecedor', 'Em aberto', 'pagar', 'contraparte', 'valorEmAberto', id)}
                  />
                </GraficoMoldura>

                <GraficoMoldura
                  titulo="Quem dá margem"
                  sublinha="Quem traz volume não é necessariamente quem deixa resultado. Sai do item da venda, onde preço e custo convivem por fornecedor."
                  estado={dados.margemPorFornecedor.length === 0 ? 'sem-dado' : 'ok'}
                  vazio={{ frase: 'As vendas do período não têm serviço detalhado por fornecedor.' }}
                  descricao="Margem por fornecedor: valor de venda menos custo, nos itens das vendas do período."
                  tabela={{
                    colunas: ['Fornecedor', 'Vendido', 'Custo', 'Margem'],
                    linhas: dados.margemPorFornecedor.map(m => [
                      m.nome, formatar(m.venda), formatar(m.custo), `${formatar(m.margem)}${m.margemPct === null ? '' : ` (${PCT(m.margemPct)})`}`,
                    ]),
                  }}
                >
                  <BarrasNomeadas
                    linhas={dados.margemPorFornecedor.map(m => ({
                      id: m.id,
                      nome: m.nome,
                      valor: m.margem,
                      secundario: `${m.margemPct === null ? 'sem base' : PCT(m.margemPct)} de margem · ${formatar(m.venda)} vendidos`,
                      detalhes: [`custo ${formatar(m.custo)}`],
                    }))}
                    formatar={formatar}
                  />
                </GraficoMoldura>
              </div>

              {/* ── O aperto que só existe em agência de viagens ─────────── */}
              {dados.descasamento.length > 0 && (
                <section className={`${CARTAO} flex flex-col gap-2 p-[var(--fin-s-4)]`}>
                  <div>
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">O fornecedor vence antes de o cliente pagar</h2>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">
                      Nestas vendas o dinheiro sai antes de entrar, e a diferença sai do caixa da agência.
                    </p>
                  </div>
                  <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {dados.descasamento.map(v => (
                      <li key={v.vendaId} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="fin-t-body-strong text-[var(--fin-text)]">
                            {`Venda ${v.numero}${v.cliente ? ` · ${v.cliente}` : ''}`}
                          </p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">
                            {`paga em ${diaEMes(v.primeiroPagamento)}, recebe em ${diaEMes(v.primeiroRecebimento)} — ${v.diasDeGap} ${v.diasDeGap === 1 ? 'dia' : 'dias'} de diferença`}
                          </p>
                        </div>
                        <span className="fin-t-body-strong shrink-0 tabular-nums text-[var(--fin-text)]">
                          {formatar(v.valorAdiantado)}
                        </span>
                        <button
                          type="button"
                          className="fin-t-caption shrink-0 text-[var(--fin-accent)] underline underline-offset-2"
                          onClick={() => abrirRecorte(`Venda ${v.numero}`, 'Contas a pagar desta venda', 'pagar', 'venda', 'valorEmAberto', v.vendaId)}
                        >
                          Ver contas
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── Clientes ────────────────────────────────────────────── */}
              <GraficoMoldura
                titulo="De quem a agência recebeu"
                sublinha="Só o dinheiro do cliente. A comissão de operadora fica fora: nessa conta o campo de cliente guarda o fornecedor."
                estado={dados.clientes.length === 0 ? 'sem-dado' : 'ok'}
                vazio={{ frase: 'Nenhum recebimento de cliente no período.' }}
                descricao="Clientes pelo valor recebido no período."
                tabela={{
                  colunas: ['Cliente', 'Recebido'],
                  linhas: dados.clientes.map(c => [c.nome, formatar(c.valor)]),
                }}
              >
                <BarrasNomeadas
                  linhas={linhas(dados.clientes)}
                  formatar={formatar}
                  onAtivar={id => abrirRecorte('Contas deste cliente', 'Em aberto', 'receber', 'contraparte', 'valorEmAberto', id)}
                />
              </GraficoMoldura>

              {/* ── Agenda ──────────────────────────────────────────────── */}
              {dados.agenda.length > 0 && (
                <section className={`${CARTAO} flex flex-col gap-2 p-[var(--fin-s-4)]`}>
                  <div>
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">Próximos movimentos</h2>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">
                      Trinta dias à frente, incluindo o que já venceu e ainda não se moveu.
                    </p>
                  </div>
                  <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {dados.agenda.slice(0, 12).map(l => (
                      <li key={`${l.lado}-${l.id}`} className="flex min-h-[44px] items-center gap-3 py-2">
                        <span className="fin-t-caption w-14 shrink-0 tabular-nums text-[var(--fin-text-3)]">
                          {diaEMes(l.data)}
                        </span>
                        {/* Sinal explícito à esquerda: cor sozinha não diz se o
                            dinheiro entra ou sai, e some na impressão. */}
                        <span
                          className={`fin-t-body-strong w-32 shrink-0 tabular-nums ${l.lado === 'receber' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]'}`}
                        >
                          {`${l.lado === 'receber' ? '+' : '−'} ${formatar(l.valor)}`}
                        </span>
                        <span className="fin-t-body min-w-0 flex-1 truncate text-[var(--fin-text-2)]">
                          {l.contraparte || l.descricao || (l.lado === 'receber' ? 'A receber' : 'A pagar')}
                        </span>
                        {l.vencido && (
                          <span className="fin-t-caption shrink-0 font-semibold text-[var(--fin-negative-text)]">
                            vencido
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {dados.agenda.length > 12 && (
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {`Mostrando 12 dos ${dados.agenda.length} lançamentos dos próximos 30 dias.`}
                    </p>
                  )}
                </section>
              )}

              {/* ── O que este painel NÃO mostra, e por quê ──────────────── */}
              <details className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
                <summary className="fin-t-body flex min-h-[44px] cursor-pointer items-center text-[var(--fin-text-2)]">
                  O que este painel ainda não mostra
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
                  <li className="fin-t-caption text-[var(--fin-text-2)]">
                    <strong className="text-[var(--fin-text)]">Orçado contra realizado.</strong> Não existe orçamento
                    financeiro conciliável no sistema, então não há contra o que comparar.
                  </li>
                  <li className="fin-t-caption text-[var(--fin-text-2)]">
                    <strong className="text-[var(--fin-text)]">Receita por categoria.</strong> Toda conta a receber
                    gerada por venda nasce sem categoria, então a divisão seria quase toda &quot;sem categoria&quot;.
                  </li>
                  <li className="fin-t-caption text-[var(--fin-text-2)]">
                    <strong className="text-[var(--fin-text)]">Saldo por banco e forma de pagamento.</strong> Os campos
                    existem, mas as telas de baixa não os gravam. O saldo TOTAL é confiável; a distribuição, não.
                  </li>
                  <li className="fin-t-caption text-[var(--fin-text-2)]">
                    <strong className="text-[var(--fin-text)]">Prazo médio de recebimento.</strong> A baixa grava sempre
                    a data de hoje, não a data em que o cliente pagou, então a média mediria o dia do lançamento.
                  </li>
                  <li className="fin-t-caption text-[var(--fin-text-2)]">
                    <strong className="text-[var(--fin-text)]">Comparação mês a mês fiel.</strong> A série é
                    reconstruída com o estado atual das contas: uma baixa lançada hoje com data retroativa muda o
                    passado do gráfico. Para um histórico fiel seria preciso guardar um retrato por mês.
                  </li>
                </ul>
              </details>

              <p className="fin-t-caption text-[var(--fin-text-3)]">
                {`Período de ${dataBR(janela.de)} a ${dataBR(janela.ate)}, comparado com ${dataBR(comparacao.de)} a ${dataBR(comparacao.ate)}. `}
                Entradas e saídas são pelo regime de caixa (a data da baixa); a receber e a pagar, pelo vencimento.
              </p>
            </>
          ) : null}
        </DataState>

        <GavetaDeLancamentos pedido={gaveta} onFechar={() => setGaveta(null)} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PrivacidadeProvider>
      <Painel />
    </PrivacidadeProvider>
  );
}
