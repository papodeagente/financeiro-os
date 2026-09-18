'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, TrendingDown, Trophy, UserPlus } from 'lucide-react';

import type { Membro, MetaVendedor, VendaCRM, ComissaoVenda, PlanoComissao } from '@/lib/crm-types';
import { loadEntities, loadEquipe, saveEntity } from '@/lib/crm-storage';
import { montarRanking, type LinhaRanking } from '@/lib/ranking-equipe';
import { posicaoNaEscala, type PosicaoNaEscala } from '@/lib/comissao-acumulada';
import { ritmoEsperadoPct, ritmoNecessario } from '@/lib/escala';
import { hojeISO, mesDe, num, round2, ultimoDiaDoMes } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { Money } from '@/components/fin/Money';
import { Comemoracao } from '@/components/fin/Comemoracao';
import { Callout } from '@/components/fin/Callout';
import { Resposta } from '@/components/fin/Resposta';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { ReguaDeRazao } from '@/components/fin/ReguaDeRazao';
import { EscadaAcumulada, type EventoAcum } from '@/components/fin/EscadaAcumulada';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { EscadaDeFaixas } from '@/components/fin/EscadaDeFaixas';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { SeletorDeMes, rotuloDoMes, useMesDaUrl } from '@/components/fin/SeletorDeMes';
import { toast } from '@/lib/toast';

