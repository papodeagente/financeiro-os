'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowUpRight, BookOpen, CalendarClock, CalendarDays, ChartColumn, CircleCheck, Hourglass, Layers,
  LayoutDashboard, Lightbulb, OctagonAlert, Percent, RefreshCw, TrendingUp, TriangleAlert, Truck, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { DashboardFinanceiro } from '@/lib/dashboard-financeiro';
import type { LadoDoLancamento, RecorteDoDetalhe } from '@/lib/dashboard-detalhe';
import {
  calcularFatoresDeSaude, classificarSaude, gerarInsights, montarCascataDoResultado, type Insight,
} from '@/lib/dashboard-insights';
import { janelaDeComparacao } from '@/lib/periodo-financeiro';
import { cn } from '@/lib/utils';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { SerieFinanceira } from '@/components/fin/SerieFinanceira';
import { ProjecaoDeCaixa } from '@/components/fin/ProjecaoDeCaixa';
import { Cascata, type PassoDaCascata } from '@/components/fin/Cascata';
import { PainelDeSaude } from '@/components/fin/PainelDeSaude';
import { FiltroDePeriodo, usePeriodoDaUrl } from '@/components/fin/FiltroDePeriodo';
import { BotaoDePrivacidade, PrivacidadeProvider, usePrivacidade } from '@/components/fin/Privacidade';
import { GavetaDeLancamentos, type PedidoDeDetalhe } from '@/components/fin/GavetaDeLancamentos';
import {
  CabecaDoBloco, CARTAO_DS, CartaoDeNumero, ChipDoTom, FOCO, PILULA_DS, ROTULO_DS, suave, TituloDeSecao, TopoDoDs,
  corDoTom, type NumeroDoDs, type TomDoDs,
} from '@/components/ds/pecas';

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

const VEREDITO: Record<'bom' | 'atencao' | 'risco' | 'sem-base', { rotulo: string; icone: LucideIcon; tom: TomDoDs | null }> = {
  bom: { rotulo: 'Saudável', icone: CircleCheck, tom: 'success' },
  atencao: { rotulo: 'Atenção', icone: TriangleAlert, tom: 'warning' },
  risco: { rotulo: 'Risco', icone: OctagonAlert, tom: 'danger' },
  'sem-base': { rotulo: 'Sem base suficiente', icone: TriangleAlert, tom: null },
};

const TOM_DO_INSIGHT: Record<Insight['tom'], TomDoDs> = {
  critico: 'danger',
  atencao: 'warning',
  positivo: 'success',
  neutro: 'info',
};

const ICONE_DO_INSIGHT: Record<Insight['tom'], LucideIcon> = {
  critico: OctagonAlert,
  atencao: TriangleAlert,
  positivo: CircleCheck,
  neutro: Lightbulb,
};

