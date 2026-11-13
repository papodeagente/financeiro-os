'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowUpRight, ChartColumn, CircleCheck, Gauge, Megaphone, Percent, Plus, Scale,
  ShoppingBag, Trash2, TrendingDown, TrendingUp, TriangleAlert, Users, type LucideIcon,
} from 'lucide-react';

import type { CustosData, Relatorio } from '@/lib/planejamento-custos';
import {
  montarAcompanhamento, ultimoRegistro,
  type ContaDoMes, type IndicadorDoPlano, type ItemDoPlano, type PontoDeAtencao, type RealizadoDoMes, type Situacao,
} from '@/lib/plano-do-mes';
import { cn, formatBRL } from '@/lib/utils';
import { hojeISO } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Meter, type Faixa } from '@/components/fin/Meter';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Resposta, type TomDoChip } from '@/components/fin/Resposta';
import { StatusChip, rotuloStatus } from '@/components/fin/StatusChip';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const CAMPO = 'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const ICONE: Record<PontoDeAtencao['chave'], LucideIcon> = {
  vendas: ShoppingBag, atendimentos: Users, faturamento: ChartColumn, comissao: ArrowDownLeft,
  custos_fixos: ArrowUpRight, marketing: Megaphone, custos_variaveis: Percent, equilibrio: Scale,
  lucro: TrendingUp, indicador: Gauge,
};

const SOBRE_A_AREA: Record<string, string> = {
  comercial: 'Vendas e atendimentos, contra o ritmo do mês.',
  receita: 'O que entrou para a agência e o volume vendido.',
  custos: 'O que foi lançado e pago nas contas a pagar do mês.',
  resultado: 'Se as vendas já pagaram a estrutura, e o que sobrou.',
};

