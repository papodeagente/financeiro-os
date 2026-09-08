'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Crown, Medal, Target, TriangleAlert, Trophy, UserPlus } from 'lucide-react';
import type { Membro, MetaVendedor, VendaCRM, ComissaoVenda } from '@/lib/crm-types';
import { loadEntities, loadEquipe, saveEntity } from '@/lib/crm-storage';
import { montarRanking, type LinhaRanking } from '@/lib/ranking-equipe';
import { hojeISO, mesDe, num, round2 } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { MetricCard } from '@/components/fin/MetricCard';
import { Meter } from '@/components/fin/Meter';
import { Money } from '@/components/fin/Money';
import { Comemoracao } from '@/components/fin/Comemoracao';
import { toast } from '@/lib/toast';

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const CAMPO =
  'h-9 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

function faixaDoPct(pct: number): 'saudavel' | 'atencao' | 'critico' {
  if (pct >= 80) return 'saudavel';
  if (pct >= 50) return 'atencao';
  return 'critico';
}

function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  const d = new Date(Number(a), Number(m) - 1, 15);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** Últimos 12 meses, do atual para trás. Data civil, sem fuso. */
function ultimosMeses(qtd = 12): string[] {
  const hoje = hojeISO();
  const [a, m] = hoje.split('-').map(Number);
  return Array.from({ length: qtd }, (_, i) => {
    const total = a * 12 + (m - 1) - i;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  });
}

const MEDALHA = ['text-[#B8860B]', 'text-[var(--fin-text-3)]', 'text-[#A0522D]'];

