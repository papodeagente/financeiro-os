'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, ChartLine, ChartColumn, CircleCheck, Gauge, Megaphone, Percent, Plus, Scale,
  ShoppingBag, Target, Trash2, TrendingDown, TrendingUp, TriangleAlert, Users, Wallet, type LucideIcon,
} from 'lucide-react';

import type { CustosData, Relatorio } from '@/lib/planejamento-custos';
import {
  metricasDoCrm, montarAcompanhamento, ritmoDoPlano, ultimoRegistro,
  type AreaDoPlano, type Calendario, type ContaDoMes, type IndicadorDoPlano, type ItemDoPlano, type PontoDeAtencao, type RealizadoDoMes, type Situacao,
} from '@/lib/plano-do-mes';
import { cn, formatBRL } from '@/lib/utils';
import { hojeISO } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { rotuloStatus, toneStatus } from '@/components/fin/StatusChip';
import {
  BarraDoTom, baldes, CabecaDoBloco, CARTAO_DO_PAINEL, CartaoDeNumero, SeloDoTom, TituloDeSecao,
  type NumeroDoPainel, type TomDoPainel,
} from '@/components/fin/PecasDoPainel';
import { RitmoDoMes } from './RitmoDoMes';

const CAMPO = 'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const ICONE_DA_AREA: Record<AreaDoPlano['id'], LucideIcon> = {
  comercial: Target, receita: ArrowDownLeft, custos: ArrowUpRight, resultado: Scale,
};
const TOM_DA_AREA: Record<AreaDoPlano['id'], TomDoPainel> = {
  comercial: 'acento', receita: 'positivo', custos: 'aviso', resultado: 'info',
};
const SOBRE_A_AREA: Record<AreaDoPlano['id'], string> = {
  comercial: 'Vendas e atendimentos contra o ritmo do mês',
  receita: 'O que entrou para a agência e o volume vendido',
  custos: 'O que foi lançado e pago nas contas a pagar do mês',
  resultado: 'Se as vendas já pagaram a estrutura, e o que sobrou',
};
const ICONE_DO_PONTO: Record<PontoDeAtencao['chave'], LucideIcon> = {
  vendas: ShoppingBag, atendimentos: Users, faturamento: ChartColumn, comissao: ArrowDownLeft,
  custos_fixos: ArrowUpRight, marketing: Megaphone, custos_variaveis: Percent, equilibrio: Scale,
  lucro: TrendingUp, indicador: Gauge,
};

