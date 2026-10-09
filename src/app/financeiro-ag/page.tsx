'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, CircleCheck, ClockAlert, GitCompareArrows, Plus,
  TrendingDown, TrendingUp, TriangleAlert, UserRoundX, Plug,
} from 'lucide-react';

import type { ContaBancaria, ContaPagar, ContaReceber } from '@/lib/crm-types';
import { hojeISO, round2 } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';
import {
  agendaDosProximosDias, diaMes, hojePorExtenso, mesAteHoje, pendencias, posicaoDeHoje, rotuloDoGrupo,
  type GrupoDaAgenda, type LinhaDaAgenda, type Pendencia,
} from '@/lib/visao-geral';

import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import { BaixaDeReceber } from './receber/BaixaDeReceber';
import { BaixaDePagar } from './pagar/BaixaDePagar';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const LINK = 'inline-flex items-center gap-1 fin-t-caption font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline';
/** Quantas linhas a agenda mostra antes de mandar para a tela de contas. */
const LINHAS_NA_AGENDA = 12;

type Filtro = 'todas' | 'receber' | 'pagar';

interface Dados {
  receber: ContaReceber[];
  pagar: ContaPagar[];
  contasBancarias: ContaBancaria[];
  extratoPendente: Array<{ conta_bancaria_id?: string; data?: string }>;
  plataformasParaConferir: number;
}

async function lista<T>(url: string): Promise<T[]> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erro ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? (j as T[]) : [];
}

function Indicador({
  rotulo, valor, destaque = false, chip, texto, link,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
  chip?: { tom: 'aviso' | 'ok' | 'neutro'; icone: typeof CircleCheck; texto: string } | null;
  texto: string;
  link: { href: string; rotulo: string };
}) {
  const Icone = chip?.icone;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-[var(--fin-s-5)] py-[var(--fin-s-5)]">
      <span className="fin-t-overline text-[var(--fin-text-3)]">{rotulo}</span>
      <span className={cn('tabular-nums text-[var(--fin-text)]', destaque ? 'fin-t-metric' : 'fin-t-metric-sm', valor < 0 && 'text-[var(--fin-negative-text)]')}>
        {formatBRL(valor)}
      </span>
      {chip && Icone ? (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-[var(--fin-r-sm)] px-2 py-0.5 fin-t-caption font-medium',
            chip.tom === 'aviso' && 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
            chip.tom === 'ok' && 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
            chip.tom === 'neutro' && 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
          )}
        >
          <Icone aria-hidden="true" className="size-3.5" />
          {chip.texto}
        </span>
      ) : null}
      <span className="fin-t-caption text-[var(--fin-text-2)]">{texto}</span>
      <Link href={link.href} className={cn(LINK, 'mt-auto pt-1')}>
        {link.rotulo}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