function valor(v: number | null, formato: ItemDoPlano['formato']): string {
  if (v === null) return '—';
  return formato === 'dinheiro' ? formatBRL(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}` : iso;
}

/** A cor da barra. Em custo ela mede o PAGO: o atraso fica no selo e na lista de vencidas. */
function faixaDoItem(item: ItemDoPlano): Faixa {
  if (item.sentido === 'limitar') return item.situacao === 'acima' ? 'atencao' : 'saudavel';
  return item.situacao === 'atrasado' ? 'critico' : 'saudavel';
}

function tomDoChip(s: Situacao): TomDoChip {
  if (s === 'concluido') return 'positivo';
  if (s === 'atrasado') return 'negativo';
  if (s === 'acima') return 'aviso';
  return 'neutro';
}

/** Onde o ritmo pedia estar, no número do item ("o ritmo pedia 8"). */
function esperadoDoItem(item: ItemDoPlano): string | null {
  if (item.esperadoPct === null || item.planejado === null) return null;
  const bruto = (item.planejado * item.esperadoPct) / 100;
  return valor(item.formato === 'contagem' ? Math.round(bruto) : bruto, item.formato);
}

// ============================================================
// Um item do plano
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
  const esperado = esperadoDoItem(item);
  const descricaoDaBarra = limitar
    ? `${valor(item.realizado, item.formato)} pagos de ${valor(item.planejado, item.formato)} planejados.`
    : `${valor(item.realizado, item.formato)} de ${valor(item.planejado, item.formato)}.${esperado ? ` O ritmo pedia ${esperado} até agora.` : ''}`;

  return (
    <li className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="fin-t-body-strong text-[var(--fin-text)]">{item.titulo}</h3>
          <p className="fin-t-caption text-[var(--fin-text-2)]">{item.porque}</p>
        </div>
        <StatusChip dominio="plano" valor={item.situacao} />
      </div>

      <dl className="grid grid-cols-3 gap-[var(--fin-s-3)]">
        <div className="min-w-0">
          <dt className="fin-t-caption text-[var(--fin-text-3)]">{limitar ? 'Teto planejado' : 'Planejado'}</dt>
          <dd className="fin-t-body tabular-nums text-[var(--fin-text)]">{valor(item.planejado, item.formato)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="fin-t-caption text-[var(--fin-text-3)]">{item.contas ? 'Pago' : 'Realizado'}</dt>
          <dd className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{item.situacao === 'sem_dados' ? 'Sem dados' : valor(item.realizado, item.formato)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="fin-t-caption text-[var(--fin-text-3)]">{porVenda ? 'Diferença' : limitar ? 'Falta pagar' : 'Falta'}</dt>
          <dd className="fin-t-body tabular-nums text-[var(--fin-text)]">
            {porVenda
              ? (item.realizado === null || item.planejado === null
                ? '—'
                : `${item.realizado >= item.planejado ? '+' : '−'}${formatBRL(Math.abs(item.realizado - item.planejado))}`)
              : item.falta === null ? '—' : item.falta === 0 ? 'Nada' : valor(item.falta, item.formato)}
          </dd>
        </div>
      </dl>

      {item.progresso !== null && !porVenda ? (
        <Meter
          pct={item.progresso}
          faixa={faixaDoItem(item)}
          rotulo={limitar ? 'Pago do planejado' : 'Do planejado'}
          descricao={descricaoDaBarra}
          size="sm"
          marca={item.esperadoPct !== null ? { pct: item.esperadoPct, rotulo: 'Onde o plano pedia estar hoje' } : null}
        />
      ) : null}

      {temContas ? (
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <ListaDeContas titulo={`Vencidas (${item.contas!.vencidas.length})`} contas={item.contas!.vencidas} vencidas />
          <ListaDeContas titulo={`A vencer (${item.contas!.aVencer.length})`} contas={item.contas!.aVencer} />
        </div>
      ) : null}

      {registros && registros.length > 0 ? (
        <ul className="flex flex-col rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-3)] py-[var(--fin-s-1)]" aria-label="Registros de atendimentos">
          {registros.slice(0, 5).map(r => (
            <li key={r.id} className="flex items-center justify-between gap-[var(--fin-s-2)]">
              <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-2)]">
                <b className="font-semibold tabular-nums text-[var(--fin-text)]">{r.valor}</b> até {dataBR(r.data)}
                {r.autor ? `, ${r.autor}` : ''}{r.observacao ? `: ${r.observacao}` : ''}
              </span>
              {podeEditar && onApagarRegistro ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onApagarRegistro(r.id)}
                  aria-label={`Apagar o registro de ${r.valor} atendimentos em ${dataBR(r.data)}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
        <p className="fin-t-caption text-[var(--fin-text-3)]">{item.fonte}</p>
        {item.registravel && podeEditar && onRegistrar ? (
          <Button variant="outline" size="sm" onClick={onRegistrar} className="h-9 px-3 md:h-8">
            <Plus aria-hidden="true" /> Registrar atendimentos
          </Button>
        ) : null}
        {temContas ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={item.contas!.vencidas.length > 0 ? '/financeiro-ag/pagar?status=VENCIDO' : '/financeiro-ag/pagar'} />}
            className="h-9 px-3 md:h-8"
          >
            Abrir contas a pagar
          </Button>
        ) : null}
      </div>
    </li>
  );
}

// ============================================================
// O painel
// ============================================================