function valor(v: number | null, formato: ItemDoPlano['formato']): string {
  if (v === null) return '—';
  return formato === 'dinheiro' ? formatBRL(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** O número grande do cartão: reais inteiros (os centavos ficam na dica). */
function reais(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}` : iso;
}

/** O tom da situação vem do dicionário único (StatusChip, domínio 'plano'). */
function tomDaSituacao(s: Situacao | 'em_linha' | 'abaixo'): TomDoPainel {
  const t = toneStatus('plano', s);
  return t === 'positivo' ? 'positivo' : t === 'negativo' ? 'negativo' : t === 'aviso' ? 'aviso' : t === 'info' ? 'acento' : 'neutro';
}

/** A cor da barra: em custo ela mede o PAGO (o atraso fica no selo e na lista de vencidas). */
function tomDaBarra(item: ItemDoPlano): TomDoPainel {
  if (item.sentido === 'limitar') return item.situacao === 'acima' ? 'aviso' : item.situacao === 'concluido' ? 'positivo' : 'acento';
  return item.situacao === 'atrasado' ? 'negativo' : item.situacao === 'concluido' ? 'positivo' : 'acento';
}

function SeloDaSituacao({ s }: { s: Situacao }) {
  return <SeloDoTom tom={tomDaSituacao(s)}>{rotuloStatus('plano', s)}</SeloDoTom>;
}

/** "22% do plano", com seta para baixo quando está atrás do ritmo. */
function seloDoPlano(item: ItemDoPlano): NumeroDoPainel['selo'] {
  if (item.progresso === null) {
    return item.situacao === 'sem_dados' || item.situacao === 'sem_meta'
      ? { tom: 'neutro', texto: rotuloStatus('plano', item.situacao) }
      : null;
  }
  return {
    tom: tomDaSituacao(item.situacao),
    texto: `${Math.round(item.progresso).toLocaleString('pt-BR')}% do plano`,
    seta: item.situacao === 'atrasado' ? 'desce' : item.situacao === 'concluido' || item.situacao === 'pendente' ? 'sobe' : undefined,
    dica: item.porque,
  };
}

// ============================================================
// Um item da área
// ============================================================

function ListaDeContas({ titulo, contas, vencidas }: { titulo: string; contas: ContaDoMes[]; vencidas?: boolean }) {
  if (contas.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
      <span className={cn('fin-t-overline', vencidas ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')}>{titulo}</span>
      <ul className="flex flex-col">
        {contas.slice(0, 4).map(c => (
          <li key={c.id} className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
            <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-2)]">{c.descricao || c.fornecedor || 'Conta'}, vence {dataBR(c.vencimento)}</span>
            <span className="fin-t-caption shrink-0 tabular-nums text-[var(--fin-text)]">{formatBRL(Math.max(0, c.valor - c.pago))}</span>
          </li>
        ))}
        {contas.length > 4 ? <li className="fin-t-caption text-[var(--fin-text-3)]">e mais {contas.length - 4}</li> : null}
      </ul>
    </div>
  );
}

function LinhaDoItem({ item, registros, podeEditar, onRegistrar, onApagarRegistro }: {
  item: ItemDoPlano;
  registros?: RealizadoDoMes['registros'];
  podeEditar: boolean;
  onRegistrar?: () => void;
  onApagarRegistro?: (id: string) => void;
}) {
  const limitar = item.sentido === 'limitar';
  const porVenda = item.chave === 'custos_variaveis';
  const temContas = !!item.contas && (item.contas.vencidas.length > 0 || item.contas.aVencer.length > 0);

  // Sem dados com número (o lucro sem custos lançados): o número aparece, como no cartão do topo.
  const numeros = item.situacao === 'sem_dados' && item.realizado === null
    ? 'sem dados'
    : porVenda
      ? `${valor(item.realizado, item.formato)} por venda · plano ${valor(item.planejado, item.formato)}`
      : item.planejado === null
        ? valor(item.realizado, item.formato)
        : `${valor(item.realizado, item.formato)} ${limitar ? 'pagos ' : ''}de ${valor(item.planejado, item.formato)}`;

  const sub = (
    <>
      <span className="text-[var(--fin-text-2)]">{item.porque}</span>
      {item.chave === 'vendas' || item.chave === 'atendimentos' ? <span>· {item.fonte}</span> : null}
      {!porVenda && item.falta !== null && item.falta > 0 ? (
        <span>· {limitar ? 'falta pagar' : 'faltam'} <b className="font-medium tabular-nums text-[var(--fin-text-2)]">{valor(item.falta, item.formato)}</b></span>
      ) : null}
    </>
  );

  return (
    <li className="flex flex-col gap-[var(--fin-s-2)]">
      <BarraDoTom
        tom={tomDaBarra(item)}
        nome={item.titulo}
        numeros={numeros}
        selo={<SeloDaSituacao s={item.situacao} />}
        pct={porVenda ? null : item.progresso}
        marca={item.esperadoPct !== null ? { pct: item.esperadoPct, rotulo: 'Onde o plano pedia estar hoje' } : null}
        sub={sub}
      >
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          {temContas ? (
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] rounded-[12px] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:grid-cols-2">
              <ListaDeContas titulo={`Vencidas (${item.contas!.vencidas.length})`} contas={item.contas!.vencidas} vencidas />
              <ListaDeContas titulo={`A vencer (${item.contas!.aVencer.length})`} contas={item.contas!.aVencer} />
            </div>
          ) : null}

          {registros && registros.length > 0 ? (
            <ul className="flex flex-col rounded-[12px] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-3)] py-[var(--fin-s-1)]" aria-label="Registros de atendimentos">
              {registros.slice(0, 5).map(r => (
                <li key={r.id} className="flex items-center justify-between gap-[var(--fin-s-2)]">
                  <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-2)]">
                    <b className="font-semibold tabular-nums text-[var(--fin-text)]">{r.valor}</b> até {dataBR(r.data)}
                    {r.autor ? `, ${r.autor}` : ''}{r.observacao ? `: ${r.observacao}` : ''}
                  </span>
                  {podeEditar && onApagarRegistro ? (
                    <Button variant="ghost" size="icon-sm" onClick={() => onApagarRegistro(r.id)} aria-label={`Apagar o registro de ${r.valor} atendimentos em ${dataBR(r.data)}`}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {(item.registravel && podeEditar && onRegistrar) || temContas ? (
            <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
              {item.registravel && podeEditar && onRegistrar ? (
                <Button variant="outline" size="sm" onClick={onRegistrar} className="h-9 rounded-[10px] px-3 md:h-8">
                  <Plus aria-hidden="true" /> Registrar atendimentos
                </Button>
              ) : null}
              {temContas ? (
                <Button
                  variant="outline" size="sm" nativeButton={false} className="h-9 rounded-[10px] px-3 md:h-8"
                  render={<Link href={item.contas!.vencidas.length > 0 ? '/financeiro-ag/pagar?status=VENCIDO' : '/financeiro-ag/pagar'} />}
                >
                  Abrir contas a pagar
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </BarraDoTom>
    </li>
  );
}

/**
 * O rodapé do gráfico: o mesmo ritmo das metas (a fração de dias úteis), em
 * três números. No mês aberto: o que o plano pedia até hoje, a diferença e o
 * que falta por dia útil. No mês fechado: o plano, a diferença e o resultado.
 */
function RodapeDoRitmo({ item, cal }: { item: ItemDoPlano; cal: Calendario }) {
  const planejado = item.planejado ?? 0;
  const realizado = item.realizado ?? 0;
  const pedia = cal.aberto ? Math.round(planejado * cal.fracao * 100) / 100 : planejado;
  const diferenca = Math.round((realizado - pedia) * 100) / 100;
  const restam = Math.max(0, cal.diasUteis - cal.diasUteisPassados);
  const falta = Math.max(0, planejado - realizado);
  const numeros: Array<{ rotulo: string; valor: string; tom?: TomDoPainel }> = [
    { rotulo: cal.aberto ? 'O plano pedia até hoje' : 'O plano do mês', valor: formatBRL(pedia) },
    { rotulo: diferenca >= 0 ? 'À frente do ritmo' : 'Atrás do ritmo', valor: formatBRL(Math.abs(diferenca)), tom: diferenca >= 0 ? 'positivo' : 'negativo' },
    !cal.aberto
      ? { rotulo: 'Realizado no mês', valor: formatBRL(realizado) }
      : falta <= 0
        ? { rotulo: 'Meta do mês', valor: 'Atingida', tom: 'positivo' }
        : restam > 0
          ? { rotulo: `Por dia útil, nos ${restam} que restam`, valor: formatBRL(falta / restam) }
          : { rotulo: 'Falta para a meta', valor: formatBRL(falta) },
  ];
  return (
    <dl className="grid grid-cols-1 gap-[var(--fin-s-2)] rounded-[16px] bg-[var(--fin-surface-sunken)] px-4 py-3 sm:grid-cols-3">
      {numeros.map(n => (
        <div key={n.rotulo} className="flex min-w-0 flex-col gap-0.5">
          <dt className="fin-t-caption truncate text-[var(--fin-text-3)]">{n.rotulo}</dt>
          <dd
            className="fin-t-body-strong tabular-nums"
            style={{ color: n.tom === 'negativo' ? 'var(--fin-negative-text)' : n.tom === 'positivo' ? 'var(--fin-positive)' : 'var(--fin-text)' }}
          >
            {n.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ============================================================
// O painel
// ============================================================

export function Acompanhamento({
  mes, mesPorExtenso, plano, rel, planoSalvo, salvandoPlano, podeEditar, onEditarPlano, onSalvarPlano,
}: {
  mes: string;
  mesPorExtenso: string;
  /** O plano que está na aba Plano do mês: o salvo ou o sugerido. */
  plano: CustosData;
  rel: Relatorio;
  planoSalvo: boolean;
  salvandoPlano: boolean;
  podeEditar: boolean;
  onEditarPlano: () => void;
  onSalvarPlano: () => void;
}) {
  const [realizado, setRealizado] = useState<RealizadoDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [registrando, setRegistrando] = useState(false);
  const [form, setForm] = useState({ valor: '', data: hojeISO(), observacao: '' });
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const res = await fetch(`/api/planejamento/realizado?mes=${encodeURIComponent(mes)}`, { cache: 'no-store' });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error || 'Não foi possível carregar o realizado do mês.');
      setRealizado(corpo as RealizadoDoMes);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o realizado do mês.');
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => { void carregar(); }, [carregar]);

  // O MESMO plano da aba Plano do mês (salvo ou sugerido): as duas abas nunca
  // mostram números diferentes. Editar uma meta muda tudo aqui na hora.
  const painel = useMemo(
    () => (realizado ? montarAcompanhamento({ plano, rel, realizado }) : null),
    [realizado, plano, rel],
  );

  const abrirRegistro = () => {
    const ultimo = realizado ? ultimoRegistro(realizado.registros, 'atendimentos') : null;
    const hoje = hojeISO();
    const [a, m] = mes.split('-').map(Number);
    const fimDoMes = `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
    // Num mês que já passou, o registro é do último dia dele.
    setForm({ valor: ultimo ? String(ultimo.valor) : '', data: hoje.slice(0, 7) > mes ? fimDoMes : hoje, observacao: '' });
    setErroForm(null);
    setRegistrando(true);
  };

  const gravar = async () => {
    setGravando(true);
    setErroForm(null);
    try {
      const res = await fetch('/api/planejamento/progresso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: 'atendimentos', valor: Number(form.valor), data: form.data, observacao: form.observacao }),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error || 'Não foi possível gravar o registro.');
      setRegistrando(false);
      await carregar();
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : 'Não foi possível gravar o registro.');
    } finally {
      setGravando(false);
    }
  };

  const apagar = async (id: string) => {
    const res = await fetch(`/api/planejamento/progresso?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) await carregar();
    else setErro('Não foi possível apagar o registro.');
  };

  const porChave = painel
    ? Object.fromEntries(painel.areas.flatMap(a => a.itens).map(i => [i.chave, i])) as Record<ItemDoPlano['chave'], ItemDoPlano>
    : null;
  const cal = painel?.calendario ?? null;
  const crm = realizado ? metricasDoCrm(realizado) : null;
  // As mini barras param em hoje no mês aberto: dia que não chegou não é zero.
  const ateHoje = (serie: number[]) =>
    serie.slice(0, Math.max(1, cal?.aberto && realizado ? Number(realizado.hoje.slice(8, 10)) : serie.length));

  // ── Os quatro números do topo (o "Volume e resultado" das Análises) ──────
  const numeros: NumeroDoPainel[] = porChave && realizado && cal ? [
    {
      rotulo: 'Receita de comissões', icone: ArrowDownLeft, tom: 'acento',
      valor: reais(realizado.comissao), valorCompleto: formatBRL(realizado.comissao),
      sub: porChave.comissao.planejado !== null ? `de ${reais(porChave.comissao.planejado)} planejados` : 'sem meta no plano',
      selo: seloDoPlano(porChave.comissao),
      barras: realizado.diario ? { valores: baldes(ateHoje(realizado.diario.comissao)), rotulo: 'Comissão ao longo do mês' } : null,
      href: '/financeiro-ag/receber',
    },
    {
      rotulo: 'Vendas fechadas', icone: ShoppingBag, tom: 'positivo',
      valor: String(porChave.vendas.realizado ?? 0),
      sub: porChave.vendas.planejado !== null ? `de ${porChave.vendas.planejado} planejadas` : 'sem meta no plano',
      selo: seloDoPlano(porChave.vendas),
      // As barras contam o mesmo que o número: as ganhas no CRM, ou as vendas do financeiro sem ele.
      barras: crm
        ? { valores: baldes(ateHoje(crm.por_dia.ganhas)), rotulo: 'Vendas ganhas no CRM ao longo do mês' }
        : realizado.diario ? { valores: baldes(ateHoje(realizado.diario.vendas)), rotulo: 'Vendas ao longo do mês' } : null,
      href: '/vendas',
    },
    {
      rotulo: 'Leads atendidos', icone: Users, tom: 'info',
      valor: porChave.atendimentos.realizado === null ? '—' : String(porChave.atendimentos.realizado),
      sub: porChave.atendimentos.realizado === null
        ? 'sem dados neste mês'
        : porChave.atendimentos.planejado !== null
          ? `de ${valor(porChave.atendimentos.planejado, 'contagem')} planejados${crm ? ', no CRM' : ''}`
          : crm ? 'negociações do mês no CRM' : 'registrados à mão',
      selo: seloDoPlano(porChave.atendimentos),
      anel: porChave.atendimentos.progresso !== null ? { pct: porChave.atendimentos.progresso, rotulo: `${Math.round(porChave.atendimentos.progresso)}% dos atendimentos planejados` } : null,
      aviso: !crm && porChave.atendimentos.realizado === null ? porChave.atendimentos.fonte : undefined,
    },
    {
      rotulo: cal.aberto ? 'Lucro até agora' : 'Lucro do mês', icone: realizado.lucro < 0 ? TrendingDown : Wallet,
      tom: realizado.lucro < 0 ? 'negativo' : 'acento',
      valor: reais(realizado.lucro), valorCompleto: formatBRL(realizado.lucro),
      sub: porChave.lucro.situacao === 'sem_dados'
        ? 'sem custos do mês lançados: ainda não desconta a estrutura'
        : porChave.lucro.planejado !== null ? `de ${reais(porChave.lucro.planejado)} desejados${cal.aberto ? ', provisório' : ''}` : 'comissão menos os custos do mês',
      selo: { tom: tomDaSituacao(porChave.lucro.situacao), texto: rotuloStatus('plano', porChave.lucro.situacao), dica: porChave.lucro.porque },
      anel: porChave.lucro.progresso !== null && porChave.lucro.progresso > 0 ? { pct: porChave.lucro.progresso, rotulo: `${Math.round(porChave.lucro.progresso)}% do lucro desejado` } : null,
      href: '/relatorios/lucro-real',
    },
  ] : [];

  const ritmo = porChave?.comissao.planejado ? ritmoDoPlano(mes, porChave.comissao.planejado) : [];

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      {!planoSalvo ? (
        <Callout
          tom="aviso"
          titulo="Este é o plano sugerido, ainda não salvo"
          acao={podeEditar ? { rotulo: 'Salvar como plano do mês', onClick: onSalvarPlano, carregando: salvandoPlano } : undefined}
          acaoSecundaria={podeEditar ? { rotulo: 'Revisar o plano', onClick: onEditarPlano } : undefined}
        >
          As metas abaixo saem dos valores que a tela preenche sozinha: ticket de {formatBRL(plano.ticket_medio)}, {plano.margem_comissao}% de comissão,
          {' '}{plano.taxa_conversao}% de conversão e {formatBRL(plano.lucro_desejado)} de lucro. Revise e salve para acompanhar o seu plano.
        </Callout>
      ) : null}

      <DataState
        estado={carregando ? 'carregando' : erro && !realizado ? 'erro' : 'ok'}
        erro={erro && !realizado ? { mensagem: erro, onTentarDeNovo: () => { setCarregando(true); void carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-4)]">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map(i => <div key={i} className={cn(CARTAO_DO_PAINEL, 'h-[168px] animate-pulse')} />)}
            </div>
            <div className={cn(CARTAO_DO_PAINEL, 'h-[320px] animate-pulse')} />
          </div>
        }
      >
        {painel && porChave && realizado && cal ? (
          <div className="flex flex-col">
            {/* ── O mês contra o plano ─────────────────────────────────── */}
            <TituloDeSecao
              extra={
                <span className="inline-flex flex-wrap items-center gap-[var(--fin-s-2)]">
                  {cal.aberto
                    ? `dia útil ${cal.diasUteisPassados} de ${cal.diasUteis} · ${Math.round(cal.fracao * 100)}% do mês`
                    : cal.futuro ? 'o mês ainda não começou' : 'mês encerrado'}
                  {/* De onde vêm leads e vendas: o CRM, ou por que não. */}
                  {crm
                    ? <SeloDoTom tom="positivo" title="Leads e vendas fechadas com as contas das Análises do CRM (funis de vendas)">Leads e vendas do CRM</SeloDoTom>
                    : realizado.crm
                      ? <SeloDoTom tom="aviso" title={realizado.crm.situacao !== 'ok' ? realizado.crm.detalhe : undefined}>Sem os números do CRM</SeloDoTom>
                      : null}
                </span>
              }
            >
              O mês contra o plano
            </TituloDeSecao>
            <p className="fin-t-body mt-[var(--fin-s-2)] text-[var(--fin-text-2)]">{painel.frase}</p>
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {numeros.map(n => <CartaoDeNumero key={n.rotulo} n={n} />)}
            </div>

            {/* ── O ritmo e o que precisa de atenção ───────────────────── */}
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <section aria-labelledby="pl-ritmo" className={cn(CARTAO_DO_PAINEL, 'flex min-w-0 flex-col gap-[var(--fin-s-4)] p-[22px]')}>
                <CabecaDoBloco id="pl-ritmo" tom="acento" icone={ChartLine} titulo="O ritmo do mês" sub="Comissão acumulada contra o que o plano pedia até cada dia">
                  <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
                    <SeloDoTom tom="acento">Realizado {formatBRL(realizado.comissao)}</SeloDoTom>
                    {ritmo.length ? <SeloDoTom tom="neutro">Plano {formatBRL(ritmo[ritmo.length - 1])}</SeloDoTom> : null}
                  </div>
                </CabecaDoBloco>
                {realizado.diario ? (
                  <RitmoDoMes
                    mes={mes}
                    comissaoPorDia={realizado.diario.comissao}
                    ritmo={ritmo}
                    diaDeHoje={cal.futuro ? 0 : cal.aberto ? Number(realizado.hoje.slice(8, 10)) : realizado.diario.comissao.length}
                  />
                ) : null}
                {porChave.comissao.planejado !== null && !cal.futuro ? <RodapeDoRitmo item={porChave.comissao} cal={cal} /> : null}
              </section>

              <section aria-labelledby="pl-atencao" className={cn(CARTAO_DO_PAINEL, 'flex min-w-0 flex-col gap-[var(--fin-s-4)] p-[22px]')}>
                <CabecaDoBloco
                  id="pl-atencao"
                  tom={painel.atencao.some(p => p.tom === 'negativo') ? 'negativo' : painel.atencao.length ? 'aviso' : 'positivo'}
                  icone={painel.atencao.length ? TriangleAlert : CircleCheck}
                  titulo="Precisa da sua atenção"
                  sub={painel.atencao.length === 0 ? 'Nada fora do plano agora' : `${painel.atencao.length} ${painel.atencao.length === 1 ? 'ponto' : 'pontos'}, do mais urgente para o menos`}
                />
                {painel.atencao.length === 0 ? (
                  <p className="fin-t-body flex items-center gap-[var(--fin-s-2)] rounded-[12px] bg-[var(--fin-positive-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-3)] text-[var(--fin-positive)]">
                    <CircleCheck aria-hidden="true" className="size-4" /> Tudo no ritmo do plano.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-[18px]">
                    {painel.atencao.map((p, n) => {
                      const Icone = ICONE_DO_PONTO[p.chave];
                      const tom: TomDoPainel = p.tom === 'negativo' ? 'negativo' : 'aviso';
                      return (
                        <li key={`${p.chave}-${n}`} className="flex flex-col gap-1.5">
                          <span className="flex items-center gap-2.5">
                            <Icone aria-hidden="true" className={cn('size-4 shrink-0', tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-warning-text)]')} />
                            <span className="fin-t-body-strong min-w-0 flex-1 text-[var(--fin-text)]">{p.titulo}</span>
                            {p.acao?.href ? (
                              <Link href={p.acao.href} className="fin-t-caption inline-flex shrink-0 items-center gap-1 font-medium text-[var(--fin-accent)] hover:underline">
                                {p.acao.rotulo} <ArrowRight aria-hidden="true" className="size-3.5" />
                              </Link>
                            ) : p.acao?.registrar && podeEditar ? (
                              <button type="button" onClick={abrirRegistro} className="fin-t-caption inline-flex shrink-0 items-center gap-1 font-medium text-[var(--fin-accent)] hover:underline">
                                {p.acao.rotulo} <ArrowRight aria-hidden="true" className="size-3.5" />
                              </button>
                            ) : null}
                          </span>
                          <span className="fin-t-caption pl-[26px] tabular-nums text-[var(--fin-text-3)]">{p.detalhe}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            {/* ── Por área ─────────────────────────────────────────────── */}
            <div className="mt-[34px]">
              <TituloDeSecao extra="planejado, realizado, o que falta e a marca de onde o plano pedia estar hoje">Por área</TituloDeSecao>
            </div>
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
              {painel.areas.map(area => (
                <section key={area.id} aria-labelledby={`pl-area-${area.id}`} className={cn(CARTAO_DO_PAINEL, 'flex min-w-0 flex-col gap-[var(--fin-s-5)] p-[22px]')}>
                  <CabecaDoBloco id={`pl-area-${area.id}`} tom={TOM_DA_AREA[area.id]} icone={ICONE_DA_AREA[area.id]} titulo={area.titulo} sub={SOBRE_A_AREA[area.id]} />
                  <ul className="flex flex-col gap-[22px]">
                    {area.itens.map(item => (
                      <LinhaDoItem
                        key={item.chave}
                        item={item}
                        podeEditar={podeEditar}
                        onRegistrar={item.registravel ? abrirRegistro : undefined}
                        registros={item.chave === 'atendimentos' && !crm ? realizado.registros.filter(r => r.chave === 'atendimentos') : undefined}
                        onApagarRegistro={item.chave === 'atendimentos' ? (id => void apagar(id)) : undefined}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {/* ── As premissas contra o mês ────────────────────────────── */}
            <div className="mt-[34px]">
              <TituloDeSecao extra="as metas partem destes números">As premissas do plano no mês</TituloDeSecao>
            </div>
            <ul className="mt-3.5 grid grid-cols-1 gap-3 md:grid-cols-2">
              {painel.indicadores.map((i: IndicadorDoPlano) => {
                const v = (x: number | null) => {
                  if (x === null) return '—';
                  if (i.formato === 'percentual') return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
                  return i.formato === 'dinheiro' ? formatBRL(x) : String(x);
                };
                const s = i.realizado === null ? 'sem_dados' : i.desvio ? 'abaixo' : 'em_linha';
                return (
                  <li key={i.titulo} className={cn(CARTAO_DO_PAINEL, 'flex items-center gap-3.5 px-5 py-[18px]')}>
                    <span className="min-w-0 flex-1">
                      <span className="fin-t-body-strong block text-[var(--fin-text)]">{i.titulo}</span>
                      <span className="fin-t-caption mt-[3px] block text-[var(--fin-text-3)]">{i.nota}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{v(i.realizado)}</span>
                      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">plano {v(i.planejado)}</span>
                    </span>
                    <SeloDoTom tom={tomDaSituacao(s)}>{rotuloStatus('plano', s)}</SeloDoTom>
                  </li>
                );
              })}
            </ul>

            <p className="fin-t-caption mt-[var(--fin-s-5)] text-[var(--fin-text-3)]">
              O realizado conta desde o dia 1 de {mesPorExtenso}, com a mesma régua do relatório Lucro real, mesmo que o plano tenha sido feito depois. Editar o plano refaz as metas e não apaga nenhum registro.
            </p>
          </div>
        ) : null}
      </DataState>

      <RecordSheet
        aberto={registrando}
        onOpenChange={setRegistrando}
        titulo="Registrar atendimentos"
        descricao="O financeiro não recebe os leads do CRM. Informe quantos foram atendidos no mês até o dia escolhido: o número é comparado com o ritmo do plano naquele dia."
        largura={480}
        acaoPrimaria={{ rotulo: 'Registrar', onClick: gravar, carregando: gravando, desabilitado: form.valor === '' }}
        acaoSecundaria={{ rotulo: 'Cancelar', onClick: () => setRegistrando(false) }}
      >
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <Field rotulo="Atendimentos no mês até o dia" obrigatorio erro={erroForm}>
            {a => (
              <input
                {...a}
                type="number" inputMode="numeric" min={0} step={1}
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                className={cn(CAMPO, 'tabular-nums')}
              />
            )}
          </Field>
          <Field rotulo="Até o dia" ajuda="O total acumulado no mês até este dia, não só o do dia.">
            {a => (
              <input
                {...a}
                type="date" min={`${mes}-01`} max={hojeISO()}
                value={form.data}
                onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                className={CAMPO}
              />
            )}
          </Field>
          <Field rotulo="Observação" ajuda="Opcional. Ex.: contei pelo relatório do CRM.">
            {a => (
              <input
                {...a}
                type="text" maxLength={280}
                value={form.observacao}
                onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                className={CAMPO}
              />
            )}
          </Field>
        </div>
      </RecordSheet>
    </div>
  );
}