function EsqueletoMetas() {
  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARTAO} h-[104px] p-[var(--fin-s-4)]`}>
            <div className="h-3 w-24 rounded bg-[var(--fin-surface-2)]" />
            <div className="mt-3 h-7 w-32 rounded bg-[var(--fin-surface-2)]" />
          </div>
        ))}
      </div>
      <div className={`${CARTAO} h-64`} />
    </div>
  );
}

export default function MetasPage() {
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [mes, setMes] = useState(() => mesDe(hojeISO()));
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [festa, setFesta] = useState<{ chave: string; detalhe: string } | null>(null);

  /** Vendas já vistas. O que aparecer depois é venda nova, e venda nova
   *  merece festa. Guardado em ref para não disparar re-render. */
  const vistas = useRef<Set<string> | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [mt, eq, v, c] = await Promise.all([
        loadEntities<MetaVendedor>('metas'),
        loadEquipe<Membro>(),
        loadEntities<VendaCRM>('vendas-crm'),
        loadEntities<ComissaoVenda>('comissoes'),
      ]);
      setMetas(mt); setEquipe(eq); setVendas(v); setComissoes(c);
      setAtualizadoEm(new Date());

      // Primeira carga só memoriza. Festa é para o que chegar depois.
      const fechadas = v.filter(x => x.status === 'CONFIRMADO' || x.status === 'CONCLUIDO');
      if (vistas.current === null) {
        vistas.current = new Set(fechadas.map(x => x.id));
      } else {
        const nova = fechadas.find(x => !vistas.current!.has(x.id));
        fechadas.forEach(x => vistas.current!.add(x.id));
        if (nova) {
          const quem = eq.find(p => p.id === nova.vendedor_id)?.nome;
          const valor = round2(num(nova.valor_final)).toLocaleString('pt-BR', {
            style: 'currency', currency: 'BRL',
          });
          setFesta({
            chave: nova.id,
            detalhe: `${quem ? `${quem} fechou` : 'Venda fechada'} ${valor} na ${nova.numero}`,
          });
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Venda chega pelo webhook do CRM, não por ação nesta tela. Sem uma
  // olhada periódica, a festa só aconteceria se alguém recarregasse.
  useEffect(() => {
    const t = setInterval(() => { carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const resumo = useMemo(
    () => montarRanking({ equipe, metas, vendas, comissoes, mes }),
    [equipe, metas, vendas, comissoes, mes],
  );

  /** Materializa no mês as metas que hoje são herdadas do cadastro, para
   *  poderem ser ajustadas mês a mês sem mexer no cadastro da pessoa. */
  async function fixarMetasDoMes() {
    const herdadas = resumo.linhas.filter(l => l.origem_meta === 'CADASTRO');
    if (herdadas.length === 0) return;
    setSalvando(true);
    try {
      for (const l of herdadas) {
        const meta: MetaVendedor = {
          // Id determinístico: fixar duas vezes atualiza a mesma meta.
          id: `meta-${mes}-${l.vendedor_id}`,
          vendedor_id: l.vendedor_id,
          vendedor_nome: l.vendedor_nome,
          periodo: 'MENSAL',
          mes_referencia: mes,
          meta_valor: l.meta_valor,
          meta_quantidade: l.meta_quantidade,
          realizado_valor: l.realizado_valor,
          realizado_quantidade: l.realizado_quantidade,
          percentual_atingido_valor: l.pct_valor,
          percentual_atingido_quantidade: l.pct_quantidade,
          bonus_meta: 0,
          criado_em: hojeISO(),
        };
        await saveEntity('metas', meta);
      }
      toast.success(`${herdadas.length} meta${herdadas.length === 1 ? '' : 's'} fixada${herdadas.length === 1 ? '' : 's'} em ${rotuloMes(mes)}`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível fixar as metas');
    } finally {
      setSalvando(false);
    }
  }

  const participantes = resumo.linhas.filter(l => l.posicao !== null);
  const semMeta = resumo.linhas.filter(l => l.origem_meta === 'SEM_META');
  const herdadas = resumo.linhas.filter(l => l.origem_meta === 'CADASTRO').length;

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <Comemoracao
        chave={festa?.chave ?? null}
        detalhe={festa?.detalhe}
        onFim={() => setFesta(null)}
      />

      <PageHeader
        titulo="Metas e ranking"
        subtitulo="Quanto cada pessoa vendeu no mês e quanto falta para a meta"
        acoesSecundarias={[{ rotulo: 'Vendedores e planos', href: '/equipe/vendedores' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<EsqueletoMetas />}
      >
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <label htmlFor="mes-ranking" className="fin-t-caption text-[var(--fin-text-3)]">Mês</label>
          <select
            id="mes-ranking"
            className={CAMPO}
            value={mes}
            onChange={e => setMes(e.target.value)}
          >
            {ultimosMeses().map(m => (
              <option key={m} value={m}>{rotuloMes(m)}</option>
            ))}
          </select>
          {herdadas > 0 && (
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
              onClick={fixarMetasDoMes}
              disabled={salvando}
              title="Grava neste mês as metas hoje herdadas do cadastro, para você poder ajustá-las sem mexer no cadastro"
            >
              <Target className="h-4 w-4" aria-hidden />
              Fixar {herdadas} meta{herdadas === 1 ? '' : 's'} neste mês
            </button>
          )}
        </div>

        <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            rotulo="Realizado"
            valor={resumo.realizado_total}
            estado="ok"
            emphasis="destaque"
            contexto={
              resumo.meta_total > 0
                ? `de ${resumo.meta_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de meta`
                : `em ${participantes.length} ${participantes.length === 1 ? 'pessoa' : 'pessoas'}, sem meta definida`
            }
          />
          <MetricCard
            rotulo="Meta da equipe"
            valor={resumo.meta_total}
            estado="ok"
            contexto={
              herdadas > 0
                ? `${herdadas} herdada${herdadas === 1 ? '' : 's'} do cadastro`
                : `${participantes.length} ${participantes.length === 1 ? 'pessoa' : 'pessoas'} com meta`
            }
          />
          <MetricCard
            rotulo="Comissões do mês"
            valor={resumo.comissoes_mes}
            estado="ok"
            contexto="calculadas e aprovadas, exceto canceladas"
          />
          <div className={`${CARTAO} flex flex-col justify-between p-[var(--fin-s-4)]`}>
            <p className="fin-t-overline text-[var(--fin-text-3)]">Atingido</p>
            <p className={`fin-t-metric ${resumo.pct_equipe >= 80 ? 'text-[var(--fin-positive)]' : resumo.pct_equipe >= 50 ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text)]'}`}>
              {resumo.meta_total > 0 ? `${resumo.pct_equipe.toFixed(1)}%` : '—'}
            </p>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {resumo.meta_total > 0 ? 'da meta da equipe no mês' : 'defina metas para acompanhar'}
            </p>
          </div>
        </div>

        {resumo.meta_total > 0 && (
          <section className={`${CARTAO} p-[var(--fin-s-4)]`}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Progresso da equipe</h2>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                faltam{' '}
                <Money valor={Math.max(0, round2(resumo.meta_total - resumo.realizado_total))} size="caption" />
              </p>
            </div>
            <Meter
              pct={resumo.pct_equipe}
              faixa={faixaDoPct(resumo.pct_equipe)}
              descricao={`${resumo.realizado_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de ${resumo.meta_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
            />
          </section>
        )}

        {resumo.vendas_sem_vendedor > 0 && (
          <div className={`${CARTAO} flex items-start gap-[var(--fin-s-2)] border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-4)]`}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" aria-hidden />
            <div>
              <p className="fin-t-body-strong text-[var(--fin-text)]">
                {resumo.vendas_sem_vendedor} venda{resumo.vendas_sem_vendedor === 1 ? '' : 's'} do mês sem vendedor na equipe
              </p>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                O valor entrou no faturamento, mas não conta para nenhuma meta nem gera comissão.
                Cadastre a pessoa em{' '}
                <Link href="/config/usuarios" className="underline underline-offset-2">Configurações, Usuários</Link>.
              </p>
            </div>
          </div>
        )}

        <section className={`${CARTAO} overflow-hidden`}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <h2 className="flex items-center gap-2 fin-t-subhead text-[var(--fin-text)]">
              <Trophy className="h-4 w-4 text-[var(--fin-text-3)]" aria-hidden />
              Ranking de {rotuloMes(mes)}
            </h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {participantes.length} {participantes.length === 1 ? 'participante' : 'participantes'}
              {semMeta.length > 0 && ` · ${semMeta.length} sem meta`}
            </p>
          </header>

          {participantes.length === 0 ? (
            <div className="p-[var(--fin-s-5)]">
              <EmptyLesson
                motivo="sem-dado"
                titulo={equipe.length === 0 ? 'Nenhuma pessoa na equipe' : 'Ninguém com meta neste mês'}
                oQueE="O ranking mostra quanto cada pessoa vendeu no mês em relação à meta dela."
                comoComeca={
                  equipe.length === 0
                    ? ['Cadastre a equipe em Configurações, Usuários', 'Defina a meta mensal de cada pessoa', 'As vendas do mês entram sozinhas']
                    : ['Abra Vendedores e planos', 'Preencha a meta mensal de cada pessoa', 'Volte aqui: o ranking aparece sozinho']
                }
                acao={
                  equipe.length === 0
                    ? { rotulo: 'Cadastrar equipe', href: '/config/usuarios' }
                    : { rotulo: 'Definir metas', href: '/equipe/vendedores' }
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--fin-border)]">
              {participantes.map(l => (
                <LinhaDoRanking key={l.vendedor_id} linha={l} />
              ))}
            </ul>
          )}

          {semMeta.length > 0 && (
            <div className="border-t border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                Sem meta e fora do ranking: {semMeta.map(l => l.vendedor_nome).join(', ')}.{' '}
                <Link href="/equipe/vendedores" className="inline-flex items-center gap-1 text-[var(--fin-accent)] underline underline-offset-2">
                  <UserPlus className="h-3 w-3" aria-hidden />
                  Definir metas
                </Link>
              </p>
            </div>
          )}
        </section>
      </DataState>
    </div>
  );
}

function LinhaDoRanking({ linha: l }: { linha: LinhaRanking }) {
  const faixa = faixaDoPct(l.pct_valor);
  const podio = (l.posicao ?? 99) <= 3;
  return (
    <li className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
      <div className="flex w-8 shrink-0 justify-center">
        {podio ? (
          l.posicao === 1
            ? <Crown className={`h-5 w-5 ${MEDALHA[0]}`} aria-label="Primeiro lugar" />
            : <Medal className={`h-5 w-5 ${MEDALHA[(l.posicao ?? 1) - 1]}`} aria-label={`${l.posicao}º lugar`} />
        ) : (
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{l.posicao}º</span>
        )}
      </div>

      <div className="min-w-[10rem] flex-1">
        <p className="fin-t-body-strong text-[var(--fin-text)]">{l.vendedor_nome}</p>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {l.realizado_quantidade} {l.realizado_quantidade === 1 ? 'venda' : 'vendas'}
          {l.origem_meta === 'CADASTRO' && ' · meta do cadastro'}
        </p>
      </div>

      <div className="w-full sm:w-56">
        <Meter
          pct={l.pct_valor}
          faixa={faixa}
          descricao={`${l.realizado_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de ${l.meta_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
          size="sm"
        />
      </div>

      <div className="w-24 text-right">
        <p className="fin-t-caption text-[var(--fin-text-3)]">Comissão</p>
        <Money valor={l.comissao_mes} size="body" />
      </div>
    </li>
  );
}