const horaBR = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Painel() {
  const { formatar, formatarEixo } = usePrivacidade();
  const [janela, estadoDoPeriodo, trocarPeriodo] = usePeriodoDaUrl();
  const [dados, setDados] = useState<DashboardFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  // O status viaja junto da mensagem: 403 não é "tente de novo".
  const [erro, setErro] = useState<{ status: number; texto: string } | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [gaveta, setGaveta] = useState<PedidoDeDetalhe | null>(null);

  /** A busca em voo. Trocar de período rápido dispara duas, e sem cancelar a
   *  primeira a resposta lenta chega DEPOIS e sobrescreve a tela com números
   *  de outro período — sem erro nenhum, só com o painel mentindo. */
  const emVoo = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    emVoo.current?.abort();
    const controle = new AbortController();
    emVoo.current = controle;
    setCarregando(true);
    setErro(null);
    try {
      // A CHAVE viaja junto: é ela que diz ao servidor com o que comparar.
      const busca = new URLSearchParams({
        periodo: estadoDoPeriodo.chave,
        de: janela.de,
        ate: janela.ate,
      });
      const r = await fetch(`/api/dashboard?${busca}`, { signal: controle.signal });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        throw Object.assign(new Error(corpo.error || `Erro ${r.status}`), { status: r.status });
      }
      setDados(await r.json());
      setAtualizadoEm(new Date());
    } catch (e) {
      // Busca cancelada não é falha: é a resposta velha sendo descartada.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // A falha CHEGA à tela. Com a manchete em 44px, anunciar "R$ 0,00 em
      // caixa" durante uma queda é pior do que não desenhar nada.
      const status = (e as { status?: number })?.status ?? 0;
      setErro({ status, texto: e instanceof Error ? e.message : 'Não foi possível carregar' });
    } finally {
      if (emVoo.current === controle) setCarregando(false);
    }
  }, [janela.de, janela.ate, estadoDoPeriodo.chave]);

  useEffect(() => {
    carregar();
    return () => emVoo.current?.abort();
  }, [carregar]);

  // A janela de comparação vem do PAYLOAD, não de um recálculo aqui: se a
  // tela recalculasse, ela poderia rotular uma janela e o número vir de outra —
  // que é exatamente o defeito que acabou de ser corrigido na rota.
  const comparacao = useMemo(
    () => (dados ? { de: dados.periodo.deAnterior, ate: dados.periodo.ateAnterior } : janelaDeComparacao(janela)),
    [dados, janela],
  );
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
      // "Sem data" não é o prazo mais longo: é AUSÊNCIA de prazo. Tratá-lo
      // como o último degrau da rampa afirmaria que esse dinheiro entra depois
      // de tudo, quando a verdade é que ninguém sabe quando ele entra. Vai como
      // resto, que é o papel de "isto não é um par comparável".
      papel: (f.id === 'sem_data' ? 'resto' : 'seq') as 'resto' | 'seq',
      // O prazo é ORDINAL: os quatro degraus da rampa, do mais urgente ao mais
      // distante. Vencido NÃO ganha vermelho aqui — o vermelho da tela já é o
      // alarme de caixa negativo, e duas coisas vermelhas competem.
      indiceSeq: (Math.min(3, Math.floor((i / Math.max(1, faixas.length - 1)) * 3)) + 1) as 1 | 2 | 3 | 4,
    }));

  const linhas = (itens: Array<{ id: string; nome: string; valor: number }>): LinhaBarra[] =>
    itens.map(i => ({ id: i.id, nome: i.nome, valor: i.valor }));

  const passosDoResultado: PassoDaCascata[] = useMemo(
    () => (dados ? montarCascataDoResultado(dados, formatar) : []),
    [dados, formatar],
  );

  const temMovimento = Boolean(
    dados &&
      (dados.caixa.entradas.atual !== 0 ||
        dados.caixa.saidas.atual !== 0 ||
        dados.posicao.receber.emAberto > 0 ||
        dados.posicao.pagar.emAberto > 0 ||
        dados.vendas.quantidade > 0),
  );

  // Os quatro números do período, no cartão de número das Análises do CRM.
  const numeros: NumeroDoDs[] = dados
    ? [
        {
          chave: 'sobrou',
          rotulo: 'Sobrou em caixa',
          valor: formatar(dados.caixa.resultado.atual),
          negativo: dados.caixa.resultado.atual < 0,
          sub: 'entrou menos saiu, no período',
          tom: dados.caixa.resultado.atual < 0 ? 'danger' : 'brand',
          Icone: Wallet,
          variacao: { pct: dados.caixa.resultado.variacao, bom: (dados.caixa.resultado.variacao ?? 0) >= 0 },
          dicaDaVariacao: `${rotuloDaComparacao}: ${dataBR(comparacao.de)} a ${dataBR(comparacao.ate)}`,
        },
        {
          chave: 'receita',
          rotulo: 'Receita da agência',
          valor: formatar(dados.vendas.receitaAgencia),
          sub:
            dados.vendas.margemPct === null
              ? 'nenhuma venda no período'
              : `${PCT(dados.vendas.margemPct)} de ${formatar(dados.vendas.volume)} vendidos` +
                (dados.vendas.comissaoDeOperadora > 0
                  ? `, incluindo ${formatar(dados.vendas.comissaoDeOperadora)} de comissão de operadora`
                  : ''),
          tom: 'success',
          Icone: TrendingUp,
          // Venda sem custo gravado entra como margem de 100% e puxa o
          // percentual para cima sem que ninguém perceba. A tela avisa em vez
          // de afirmar.
          aviso:
            dados.vendas.semCusto > 0
              ? `${dados.vendas.semCusto} ${dados.vendas.semCusto === 1 ? 'venda está' : 'vendas estão'} sem custo lançado, então a margem aparece maior do que é`
              : undefined,
        },
        {
          chave: 'receber',
          rotulo: 'A receber',
          valor: formatar(dados.posicao.receber.emAberto),
          sub:
            dados.posicao.receber.vencido > 0
              ? `${formatar(dados.posicao.receber.vencido)} vencidos em ${dados.posicao.receber.contasVencidas} ${dados.posicao.receber.contasVencidas === 1 ? 'parcela' : 'parcelas'}`
              : `nada vencido, em ${dados.posicao.receber.contas} ${dados.posicao.receber.contas === 1 ? 'parcela' : 'parcelas'}`,
          tom: 'info',
          Icone: ArrowDownLeft,
          onAbrir: () => abrirRecorte('A receber em aberto', 'Tudo que ainda falta entrar', 'receber', 'em-aberto', 'valorEmAberto'),
        },
        {
          chave: 'pagar',
          rotulo: 'A pagar',
          valor: formatar(dados.posicao.pagar.emAberto),
          sub:
            dados.posicao.pagar.vencido > 0
              ? `${formatar(dados.posicao.pagar.vencido)} vencidos em ${dados.posicao.pagar.contasVencidas} ${dados.posicao.pagar.contasVencidas === 1 ? 'conta' : 'contas'}`
              : `nada vencido, em ${dados.posicao.pagar.contas} ${dados.posicao.pagar.contas === 1 ? 'conta' : 'contas'}`,
          tom: 'warning',
          Icone: ArrowUpRight,
          onAbrir: () => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto'),
        },
      ]
    : [];

  const vereditoDaTela = VEREDITO[veredito];
  const IconeDoVeredito = vereditoDaTela.icone;
  const corDoVeredito = vereditoDaTela.tom ? corDoTom(vereditoDaTela.tom) : 'var(--ds-text-muted)';

  return (
    <div className="ds ds-pagina min-h-full w-full">
      <div className="px-3 pb-8 pt-4 sm:px-5 sm:pt-5 lg:px-8 lg:pb-10 lg:pt-7">
        <div className="mx-auto w-full max-w-[1400px]">
          {/* ── Topo ──────────────────────────────────────────────────────── */}
          <TopoDoDs
            Icone={LayoutDashboard}
            titulo="Dashboard financeiro"
            sub={
              <>
                Visão geral da saúde financeira da sua agência ·{' '}
                <span className="font-medium lowercase text-[var(--ds-text-strong)]">{janela.rotulo}</span>
              </>
            }
          >
            <div className="fin-no-print flex items-center gap-2">
              {atualizadoEm ? (
                <span className="ds-num whitespace-nowrap text-[12px] text-[var(--ds-text-muted)]">
                  {`Atualizado às ${horaBR(atualizadoEm)}`}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => { carregar(); }}
                disabled={carregando}
                aria-label="Recarregar os números"
                title="Recarregar os números"
                className={cn(PILULA_DS, 'w-9 justify-center px-0 disabled:opacity-60')}
              >
                <RefreshCw className={cn('h-[15px] w-[15px]', carregando && 'animate-spin')} aria-hidden="true" />
              </button>
            </div>
          </TopoDoDs>

          {/* ── Barra de filtros ──────────────────────────────────────────── */}
          <div className={cn(CARTAO_DS, 'fin-no-print mt-[22px] flex flex-col gap-2.5 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center')}>
            <span className={cn(ROTULO_DS, 'inline-flex items-center gap-1.5 px-1 text-[var(--ds-text-muted)]')}>
              <CalendarDays className="h-[13px] w-[13px]" aria-hidden="true" />
              Período
            </span>
            <div className="ds-periodo min-w-0">
              <FiltroDePeriodo janela={janela} estado={estadoDoPeriodo} onChange={trocarPeriodo} />
            </div>
            <span className="hidden flex-1 sm:block" />
            <BotaoDePrivacidade className={PILULA_DS} />
          </div>

          {/* 403 é decisão de permissão, não falha de rede: oferecer "tentar de
              novo" ali manda a pessoa bater na mesma porta para sempre. */}
          {erro?.status === 403 ? (
            <div className={cn(CARTAO_DS, 'mt-3.5 p-[22px]')} role="alert">
              <CabecaDoBloco
                tom="warning"
                Icone={TriangleAlert}
                titulo="Seu perfil não tem acesso ao financeiro"
                sub="Este painel mostra saldo em caixa, margem e posição de fornecedor. Peça a quem administra a conta para liberar o acesso ao financeiro do seu usuário."
              />
            </div>
          ) : (
          <DataState
            className="flex flex-col"
            estado={carregando && !dados ? 'carregando' : erro ? 'erro' : 'ok'}
            erro={
              erro
                ? {
                    mensagem: `Não foi possível carregar os dados de ${dataBR(janela.de)} a ${dataBR(janela.ate)}. Nada foi alterado.`,
                    onTentarDeNovo: () => { carregar(); },
                  }
                : null
            }
            esqueleto={
              <div className="mt-[26px] flex flex-col gap-3.5" aria-hidden>
                <div className={cn(CARTAO_DS, 'h-[300px] animate-pulse')} />
                <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className={cn(CARTAO_DS, 'h-[170px] animate-pulse')} />
                  ))}
                </div>
              </div>
            }
          >
            {dados && !temMovimento ? (
              <div className={cn(CARTAO_DS, 'mt-[26px] p-[22px]')}>
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
                {/* ══ NÍVEL 1 — O QUE ESTÁ ACONTECENDO ═════════════════════ */}
                <TituloDeSecao primeira>Caixa</TituloDeSecao>
                {/* A manchete da tela (uma só): no design system ela é este bloco, não a <Resposta> do FIN. */}
                <section data-ds-resposta="" aria-labelledby="dash-caixa" className={cn(CARTAO_DS, 'flex min-w-0 flex-col p-[22px]')}>
                  <CabecaDoBloco
                    id="dash-caixa"
                    tom="brand"
                    Icone={Wallet}
                    titulo="Em caixa hoje"
                    sub="O saldo vem do histórico de baixas, não do valor guardado em cada conta."
                  >
                    <span
                      className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium"
                      style={{ background: suave(corDoVeredito, 0.12), color: corDoVeredito }}
                    >
                      <IconeDoVeredito className="h-3.5 w-3.5" aria-hidden="true" />
                      {vereditoDaTela.rotulo}
                    </span>
                  </CabecaDoBloco>

                  <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
                    <div className="flex min-w-0 flex-col gap-2 lg:w-[340px] lg:shrink-0">
                      <p
                        className={cn(
                          'ds-num text-[40px] font-medium leading-[1.02] tracking-[-0.03em] sm:text-[52px]',
                          dados.caixa.saldo < 0 ? 'text-[var(--ds-danger-ink)]' : 'text-[var(--ds-text-strong)]',
                        )}
                      >
                        {formatar(dados.caixa.saldo)}
                      </p>
                      <p className="text-[13px] leading-[1.5] text-[var(--ds-text-body)]">
                        {`No período entraram ${formatar(dados.caixa.entradas.atual)} e saíram ${formatar(dados.caixa.saidas.atual)}` +
                          (dados.caixa.repasses > 0
                            ? `, dos quais ${formatar(dados.caixa.repasses)} foram repasse a fornecedores.`
                            : '.') +
                          (dados.caixa.resultado.atual < 0
                            ? ` Faltaram ${formatar(Math.abs(dados.caixa.resultado.atual))} no caixa.`
                            : dados.caixa.resultado.atual === 0
                              ? ' O período fechou empatado.'
                              : ` Sobraram ${formatar(dados.caixa.resultado.atual)} no caixa.`)}
                      </p>
                      <p className="text-[12px] text-[var(--ds-text-muted)]">
                        A projeção é aritmética do que já está lançado, não previsão.
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <ProjecaoDeCaixa
                        saldoHoje={dados.caixa.saldo}
                        dataDeHoje={dados.periodo.hoje}
                        pontos={dados.projecao}
                        formatar={formatar}
                        formatarEixo={formatarEixo}
                        altura={180}
                        onAtivar={() => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto')}
                      />
                    </div>
                  </div>
                </section>

                <TituloDeSecao extra={`${dataBR(janela.de)} a ${dataBR(janela.ate)}`}>Resultado do período</TituloDeSecao>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  {numeros.map(n => <CartaoDeNumero key={n.chave} n={n} />)}
                </div>

                <TituloDeSecao>Como está a agência</TituloDeSecao>
                <PainelDeSaude fatores={fatores} aparencia="ds" />

                {/* ══ NÍVEL 3 — O QUE PRECISA SER FEITO (vem cedo de propósito) */}
                {insights.length > 0 && (
                  <>
                    <TituloDeSecao extra={insights.length > 6 ? `6 de ${insights.length}` : insights.length}>
                      Precisa da sua atenção
                    </TituloDeSecao>
                    <ul className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
                      {insights.slice(0, 6).map(i => {
                        const tom = TOM_DO_INSIGHT[i.tom];
                        return (
                          <li
                            key={i.id}
                            className={cn(CARTAO_DS, 'flex items-start gap-3 p-4')}
                            style={{ borderColor: suave(corDoTom(tom), 0.3) }}
                          >
                            <ChipDoTom tom={tom} Icone={ICONE_DO_INSIGHT[i.tom]} tamanho={32} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] text-[var(--ds-text-strong)]">{i.texto}</p>
                              {/* A evidência é o que permite conferir. Insight sem
                                  número para checar é opinião. */}
                              {i.evidencia && (
                                <p className="ds-num mt-0.5 text-[12px] text-[var(--ds-text-muted)]">{i.evidencia}</p>
                              )}
                            </div>
                            {i.acao && (
                              <Link href={i.acao.href} className={cn(PILULA_DS, 'self-center')}>
                                {i.acao.rotulo}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                {/* ══ NÍVEL 2 — POR QUE ESTÁ ACONTECENDO ═══════════════════ */}
                <TituloDeSecao>Por que está acontecendo</TituloDeSecao>
                <div className="flex flex-col gap-3.5">
                  <GraficoMoldura
                    aparencia="ds"
                    icone={ChartColumn}
                    tom="brand"
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
                      formatarEixo={formatarEixo}
                      altura={240}
                      destaque={dados.serie.length - 1}
                    />
                  </GraficoMoldura>

                  <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                    <GraficoMoldura
                      aparencia="ds"
                      icone={Layers}
                      tom="success"
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

                    {/* ── Aging dos dois lados, em escala comum ─────────────── */}
                    <GraficoMoldura
                      aparencia="ds"
                      icone={CalendarClock}
                      tom="warning"
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
                      <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                          <p className="flex items-baseline justify-between gap-3">
                            <span className={cn(ROTULO_DS, 'text-[var(--ds-text-muted)]')}>A receber</span>
                            <span className="ds-num text-[15px] font-medium text-[var(--ds-text-strong)]">{formatar(dados.posicao.receber.emAberto)}</span>
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
                                // A FAIXA, não o balde inteiro: o título promete a
                                // faixa clicada e a lista tem que entregá-la.
                                'aging',
                                'valorEmAberto',
                                id,
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <p className="flex items-baseline justify-between gap-3">
                            <span className={cn(ROTULO_DS, 'text-[var(--ds-text-muted)]')}>A pagar</span>
                            <span className="ds-num text-[15px] font-medium text-[var(--ds-text-strong)]">{formatar(dados.posicao.pagar.emAberto)}</span>
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
                                'aging',
                                'valorEmAberto',
                                id,
                              )
                            }
                          />
                        </div>
                      </div>
                    </GraficoMoldura>
                  </div>
                </div>

                {/* ── Composições ──────────────────────────────────────────── */}
                <TituloDeSecao>De onde vem e para onde vai</TituloDeSecao>
                <div className="flex flex-col gap-3.5">
                  <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                    <GraficoMoldura
                      aparencia="ds"
                      icone={ArrowDownLeft}
                      tom="success"
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
                      aparencia="ds"
                      icone={ArrowUpRight}
                      tom="danger"
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
                  <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                    <GraficoMoldura
                      aparencia="ds"
                      icone={Truck}
                      tom="brand"
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
                      aparencia="ds"
                      icone={Percent}
                      tom="success"
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

                  {/* ── O aperto que só existe em agência de viagens ──────────── */}
                  {dados.descasamento.length > 0 && (
                    <section aria-labelledby="dash-descasamento" className={cn(CARTAO_DS, 'p-[22px]')}>
                      <CabecaDoBloco
                        id="dash-descasamento"
                        tom="danger"
                        Icone={Hourglass}
                        titulo="O fornecedor vence antes de o cliente pagar"
                        sub="Nestas vendas o dinheiro sai antes de entrar, e a diferença sai do caixa da agência."
                      />
                      <ul className="mt-4 flex flex-col">
                        {dados.descasamento.map(v => (
                          <li
                            key={v.vendaId}
                            className="flex min-h-[44px] flex-wrap items-center gap-3 border-t border-[var(--ds-border-subtle)] py-3 first:border-t-0"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] font-medium text-[var(--ds-text-strong)]">
                                {`Venda ${v.numero}${v.cliente ? ` · ${v.cliente}` : ''}`}
                              </p>
                              <p className="text-[12px] text-[var(--ds-text-muted)]">
                                {`paga em ${diaEMes(v.primeiroPagamento)}, recebe em ${diaEMes(v.primeiroRecebimento)} — ${v.diasDeGap} ${v.diasDeGap === 1 ? 'dia' : 'dias'} de diferença`}
                              </p>
                            </div>
                            <span className="ds-num shrink-0 text-[14px] font-medium text-[var(--ds-text-strong)]">
                              {formatar(v.exposicao)}
                            </span>
                            <button
                              type="button"
                              className={PILULA_DS}
                              onClick={() => abrirRecorte(`Venda ${v.numero}`, 'Contas a pagar desta venda', 'pagar', 'venda', 'valorEmAberto', v.vendaId)}
                            >
                              Ver contas
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* ── Clientes e agenda ────────────────────────────────────── */}
                  <div className={cn('grid grid-cols-1 gap-3.5', dados.agenda.linhas.length > 0 && 'xl:grid-cols-2')}>
                    <GraficoMoldura
                      aparencia="ds"
                      icone={Users}
                      tom="info"
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

                    {dados.agenda.linhas.length > 0 && (
                      <section aria-labelledby="dash-agenda" className={cn(CARTAO_DS, 'flex min-w-0 flex-col p-[22px]')}>
                        <CabecaDoBloco
                          id="dash-agenda"
                          tom="brand"
                          Icone={CalendarDays}
                          titulo="Próximos movimentos"
                          sub="Trinta dias à frente, incluindo o que já venceu e ainda não se moveu."
                        />
                        <ul className="mt-4 flex flex-col">
                          {dados.agenda.linhas.slice(0, 12).map(l => (
                            <li
                              key={`${l.lado}-${l.id}`}
                              className="flex min-h-[44px] items-center gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0"
                            >
                              <span className="ds-num w-12 shrink-0 text-[12px] text-[var(--ds-text-muted)]">
                                {diaEMes(l.data)}
                              </span>
                              {/* Sinal explícito à esquerda: cor sozinha não diz se o
                                  dinheiro entra ou sai, e some na impressão. */}
                              <span
                                className={cn(
                                  'ds-num w-32 shrink-0 text-[13.5px] font-medium',
                                  l.lado === 'receber' ? 'text-[var(--ds-success-ink)]' : 'text-[var(--ds-text-strong)]',
                                )}
                              >
                                {`${l.lado === 'receber' ? '+' : '−'} ${formatar(l.valor)}`}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-text-body)]">
                                {l.contraparte || l.descricao || (l.lado === 'receber' ? 'A receber' : 'A pagar')}
                              </span>
                              {l.vencido && (
                                <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-[var(--ds-danger-soft)] px-2 text-[11px] font-medium text-[var(--ds-danger-ink)]">
                                  vencido
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {dados.agenda.total > 12 && (
                          <p className="mt-2 text-[12px] text-[var(--ds-text-muted)]">
                            {`Mostrando 12 dos ${dados.agenda.total} lançamentos dos próximos 30 dias.`}
                          </p>
                        )}
                      </section>
                    )}
                  </div>
                </div>

                {/* ── O que este painel NÃO mostra, e por quê ─────────────────── */}
                <details className={cn(CARTAO_DS, 'group mt-[34px] px-[22px] py-1')}>
                  <summary className={cn('flex min-h-[52px] cursor-pointer list-none items-center gap-3 rounded-[16px]', FOCO)}>
                    <ChipDoTom tom="info" Icone={BookOpen} tamanho={30} />
                    <span className="flex-1 text-[14px] font-medium text-[var(--ds-text-strong)]">O que este painel ainda não mostra</span>
                    <span className="text-[12px] text-[var(--ds-text-muted)] group-open:hidden">abrir</span>
                    <span className="hidden text-[12px] text-[var(--ds-text-muted)] group-open:inline">fechar</span>
                  </summary>
                  <ul className="mb-4 mt-1 flex list-disc flex-col gap-2 pl-[54px] text-[12.5px] text-[var(--ds-text-body)]">
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Orçado contra realizado.</strong> Não existe orçamento
                      financeiro conciliável no sistema, então não há contra o que comparar.
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Receita por categoria.</strong> Toda conta a receber
                      gerada por venda nasce sem categoria, então a divisão seria quase toda &quot;sem categoria&quot;.
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Saldo por banco e forma de pagamento.</strong> Os campos
                      existem, mas as telas de baixa não os gravam. O saldo TOTAL é confiável; a distribuição, não.
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Prazo médio de recebimento.</strong> A baixa grava sempre
                      a data de hoje, não a data em que o cliente pagou, então a média mediria o dia do lançamento.
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Um número pode diferir do DRE.</strong> Este painel
                      conta só a venda CONFIRMADA ou concluída; o DRE conta toda venda que não foi cancelada,
                      inclusive orçamento e reserva que já geraram contas. Quando os dois divergirem, o número
                      daqui é o do que foi de fato vendido.
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--ds-text-strong)]">Comparação mês a mês fiel.</strong> A série é
                      reconstruída com o estado atual das contas: uma baixa lançada hoje com data retroativa muda o
                      passado do gráfico. Para um histórico fiel seria preciso guardar um retrato por mês.
                    </li>
                  </ul>
                </details>

                <p className="mt-3.5 text-[12px] text-[var(--ds-text-muted)]">
                  {`Período de ${dataBR(janela.de)} a ${dataBR(janela.ate)}, comparado com ${dataBR(comparacao.de)} a ${dataBR(comparacao.ate)}. `}
                  Entradas e saídas são pelo regime de caixa (a data da baixa); a receber e a pagar, pelo vencimento.
                </p>
              </>
            ) : null}
          </DataState>
          )}

          <GavetaDeLancamentos pedido={gaveta} onFechar={() => setGaveta(null)} />
        </div>
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