type LinhaPremissa = IndicadorDoPlano & { id: string };

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

  const colunasPremissas = useMemo<FinColuna<LinhaPremissa>[]>(() => {
    const v = (i: IndicadorDoPlano, x: number | null) => {
      if (x === null) return '—';
      if (i.formato === 'percentual') return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
      return i.formato === 'dinheiro' ? formatBRL(x) : String(x);
    };
    return [
      {
        id: 'premissa', cabecalho: 'Premissa', tipo: 'texto', minWidth: 200,
        render: i => (
          <span className="flex flex-col">
            <span className="fin-t-body text-[var(--fin-text)]">{i.titulo}</span>
            <span className="fin-t-caption text-[var(--fin-text-3)]">{i.nota}</span>
          </span>
        ),
      },
      { id: 'plano', cabecalho: 'No plano', tipo: 'texto', render: i => <span className="tabular-nums">{v(i, i.planejado)}</span> },
      { id: 'mes', cabecalho: 'No mês', tipo: 'texto', render: i => <span className="fin-t-body-strong tabular-nums">{v(i, i.realizado)}</span> },
      {
        id: 'situacao', cabecalho: 'Situação', tipo: 'status', dominio: 'plano', prioridade: 1,
        valor: i => (i.realizado === null ? 'sem_dados' : i.desvio ? 'abaixo' : 'em_linha'),
      },
    ];
  }, []);

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
  const comissao = porChave?.comissao ?? null;
  const cal = painel?.calendario ?? null;
  const chipDaResposta = comissao && comissao.situacao !== 'sem_meta' && cal
    ? {
        icone: comissao.situacao === 'atrasado' ? TrendingDown : comissao.situacao === 'concluido' ? CircleCheck : TrendingUp,
        rotulo: comissao.situacao === 'pendente' && cal.aberto
          ? 'No ritmo do plano'
          : comissao.situacao === 'atrasado' && cal.aberto ? 'Abaixo do ritmo' : rotuloStatus('plano', comissao.situacao),
        tom: tomDoChip(comissao.situacao),
      }
    : null;

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
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className={cn(CARTAO, 'h-[160px] animate-pulse')} />
            <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map(i => <div key={i} className={cn(CARTAO, 'h-[112px] animate-pulse')} />)}
            </div>
          </div>
        }
      >
        {painel && porChave && realizado && cal && comissao ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {/* ── A resposta: a receita do mês contra o plano ──────────── */}
            <Resposta
              overline={`RECEITA DE COMISSÕES EM ${mesPorExtenso.toUpperCase()}`}
              valor={<Money valor={realizado.comissao} size="resposta" align="esquerda" estado="ok" />}
              frase={`${painel.frase}${comissao.planejado !== null ? ` ${formatBRL(realizado.comissao)} de ${formatBRL(comissao.planejado)} planejados em comissões.` : ''}`}
              chip={chipDaResposta}
              marca={comissao.progresso !== null ? (
                <div className="w-full max-w-[520px]">
                  <Meter
                    pct={comissao.progresso}
                    faixa={faixaDoItem(comissao)}
                    rotulo={cal.aberto ? `Dia útil ${cal.diasUteisPassados} de ${cal.diasUteis}` : 'Do planejado'}
                    descricao={comissao.esperadoPct !== null ? 'A marca mostra onde o plano pedia estar hoje.' : 'Do planejado para o mês.'}
                    marca={comissao.esperadoPct !== null ? { pct: comissao.esperadoPct, rotulo: 'Onde o plano pedia estar hoje' } : null}
                  />
                </div>
              ) : undefined}
            />

            {/* ── Os indicadores do mês ────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                rotulo="Vendas fechadas" icone={ShoppingBag} formato="contagem"
                valor={porChave.vendas.realizado} estado="ok"
                contexto={porChave.vendas.planejado !== null
                  ? `de ${porChave.vendas.planejado} planejadas: ${rotuloStatus('plano', porChave.vendas.situacao).toLowerCase()}`
                  : 'sem meta de vendas no plano'}
              />
              <MetricCard
                rotulo="Leads atendidos" icone={Users} formato="contagem"
                valor={porChave.atendimentos.realizado}
                estado={porChave.atendimentos.realizado === null ? 'indisponivel' : 'ok'}
                contexto={porChave.atendimentos.realizado === null
                  ? 'sem registro: o financeiro não recebe os leads do CRM'
                  : `de ${valor(porChave.atendimentos.planejado, 'contagem')} planejados. ${porChave.atendimentos.fonte}`}
              />
              <MetricCard
                rotulo="Faturamento" icone={ChartColumn}
                valor={realizado.faturamento} estado="ok"
                contexto={porChave.faturamento.planejado !== null
                  ? `de ${formatBRL(porChave.faturamento.planejado)} planejados, volume vendido`
                  : 'volume vendido, a maior parte é do fornecedor'}
              />
              <MetricCard
                rotulo={cal.aberto ? 'Lucro até agora' : 'Lucro do mês'} icone={realizado.lucro < 0 ? TrendingDown : TrendingUp}
                valor={realizado.lucro} estado="ok" tone={realizado.lucro < 0 ? 'negativo' : 'neutro'}
                contexto={porChave.lucro.planejado !== null
                  ? `de ${formatBRL(porChave.lucro.planejado)} desejados${cal.aberto ? ', provisório' : ''}`
                  : cal.aberto ? 'provisório até o fim do mês' : 'comissão menos custos do mês'}
                explicacao={porChave.lucro.porque}
              />
            </div>

            {/* ── O que precisa de atenção ─────────────────────────────── */}
            <section aria-labelledby="t-atencao" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)]')}>
              <div>
                <h2 id="t-atencao" className="fin-t-subhead text-[var(--fin-text)]">Precisa da sua atenção</h2>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  {painel.atencao.length === 0
                    ? 'Nada fora do plano agora.'
                    : `${painel.atencao.length} ${painel.atencao.length === 1 ? 'ponto' : 'pontos'}, do mais urgente para o menos.`}
                </p>
              </div>
              {painel.atencao.length === 0 ? (
                <p className="fin-t-body flex items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-positive-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-3)] text-[var(--fin-positive)]">
                  <CircleCheck aria-hidden="true" className="size-4" />
                  Tudo no ritmo do plano.
                </p>
              ) : (
                <ul className="flex flex-col gap-[var(--fin-s-2)]">
                  {painel.atencao.map((p, n) => {
                    const Icone = p.tom === 'negativo' ? TriangleAlert : ICONE[p.chave];
                    return (
                      <li key={`${p.chave}-${n}`} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)] sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-8 items-center justify-center rounded-[var(--fin-r-md)]',
                            p.tom === 'negativo' ? 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]' : 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
                          )}
                        >
                          <Icone className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="fin-t-body block font-medium text-[var(--fin-text)]">{p.titulo}</span>
                          <span className="fin-t-caption block tabular-nums text-[var(--fin-text-3)]">{p.detalhe}</span>
                        </span>
                        {p.acao?.href ? (
                          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={p.acao.href} />} className="col-start-2 h-9 justify-self-start px-3 sm:col-start-3 md:h-8">
                            {p.acao.rotulo}
                          </Button>
                        ) : p.acao?.registrar && podeEditar ? (
                          <Button variant="outline" size="sm" onClick={abrirRegistro} className="col-start-2 h-9 justify-self-start px-3 sm:col-start-3 md:h-8">
                            {p.acao.rotulo}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ── Por área ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 items-start gap-[var(--fin-s-5)] xl:grid-cols-2">
              {painel.areas.map(area => (
                <section key={area.id} aria-labelledby={`t-area-${area.id}`} className={cn(CARTAO, 'overflow-hidden')}>
                  <div className="border-b border-[var(--fin-border)] px-[var(--fin-s-5)] pb-[var(--fin-s-3)] pt-[var(--fin-s-4)]">
                    <h2 id={`t-area-${area.id}`} className="fin-t-subhead text-[var(--fin-text)]">{area.titulo}</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">{SOBRE_A_AREA[area.id]}</p>
                  </div>
                  <ul className="divide-y divide-[var(--fin-border)]">
                    {area.itens.map(item => (
                      <LinhaDoItem
                        key={item.chave}
                        item={item}
                        podeEditar={podeEditar}
                        onRegistrar={item.registravel ? abrirRegistro : undefined}
                        registros={item.chave === 'atendimentos' ? realizado.registros.filter(r => r.chave === 'atendimentos') : undefined}
                        onApagarRegistro={item.chave === 'atendimentos' ? (id => void apagar(id)) : undefined}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {/* ── As premissas contra o mês ────────────────────────────── */}
            <section aria-labelledby="t-premissas" className="flex flex-col gap-[var(--fin-s-3)]">
              <div>
                <h2 id="t-premissas" className="fin-t-subhead text-[var(--fin-text)]">As premissas do plano no mês</h2>
                <p className="fin-t-caption text-[var(--fin-text-3)]">As metas partem destes números: se eles mudam, o plano muda junto.</p>
              </div>
              <FinTable<LinhaPremissa>
                linhas={painel.indicadores.map(i => ({ ...i, id: i.titulo }))}
                colunas={colunasPremissas}
                chave={i => i.id}
                densidade="compacta"
                estado="ok"
                vazio={{ motivo: 'sem-dado', titulo: 'Sem premissas', oQueE: 'Aqui aparecem as premissas do plano contra o que aconteceu no mês.' }}
              />
            </section>

            <p className="fin-t-caption text-[var(--fin-text-3)]">
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