function LinhaDaAgendaView({ l, onAgir }: { l: LinhaDaAgenda; onAgir: (l: LinhaDaAgenda) => void }) {
  const entrada = l.lado === 'receber';
  const sub = l.atraso
    ? <span className="block truncate fin-t-caption font-medium text-[var(--fin-negative-text)]">{[l.atraso, l.detalhe].filter(Boolean).join(' · ')}</span>
    : l.semFornecedor
      ? <span className="block truncate fin-t-caption font-medium text-[var(--fin-warning-text)]">informe o fornecedor antes de pagar</span>
      : <span className="block truncate fin-t-caption text-[var(--fin-text-3)]">{l.detalhe || (entrada ? 'Conta a receber' : 'Conta a pagar')}</span>;
  return (
    <li
      className={cn(
        'grid items-center gap-x-[var(--fin-s-3)] gap-y-1.5 border-t border-[var(--fin-border)] px-[var(--fin-s-5)] py-2.5',
        'grid-cols-[3.5rem_minmax(0,1fr)_auto]',
        'md:grid-cols-[4rem_minmax(0,1fr)_auto_8rem_6.5rem] md:gap-x-[var(--fin-s-4)]',
      )}
    >
      <span className="flex flex-col leading-tight">
        <span className="fin-t-caption text-[var(--fin-text-3)]">{l.diaDaSemana}</span>
        <span className="fin-t-body font-medium tabular-nums text-[var(--fin-text)]">{diaMes(l.vencimento)}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate fin-t-body font-medium text-[var(--fin-text)]">{l.quem}</span>
        {sub}
      </span>
      <span className="hidden whitespace-nowrap md:inline">
        {l.origem ? (
          <span className="inline-flex items-center gap-1 rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] px-1.5 py-px fin-t-caption font-medium text-[var(--fin-text-2)]">
            {l.origem.startsWith('via ') ? <Plug aria-hidden="true" className="size-3" /> : null}
            {l.origem}
          </span>
        ) : null}
      </span>
      <span className={cn('text-right fin-t-body-strong tabular-nums', entrada ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]')}>
        {entrada ? '+' : '−'}{formatBRL(l.valor)}
      </span>
      <span className="col-start-2 md:col-start-auto md:justify-self-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAgir(l)}
          aria-label={`${l.acao}: ${l.quem}, ${formatBRL(l.valor)}`}
          className="h-9 px-3 md:h-8"
        >
          {l.acao}
        </Button>
      </span>
    </li>
  );
}

const ICONE_PENDENCIA: Record<Pendencia['chave'], typeof ClockAlert> = {
  'receber-vencido': ClockAlert,
  'pagar-vencido': ClockAlert,
  extrato: GitCompareArrows,
  'sem-fornecedor': UserRoundX,
  plataformas: Plug,
};

/**
 * Visão geral do Financeiro (protótipo aprovado em 08/10/2026).
 *
 * Os números vêm de src/lib/visao-geral.ts, com as mesmas regras do saldo e
 * das contas. Receber, cobrar e pagar abrem o MESMO diálogo de baixa das
 * telas de contas (BaixaDeReceber, BaixaDePagar): não existe um segundo
 * caminho de baixa.
 */
export default function FinanceiroVisaoGeralPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [receberAlvo, setReceberAlvo] = useState<ContaReceber | null>(null);
  const [pagarAlvo, setPagarAlvo] = useState<ContaPagar | null>(null);
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    try {
      const [receber, pagar, contasBancarias, extrato, plataformas] = await Promise.all([
        lista<ContaReceber>('/api/contas-receber'),
        lista<ContaPagar>('/api/contas-pagar'),
        lista<ContaBancaria>('/api/contas-bancarias').catch(() => []),
        // As duas consultas abaixo só alimentam "Precisa de você": falhar
        // nelas não pode derrubar a tela.
        lista<Record<string, unknown>>('/api/extrato-bancario').catch(() => []),
        fetch(`/api/plataformas/recebimentos?status=SUGERIDA&de=2000-01-01&ate=${hojeISO()}`)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setDados({
        receber,
        pagar,
        contasBancarias,
        extratoPendente: extrato
          .filter(l => String(l.status_conciliacao ?? '') === 'PENDENTE')
          .map(l => ({ conta_bancaria_id: String(l.conta_bancaria_id ?? ''), data: String(l.data ?? '') })),
        plataformasParaConferir: Array.isArray(plataformas?.itens) ? plataformas.itens.length : 0,
      });
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta não respondeu. Nenhum número é mostrado enquanto os dados não chegarem.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const posicao = useMemo(
    () => (dados ? posicaoDeHoje({ contasBancarias: dados.contasBancarias, receber: dados.receber, pagar: dados.pagar, hoje }) : null),
    [dados, hoje],
  );
  const agenda = useMemo(() => (dados ? agendaDosProximosDias({ receber: dados.receber, pagar: dados.pagar, hoje }) : null), [dados, hoje]);
  const fila = useMemo(() => (dados ? pendencias({
    receber: dados.receber,
    pagar: dados.pagar,
    hoje,
    formatar: formatBRL,
    extratoPendente: dados.extratoPendente,
    nomesDasContas: Object.fromEntries(dados.contasBancarias.map(c => [c.id, c.nome])),
    plataformasParaConferir: dados.plataformasParaConferir,
  }) : []), [dados, hoje]);
  const mes = useMemo(() => (dados ? mesAteHoje(dados.receber, dados.pagar, hoje) : null), [dados, hoje]);

  const visiveis = useMemo(
    () => (agenda ? agenda.linhas.filter(l => filtro === 'todas' || l.lado === filtro) : []),
    [agenda, filtro],
  );
  const mostradas = visiveis.slice(0, LINHAS_NA_AGENDA);

  function agir(l: LinhaDaAgenda) {
    if (!dados) return;
    if (l.lado === 'receber') setReceberAlvo(dados.receber.find(c => c.id === l.id) ?? null);
    else setPagarAlvo(dados.pagar.find(c => c.id === l.id) ?? null);
  }

  const vazio = dados && dados.receber.length === 0 && dados.pagar.length === 0 && dados.contasBancarias.length === 0;

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Financeiro"
        subtitulo={`${hojePorExtenso(hoje)}. O que entra, o que sai e o que precisa de você.`}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Conciliar extrato', href: '/financeiro-ag/conciliacao' }]}
        acaoPrimaria={{
          rotulo: 'Lançar conta',
          icone: Plus,
          menu: [
            { rotulo: 'Venda', descricao: 'Serviços, fornecedores e a margem de cada um', icone: ArrowDownLeft, href: '/financeiro-ag/receber?nova=1' },
            { rotulo: 'Conta a pagar', descricao: 'Despesa ou acerto de fornecedor', icone: ArrowUpRight, href: '/financeiro-ag/pagar?nova=1' },
            { rotulo: 'Outro recebimento', descricao: 'Reembolso, acerto, o que não é venda', icone: Plus, href: '/financeiro-ag/receber?nova=outro' },
            { rotulo: 'Transferência', descricao: 'Entre duas contas da agência', icone: ArrowLeftRight, href: '/financeiro-ag/transferencias?nova=1' },
          ],
        }}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className={cn(CARTAO, 'h-[184px] animate-pulse')} />
            <div className="grid gap-[var(--fin-s-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className={cn(CARTAO, 'h-[480px] animate-pulse')} />
              <div className={cn(CARTAO, 'h-[320px] animate-pulse')} />
            </div>
          </div>
        }
      >
        {vazio ? (
          <section className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-6)]')}>
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Comece pelo caixa</h2>
            <p className="fin-t-body text-[var(--fin-text-2)]">
              Cadastre a conta bancária com o saldo de hoje. Depois, cada recebimento e cada pagamento lançado aparece aqui.
            </p>
            <div className="flex flex-wrap gap-[var(--fin-s-2)]">
              <Button variant="default" nativeButton={false} render={<Link href="/financeiro-ag/contas-bancarias" />}>Cadastrar conta bancária</Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/financeiro-ag/receber?nova=1" />}>Lançar conta a receber</Button>
            </div>
          </section>
        ) : posicao && agenda && mes ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {/* ── Posição de hoje ───────────────────────────────────────── */}
            <section
              aria-label="Posição de hoje"
              className={cn(
                CARTAO,
                'grid grid-cols-1 divide-y divide-[var(--fin-border)]',
                'md:grid-cols-2 md:divide-y-0 md:[&>*:nth-child(n+3)]:border-t md:[&>*:nth-child(even)]:border-l md:[&>*]:border-[var(--fin-border)]',
                'xl:grid-cols-[1.35fr_1fr_1fr_1fr] xl:[&>*:nth-child(n+3)]:border-t-0 xl:[&>*+*]:border-l',
              )}
            >
              <Indicador
                rotulo="Em caixa hoje"
                valor={posicao.emCaixa}
                destaque
                texto="Soma das contas bancárias, pelas baixas lançadas."
                link={{ href: '/financeiro-ag/contas-bancarias', rotulo: 'Ver contas bancárias' }}
              />
              <Indicador
                rotulo="A receber"
                valor={posicao.aReceber.total}
                chip={posicao.aReceber.vencido > 0
                  ? { tom: 'aviso', icone: TriangleAlert, texto: `${formatBRL(posicao.aReceber.vencido)} vencidos` }
                  : { tom: 'ok', icone: CircleCheck, texto: 'Nada vencido' }}
                texto={`${posicao.aReceber.parcelas} ${posicao.aReceber.parcelas === 1 ? 'parcela em aberto' : 'parcelas em aberto'}`}
                link={{ href: '/financeiro-ag/receber', rotulo: 'Contas a receber' }}
              />
              <Indicador
                rotulo="A pagar"
                valor={posicao.aPagar.total}
                chip={posicao.aPagar.vencido > 0
                  ? { tom: 'aviso', icone: TriangleAlert, texto: `${formatBRL(posicao.aPagar.vencido)} vencidos` }
                  : { tom: 'ok', icone: CircleCheck, texto: 'Nada vencido' }}
                texto={posicao.aPagar.contas === 0
                  ? 'Nenhuma conta em aberto'
                  : `${posicao.aPagar.contas} ${posicao.aPagar.contas === 1 ? 'conta em aberto' : 'contas em aberto'}${posicao.aPagar.proximoVencimento ? `, a próxima vence em ${diaMes(posicao.aPagar.proximoVencimento)}` : ''}`}
                link={{ href: '/financeiro-ag/pagar', rotulo: 'Contas a pagar' }}
              />
              <Indicador
                rotulo={`Caixa previsto em ${diaMes(posicao.previsto.data)}`}
                valor={posicao.previsto.valor}
                chip={{
                  tom: 'neutro',
                  icone: posicao.previsto.variacao < 0 ? TrendingDown : TrendingUp,
                  texto: `${posicao.previsto.variacao < 0 ? '−' : '+'}${formatBRL(Math.abs(posicao.previsto.variacao))} em 30 dias`,
                }}
                texto="Caixa de hoje mais o que está lançado para os próximos 30 dias. Soma, não previsão."
                link={{ href: '/financeiro-ag/fluxo-caixa', rotulo: 'Fluxo de caixa' }}
              />
            </section>

            <div className="grid items-start gap-[var(--fin-s-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
              {/* ── Próximos 30 dias ─────────────────────────────────────── */}
              <section aria-labelledby="t-agenda" className={cn(CARTAO, 'overflow-hidden')}>
                <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] px-[var(--fin-s-5)] pb-[var(--fin-s-3)] pt-[var(--fin-s-4)]">
                  <div className="flex flex-col">
                    <h2 id="t-agenda" className="fin-t-subhead text-[var(--fin-text)]">Próximos 30 dias</h2>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">Pela data de vencimento, com o que já venceu e não se moveu no topo.</span>
                  </div>
                  <Segmentado<Filtro>
                    rotulo="Mostrar"
                    valor={filtro}
                    onChange={setFiltro}
                    opcoes={[
                      { valor: 'todas', rotulo: 'Tudo', contagem: agenda.quantidade.todas },
                      { valor: 'receber', rotulo: 'Entradas', contagem: agenda.quantidade.receber },
                      { valor: 'pagar', rotulo: 'Saídas', contagem: agenda.quantidade.pagar },
                    ]}
                  />
                </div>

                <div className="flex flex-wrap gap-x-[var(--fin-s-6)] gap-y-1 border-b border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-5)] py-[var(--fin-s-3)] fin-t-body text-[var(--fin-text-2)]">
                  {filtro !== 'pagar' ? (
                    <span>Entram <b className="font-semibold tabular-nums text-[var(--fin-positive)]">{formatBRL(agenda.entradas)}</b></span>
                  ) : null}
                  {filtro !== 'receber' ? (
                    <span>Saem <b className="font-semibold tabular-nums text-[var(--fin-text)]">−{formatBRL(agenda.saidas)}</b></span>
                  ) : null}
                  {filtro === 'todas' ? (
                    <span>Caixa em {diaMes(agenda.ate)} <b className="font-semibold tabular-nums text-[var(--fin-text)]">{formatBRL(posicao.previsto.valor)}</b></span>
                  ) : null}
                </div>

                {mostradas.length === 0 ? (
                  <p className="px-[var(--fin-s-5)] py-[var(--fin-s-6)] text-center fin-t-body text-[var(--fin-text-2)]">
                    Nada vence nos próximos 30 dias{filtro === 'receber' ? ' para receber' : filtro === 'pagar' ? ' para pagar' : ''}.
                  </p>
                ) : (
                  <div>
                    {(['vencido', 'semana', 'proxima', 'depois'] as GrupoDaAgenda[]).map(g => {
                      const doGrupo = mostradas.filter(l => l.grupo === g);
                      if (doGrupo.length === 0) return null;
                      const subtotal = round2(visiveis.filter(l => l.grupo === g).reduce((s, l) => s + (l.lado === 'pagar' ? -l.valor : l.valor), 0));
                      return (
                        <section key={g} aria-label={rotuloDoGrupo(g, agenda.ate)}>
                          <div className="flex items-center justify-between px-[var(--fin-s-5)] pb-1.5 pt-[var(--fin-s-4)]">
                            <span className={cn('fin-t-overline', g === 'vencido' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')}>
                              {rotuloDoGrupo(g, agenda.ate)}
                            </span>
                            <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
                              {subtotal < 0 ? '−' : ''}{formatBRL(Math.abs(subtotal))}
                            </span>
                          </div>
                          <ul className="[&>li:first-child]:border-t-0">
                            {doGrupo.map(l => <LinhaDaAgendaView key={`${l.lado}-${l.id}`} l={l} onAgir={agir} />)}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-3)]">
                  <span>
                    Mostrando {mostradas.length} de {visiveis.length} {visiveis.length === 1 ? 'conta' : 'contas'} dos próximos 30 dias
                  </span>
                  <Link
                    href={filtro === 'pagar' ? '/financeiro-ag/pagar' : filtro === 'receber' ? '/financeiro-ag/receber' : '/financeiro-ag/fluxo-caixa'}
                    className={LINK}
                  >
                    {filtro === 'todas' ? 'Ver no fluxo de caixa' : 'Ver todas as contas'}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </div>
              </section>

              <div className="flex flex-col gap-[var(--fin-s-5)]">
                {/* ── Precisa de você ────────────────────────────────────── */}
                <section aria-labelledby="t-fila" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)]')}>
                  <div>
                    <h2 id="t-fila" className="fin-t-subhead text-[var(--fin-text)]">Precisa de você</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {fila.length === 0
                        ? 'Nada pendente agora.'
                        : `${fila.length} ${fila.length === 1 ? 'pendência' : 'pendências'}. Cada uma leva direto para onde se resolve.`}
                    </p>
                  </div>
                  {fila.length === 0 ? (
                    <p className="flex items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-positive-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-3)] fin-t-body text-[var(--fin-positive)]">
                      <CircleCheck aria-hidden="true" className="size-4" />
                      Tudo em dia: nada vencido, nada a conciliar.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-[var(--fin-s-2)]">
                      {fila.map(p => {
                        const Icone = ICONE_PENDENCIA[p.chave];
                        return (
                          <li key={p.chave} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
                            <span
                              aria-hidden="true"
                              className={cn(
                                'flex size-8 items-center justify-center rounded-[var(--fin-r-md)]',
                                p.tom === 'negativo' && 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
                                p.tom === 'aviso' && 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
                                p.tom === 'info' && 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
                              )}
                            >
                              <Icone className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block fin-t-body font-medium text-[var(--fin-text)]">{p.titulo}</span>
                              <span className="block fin-t-caption tabular-nums text-[var(--fin-text-3)]">{p.detalhe}</span>
                            </span>
                            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={p.href} />} className="h-9 px-3 md:h-8">
                              {p.acao}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* ── O mês até hoje ─────────────────────────────────────── */}
                <section aria-labelledby="t-mes" className={cn(CARTAO, 'flex flex-col p-[var(--fin-s-5)]')}>
                  <h2 id="t-mes" className="fin-t-subhead text-[var(--fin-text)]">
                    {mes.nomeDoMes.charAt(0).toUpperCase() + mes.nomeDoMes.slice(1)} até hoje
                  </h2>
                  <p className="mb-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-3)]">Pela data da baixa: o que de fato entrou e saiu do caixa.</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-[var(--fin-s-3)] gap-y-2 tabular-nums">
                    <dt className="fin-t-body text-[var(--fin-text-2)]">Entrou</dt>
                    <dd className="text-right fin-t-body font-medium text-[var(--fin-positive)]">+{formatBRL(mes.entrou)}</dd>
                    <dt className="fin-t-body text-[var(--fin-text-2)]">Saiu</dt>
                    <dd className="text-right fin-t-body font-medium text-[var(--fin-text)]">−{formatBRL(mes.saiu)}</dd>
                    <dt className="border-t border-[var(--fin-border)] pt-2.5 fin-t-body font-medium text-[var(--fin-text)]">Resultado</dt>
                    <dd className={cn('border-t border-[var(--fin-border)] pt-2.5 text-right fin-t-metric-sm', mes.resultado < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                      {formatBRL(mes.resultado)}
                    </dd>
                  </dl>
                  <p className="mt-[var(--fin-s-3)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-2.5 fin-t-caption text-[var(--fin-text-2)]">
                    De {Number(mes.anterior.de.slice(8, 10))} a {Number(mes.anterior.ate.slice(8, 10))} de {mes.nomeDoMesAnterior} o resultado foi{' '}
                    <b className="font-semibold tabular-nums text-[var(--fin-text)]">{formatBRL(mes.anterior.resultado)}</b>.
                    {' '}Comparação com os mesmos dias do mês anterior, não com o mês inteiro.
                  </p>
                  <Link href="/financeiro-ag/dre" className={cn(LINK, 'mt-[var(--fin-s-3)]')}>
                    Ver resultado do mês
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </DataState>

      <BaixaDeReceber conta={receberAlvo} onFechar={() => setReceberAlvo(null)} onRegistrada={() => { void carregar(); }} />
      <BaixaDePagar conta={pagarAlvo} onFechar={() => setPagarAlvo(null)} onRegistrada={() => { void carregar(); }} />
    </MolduraDaPagina>
  );
}