const BRL = (v: number) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(num(v))}%`;
const dataCurta = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

interface EscalaDoVendedor {
  base: number;
  escala: PosicaoNaEscala;
  plano: string;
  faixas: PlanoComissao['faixas'];
}

export default function MetasPage() {
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [mes, setMes] = useMesDaUrl();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [festa, setFesta] = useState<{ chave: string; detalhe: string } | null>(null);
  const [temNovidade, setTemNovidade] = useState(false);
  const [ficha, setFicha] = useState<string | null>(null);

  /** Vendas já vistas. O que aparecer depois é venda nova. */
  const vistas = useRef<Set<string> | null>(null);
  const mesRef = useRef(mes);
  mesRef.current = mes;

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [mt, eq, v, c, pl] = await Promise.all([
        loadEntities<MetaVendedor>('metas'),
        loadEquipe<Membro>(),
        loadEntities<VendaCRM>('vendas-crm'),
        loadEntities<ComissaoVenda>('comissoes'),
        loadEntities<PlanoComissao>('planos-comissao'),
      ]);
      setMetas(mt);
      setEquipe(eq);
      setVendas(v);
      setComissoes(c);
      setPlanos(pl);
      setAtualizadoEm(new Date());
      setTemNovidade(false);

      const fechadas = v.filter(x => x.status === 'CONFIRMADO' || x.status === 'CONCLUIDO');
      if (vistas.current === null) {
        // Primeira carga só memoriza: festa é para o que chegar DEPOIS.
        vistas.current = new Set(fechadas.map(x => x.id));
      } else {
        // E só festeja venda DO MÊS EXIBIDO: uma venda de 2025 importada do
        // CRM disparava confete enquanto o usuário olhava setembro de 2026.
        const nova = fechadas.find(
          x => !vistas.current!.has(x.id) && mesDe(x.data_venda ?? '') === mesRef.current,
        );
        fechadas.forEach(x => vistas.current!.add(x.id));
        if (nova) {
          const quem = eq.find(p => p.id === nova.vendedor_id)?.nome;
          setFesta({
            chave: nova.id,
            detalhe: `${quem ? `${quem} fechou` : 'Venda fechada'} ${BRL(num(nova.valor_final))} na ${nova.numero}`,
          });
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A venda chega pelo webhook do CRM, não por ação nesta tela. Mas recarregar
  // tudo sozinho reordenava o ranking embaixo do dedo de quem estava lendo:
  // agora a checagem só AVISA, e quem decide atualizar é quem está olhando.
  useEffect(() => {
    const t = setInterval(async () => {
      const atuais = await loadEntities<VendaCRM>('vendas-crm');
      const fechadas = atuais.filter(x => x.status === 'CONFIRMADO' || x.status === 'CONCLUIDO');
      if (vistas.current && fechadas.some(x => !vistas.current!.has(x.id))) setTemNovidade(true);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const nomeDoMes = rotuloDoMes(mes);
  const ehMesCorrente = mes === mesDe(hojeISO());
  const [ano, mesNum] = mes.split('-').map(Number);
  const diasDoMes = ultimoDiaDoMes(ano, mesNum);
  const diaDeHoje = ehMesCorrente ? Number(hojeISO().slice(8, 10)) : diasDoMes;
  const diasRestantes = Math.max(0, diasDoMes - diaDeHoje);

  const resumo = useMemo(
    () => montarRanking({ equipe, metas, vendas, comissoes, mes }),
    [equipe, metas, vendas, comissoes, mes],
  );

  /** Em que degrau da escada cada pessoa está neste mês, e o que falta. */
  const escalaPorVendedor = useMemo(() => {
    const mapa = new Map<string, EscalaDoVendedor>();
    for (const p of equipe) {
      const plano = planos.find(x => x.id === p.plano_comissao_id);
      if (!plano) continue;
      const doMes = comissoes.filter(
        c =>
          c.status !== 'CANCELADA' &&
          mesDe(c.data_venda) === mes &&
          (c.vendedor_id === p.id || (p.membro_ids_legado ?? []).includes(c.vendedor_id)),
      );
      const base = round2(doMes.reduce((t, c) => t + num(c.valor_base), 0));
      mapa.set(p.id, {
        base,
        escala: posicaoNaEscala(plano.faixas ?? [], base),
        plano: plano.nome,
        faixas: plano.faixas ?? [],
      });
    }
    return mapa;
  }, [equipe, planos, comissoes, mes]);

  const participantes = resumo.linhas.filter(l => l.posicao !== null);
  const herdadas = resumo.linhas.filter(l => l.origem_meta === 'CADASTRO');
  // Meta menor que um décimo do realizado não é meta apertada: é meta que
  // ninguém definiu. 15.499% não informa nada.
  const metaIrreal = resumo.meta_total > 0 && resumo.realizado_total > resumo.meta_total * 10;

  const faltam = round2(Math.max(0, resumo.meta_total - resumo.realizado_total));
  /** Quem de fato fechou alguma venda no mês. Sem meta definida, é o único
   *  recorte honesto que a resposta tem para oferecer. */
  const quantosVenderam = resumo.linhas.filter(l => l.realizado_valor > 0).length;
  const porDia = ritmoNecessario(faltam, diasRestantes);
  const ritmoEsperado = ritmoEsperadoPct(diaDeHoje, diasDoMes);
  const noRitmo = resumo.meta_total <= 0 || resumo.pct_equipe >= ritmoEsperado;

  const eventosDoRitmo: EventoAcum[] = useMemo(
    () =>
      vendas
        .filter(
          v =>
            (v.status === 'CONFIRMADO' || v.status === 'CONCLUIDO') &&
            mesDe(v.data_venda ?? '') === mes,
        )
        .map(v => ({
          data: v.data_venda,
          rotulo: equipe.find(p => p.id === v.vendedor_id)?.nome ?? 'Sem vendedor',
          valor: num(v.valor_final),
        })),
    [vendas, equipe, mes],
  );

  const linhasDoRanking: LinhaBarra[] = useMemo(
    () =>
      resumo.linhas.map((l: LinhaRanking) => {
        const escala = escalaPorVendedor.get(l.vendedor_id);
        const semVenda = l.realizado_valor <= 0;
        return {
          id: l.vendedor_id,
          nome: l.vendedor_nome,
          // Quem não vendeu entra como AUSÊNCIA, não como barra vermelha em
          // 0%: três quartos da lista eram zeros vestidos de fracasso.
          valor: semVenda ? null : l.realizado_valor,
          rotuloAusencia: l.tem_meta
            ? `ainda sem venda em ${nomeDoMes} · faltam ${BRL(l.meta_valor)}`
            : `ainda sem venda em ${nomeDoMes} · sem meta definida`,
          alvo: l.tem_meta ? l.meta_valor : null,
          secundario: semVenda
            ? undefined
            : [
                l.tem_meta ? `${PCT(l.pct_valor)} da meta` : 'sem meta definida',
                `${l.realizado_quantidade} ${l.realizado_quantidade === 1 ? 'venda' : 'vendas'}`,
                `${PCT(round2((l.realizado_valor / Math.max(1, resumo.realizado_total)) * 100))} do mês`,
              ].join(' · '),
          detalhes: [
            ...(l.tem_meta ? [`meta ${BRL(l.meta_valor)}`] : []),
            `comissão ${BRL(l.comissao_mes)}`,
            ...(escala?.escala.atual ? [`faixa ${escala.escala.indice} de ${escala.escala.total}`] : []),
          ],
        };
      }),
    [resumo.linhas, resumo.realizado_total, escalaPorVendedor, nomeDoMes],
  );

  /** Materializa no mês as metas herdadas do cadastro. */
  async function fixarMetasDoMes() {
    if (herdadas.length === 0) return;
    setSalvando(true);
    try {
      for (const l of herdadas) {
        const meta: MetaVendedor = {
          // Id determinístico: fixar duas vezes atualiza a MESMA meta.
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
      toast.success(`${herdadas.length} meta${herdadas.length === 1 ? '' : 's'} de ${nomeDoMes} ${herdadas.length === 1 ? 'fixada' : 'fixadas'}`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível fixar as metas');
    } finally {
      setSalvando(false);
    }
  }

  const pessoaDaFicha = ficha ? resumo.linhas.find(l => l.vendedor_id === ficha) ?? null : null;
  const escalaDaFicha = ficha ? escalaPorVendedor.get(ficha) ?? null : null;

  // A fila de trabalho, com contagem e ação por item. Nenhum destes itens
  // vira faixa colorida no topo empurrando o conteúdo para baixo.
  const pendencias: Array<{ id: string; texto: string; acao: React.ReactNode }> = [];
  if (resumo.vendas_sem_vendedor > 0) {
    pendencias.push({
      id: 'sem-vendedor',
      texto: `${resumo.vendas_sem_vendedor} ${resumo.vendas_sem_vendedor === 1 ? 'venda' : 'vendas'} de ${nomeDoMes} sem vendedor: o valor entrou no faturamento, mas não conta para meta nenhuma nem gera comissão.`,
      acao: (
        <Link href="/config/usuarios" className="fin-t-body text-[var(--fin-accent)] underline underline-offset-2">
          Vincular a uma pessoa
        </Link>
      ),
    });
  }
  if (herdadas.length > 0) {
    pendencias.push({
      id: 'herdadas',
      texto: `${herdadas.length} ${herdadas.length === 1 ? 'meta veio' : 'metas vieram'} do cadastro e não ${herdadas.length === 1 ? 'foi acordada' : 'foram acordadas'} para ${nomeDoMes}.`,
      acao: (
        <button
          type="button"
          onClick={fixarMetasDoMes}
          disabled={salvando}
          className="fin-t-body h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] disabled:opacity-50"
        >
          {`Fixar as metas de ${nomeDoMes}`}
        </button>
      ),
    });
  }
  if (resumo.fora_do_ranking.length > 0) {
    pendencias.push({
      id: 'fora',
      texto: `${resumo.fora_do_ranking.length} ${resumo.fora_do_ranking.length === 1 ? 'pessoa está' : 'pessoas estão'} sem meta e sem venda em ${nomeDoMes}.`,
      acao: (
        <Link href="/equipe/vendedores" className="fin-t-body inline-flex items-center gap-1 text-[var(--fin-accent)] underline underline-offset-2">
          <UserPlus className="h-4 w-4" aria-hidden />
          Definir metas
        </Link>
      ),
    });
  }

  return (
    <MolduraDaPagina>
      <Comemoracao chave={festa?.chave ?? null} detalhe={festa?.detalhe} onFim={() => setFesta(null)} />

      <PageHeader
        titulo="Metas e ranking"
        subtitulo="Quanto cada pessoa vendeu no mês e quanto falta para a meta"
        acoesSecundarias={[{ rotulo: 'Vendedores e planos', href: `/equipe/vendedores?mes=${mes}` }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
            <div className="h-[44px] w-40 rounded bg-[var(--fin-surface-2)]" />
            <div className="h-[210px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
            <div className="h-[236px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
          </div>
        }
      >
        <SeletorDeMes valor={mes} onChange={setMes} />

        {temNovidade && (
          <button
            type="button"
            onClick={() => { carregar(); }}
            className="fin-t-body inline-flex h-11 items-center self-start rounded-[var(--fin-r-md)] border border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] px-3 text-[var(--fin-accent)]"
          >
            há vendas novas — atualizar
          </button>
        )}

        {metaIrreal && (
          <Callout
            tom="aviso"
            titulo="A meta da equipe está muito abaixo do que já foi vendido"
          >
            {`${BRL(resumo.realizado_total)} realizados contra ${BRL(resumo.meta_total)} de meta. O percentual fica sem sentido até as metas serem definidas.`}
          </Callout>
        )}

        {/* ── A RESPOSTA ─────────────────────────────────────────────────── */}
        <Resposta
          overline={`VENDIDO EM ${nomeDoMes.toUpperCase()}`}
          valor={<Money valor={resumo.realizado_total} size="resposta" align="esquerda" />}
          frase={
            resumo.meta_total > 0
              ? `de ${BRL(resumo.meta_total)} de meta. Dia ${diaDeHoje} de ${diasDoMes}: ${
                  faltam <= 0
                    ? 'a meta do mês já foi batida.'
                    : porDia === null
                      ? `faltaram ${BRL(faltam)} e o mês acabou.`
                      : `para bater, faltam ${BRL(faltam)} em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'} — ${BRL(porDia)} por dia.`
                }`
              : quantosVenderam === 0
                ? `Ninguém vendeu até o dia ${diaDeHoje} de ${diasDoMes}.`
                : `${quantosVenderam} ${quantosVenderam === 1 ? 'pessoa vendeu' : 'pessoas venderam'} até o dia ${diaDeHoje} de ${diasDoMes}.`
          }
          chip={
            resumo.meta_total <= 0
              ? null
              : noRitmo
                ? { icone: CheckCircle2, rotulo: faltam <= 0 ? 'Meta batida' : 'No ritmo', tom: 'positivo' }
                : { icone: TrendingDown, rotulo: 'Atrás do ritmo', tom: 'aviso' }
          }
          marca={
            <ReguaDeRazao
              valor={resumo.realizado_total}
              rotuloValor="Realizado"
              base={resumo.meta_total}
              rotuloBase="meta"
              marcas={[
                {
                  id: 'ritmo',
                  valor: round2(resumo.meta_total * (ritmoEsperado / 100)),
                  rotulo: `ritmo de hoje (dia ${diaDeHoje} de ${diasDoMes})`,
                  descricao: `Para bater a meta, hoje já deveriam estar vendidos ${BRL(round2(resumo.meta_total * (ritmoEsperado / 100)))}.`,
                },
              ]}
              formatar={BRL}
              semBase={{
                frase: `Sem meta definida para ${nomeDoMes} — o realizado não tem contra o que ser comparado.`,
                acao: { rotulo: 'Definir metas', href: '/equipe/vendedores' },
              }}
            />
          }
        />

        {/* ── RITMO DO MÊS ───────────────────────────────────────────────── */}
        <GraficoMoldura
          titulo={`Ritmo de ${nomeDoMes}`}
          sublinha="A linha sobe no dia em que alguém fecha; entre uma venda e outra ela segue reta."
          estado={eventosDoRitmo.length === 0 && resumo.meta_total <= 0 ? 'sem-dado' : 'ok'}
          vazio={{ frase: `Não houve venda em ${nomeDoMes}.`, acao: { rotulo: 'Registrar venda', href: '/vendas/nova' } }}
          descricao={`Vendas acumuladas dia a dia em ${nomeDoMes}, contra a meta da equipe.`}
          tabela={{
            colunas: ['Dia', 'Quem vendeu', 'Valor'],
            linhas: eventosDoRitmo.map(e => [dataCurta(e.data), e.rotulo, BRL(e.valor)]),
          }}
        >
          <EscadaAcumulada
            eventos={eventosDoRitmo}
            diasDoMes={diasDoMes}
            diaDeHoje={diaDeHoje}
            // Aqui o topo É a meta: a linha colada no chão é a resposta, não
            // um defeito de escala — e a sublinha diz isso em palavras.
            topoDoEixo={resumo.meta_total > 0 ? 'referencia' : 'dado'}
            referencia={resumo.meta_total > 0 ? { rotulo: 'meta', ate: resumo.meta_total } : null}
            formatar={BRL}
            vazio={
              <p className="fin-t-body text-[var(--fin-text-2)]">
                {porDia !== null && porDia > 0
                  ? `Nenhuma venda em ${nomeDoMes} ainda — o ritmo pede ${BRL(porDia)} por dia.`
                  : `Não houve venda em ${nomeDoMes}.`}
              </p>
            }
          />
        </GraficoMoldura>

        {/* ── QUEM ESTÁ PUXANDO ──────────────────────────────────────────── */}
        <GraficoMoldura
          titulo="Quem está puxando"
          sublinha="Todas as barras estão na mesma escala, então a comparação entre pessoas é direta. O entalhe marca a meta de cada um."
          estado={resumo.linhas.length === 0 ? 'sem-dado' : 'ok'}
          vazio={{ frase: 'Ninguém na equipe ainda.', acao: { rotulo: 'Cadastrar equipe', href: '/config/usuarios' } }}
          descricao={`Vendido por pessoa em ${nomeDoMes}, na mesma escala, com a meta de cada um.`}
          tabela={{
            colunas: ['Pessoa', 'Vendido', 'Meta', 'Comissão'],
            linhas: resumo.linhas.map(l => [
              l.vendedor_nome,
              l.realizado_valor > 0 ? BRL(l.realizado_valor) : '—',
              l.tem_meta ? BRL(l.meta_valor) : '—',
              BRL(l.comissao_mes),
            ]),
          }}
        >
          <BarrasNomeadas
            linhas={linhasDoRanking}
            formatar={BRL}
            alturaBarra={10}
            onAtivar={id => setFicha(id)}
            fraseDeLinhaUnica={l => `A equipe é uma pessoa: ${l.nome}, ${l.valor === null ? 'ainda sem venda' : BRL(num(l.valor))}.`}
          />
        </GraficoMoldura>

        {participantes.length === 0 && resumo.linhas.length === 0 && (
          <div className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]">
            <EmptyLesson
              motivo="sem-dado"
              titulo="Nenhuma pessoa na equipe"
              oQueE="O ranking mostra quanto cada pessoa vendeu no mês em relação à meta dela."
              comoComeca={[
                'Cadastre a equipe em Configurações, Usuários',
                'Defina a meta mensal de cada pessoa',
                'As vendas do mês entram sozinhas',
              ]}
              acao={{ rotulo: 'Cadastrar equipe', href: '/config/usuarios' }}
            />
          </div>
        )}

        {/* ── PARA O RANKING FICAR COMPLETO ──────────────────────────────── */}
        {pendencias.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Para o ranking ficar completo</h2>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {pendencias.map(p => (
                <li key={p.id} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                  <p className="fin-t-body min-w-0 flex-1 text-[var(--fin-text-2)]">{p.texto}</p>
                  <div className="shrink-0">{p.acao}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex items-center gap-2 fin-t-caption text-[var(--fin-text-3)]">
          <Trophy className="h-4 w-4" aria-hidden />
          {`Ordenado por quanto cada um vendeu em ${nomeDoMes}.`}
        </p>
      </DataState>

      {/* ── FICHA DA PESSOA ──────────────────────────────────────────────── */}
      {pessoaDaFicha && (
        <RecordSheet
          aberto
          onOpenChange={aberto => { if (!aberto) setFicha(null); }}
          titulo={pessoaDaFicha.vendedor_nome}
          descricao={`Como ${pessoaDaFicha.vendedor_nome} está em ${nomeDoMes}`}
          acaoPrimaria={{ rotulo: 'Fechar', onClick: () => setFicha(null) }}
        >
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Vendido</dt>
                <dd><Money valor={pessoaDaFicha.realizado_valor} size="strong" /></dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Meta</dt>
                <dd>
                  {pessoaDaFicha.tem_meta ? (
                    <Money valor={pessoaDaFicha.meta_valor} size="strong" />
                  ) : (
                    <span className="fin-t-body text-[var(--fin-text-3)]">sem meta definida</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Ticket médio</dt>
                <dd className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">
                  {/* O denominador sempre visível: "ticket médio" sem o número
                      de vendas não dá para conferir. */}
                  {pessoaDaFicha.realizado_quantidade > 0
                    ? `${BRL(round2(pessoaDaFicha.realizado_valor / pessoaDaFicha.realizado_quantidade))} em ${pessoaDaFicha.realizado_quantidade} ${pessoaDaFicha.realizado_quantidade === 1 ? 'venda' : 'vendas'}`
                    : 'sem venda no mês'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Comissão do mês</dt>
                <dd><Money valor={pessoaDaFicha.comissao_mes} size="strong" /></dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2 border-t border-[var(--fin-border)] pt-4">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">
                {`Onde ${pessoaDaFicha.vendedor_nome} está na tabela de comissão`}
              </h3>
              {escalaDaFicha && escalaDaFicha.faixas.length > 0 ? (
                <EscadaDeFaixas
                  modo="trilho"
                  faixas={escalaDaFicha.faixas.map(f => ({ de: num(f.de), ate: num(f.ate) === 0 ? null : num(f.ate), percentual: num(f.percentual) }))}
                  baseAcumulada={escalaDaFicha.base}
                  posicao={escalaDaFicha.escala}
                  formatar={BRL}
                  nome={pessoaDaFicha.vendedor_nome}
                />
              ) : escalaDaFicha ? (
                <p className="fin-t-body text-[var(--fin-text-2)]">
                  {`O plano "${escalaDaFicha.plano}" paga um percentual fixo sobre o markup da venda, sem escada de faixas.`}
                </p>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="fin-t-body text-[var(--fin-text-2)]">
                    Sem plano de comissão — as vendas desta pessoa não geram comissão.
                  </p>
                  <Link
                    href="/equipe/vendedores"
                    className="fin-t-body-strong inline-flex h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]"
                  >
                    Escolher plano
                  </Link>
                </div>
              )}
            </div>
          </div>
        </RecordSheet>
      )}
    </MolduraDaPagina>
  );
}
