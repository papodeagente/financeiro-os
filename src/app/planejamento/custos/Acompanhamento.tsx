'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check, Clock, Info, Loader2, PencilLine, Plus, RefreshCw, Trash2 } from 'lucide-react';

import type { CustosData, Relatorio } from '@/lib/planejamento-custos';
import {
  montarAcompanhamento, ROTULO_SITUACAO, ultimoRegistro,
  type ItemDoPlano, type RealizadoDoMes, type Situacao, type IndicadorDoPlano, type ContaDoMes,
} from '@/lib/plano-do-mes';
import { formatBRL } from '@/lib/utils';
import { hojeISO } from '@/lib/money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import { cn } from '@/lib/utils';

// ============================================================
// Vocabulário visual da situação (só tokens do design system)
// ============================================================

const CHIP: Record<Situacao, string> = {
  concluido: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  pendente: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
  atrasado: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
  acima: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  sem_dados: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
  sem_meta: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]',
};

const BARRA: Record<Situacao, string> = {
  concluido: 'bg-[var(--fin-positive)]',
  pendente: 'bg-[var(--fin-accent)]',
  atrasado: 'bg-[var(--fin-negative)]',
  acima: 'bg-[var(--fin-warning)]',
  sem_dados: 'bg-transparent',
  sem_meta: 'bg-[var(--fin-text-3)]',
};

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

function Chip({ situacao }: { situacao: Situacao }) {
  return (
    <span className={cn('fin-t-caption inline-flex shrink-0 items-center gap-1 rounded-[var(--fin-r-sm)] px-2 py-0.5 font-medium', CHIP[situacao])}>
      {ROTULO_SITUACAO[situacao]}
    </span>
  );
}

function valor(v: number | null, formato: ItemDoPlano['formato']): string {
  if (v === null) return '—';
  return formato === 'dinheiro' ? formatBRL(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}` : iso;
}

/**
 * Em custo a barra mede o que já foi PAGO: pintá-la de vermelho por causa de
 * uma conta vencida faria 86% pagos parecerem 86% de atraso. O atraso fica no
 * selo e na lista de vencidas; a barra só avisa quando o gasto passa do plano.
 */
function corDaBarra(item: ItemDoPlano): string {
  if (item.sentido === 'limitar') {
    if (item.situacao === 'acima') return BARRA.acima;
    if (item.situacao === 'concluido') return BARRA.concluido;
    return BARRA.pendente;
  }
  return BARRA[item.situacao];
}

/**
 * A barra do ritmo: quanto do planejado já foi feito, e a marca de onde o
 * plano diz que deveria estar hoje. É a leitura do item num relance: a barra
 * passou da marca, está no ritmo; ficou antes, está atrás.
 */
function BarraDoRitmo({ item, compacta = false }: { item: ItemDoPlano; compacta?: boolean }) {
  const p = item.progresso;
  if (p === null) {
    return (
      <div
        className={cn('rounded-full border border-dashed border-[var(--fin-border-strong)]', compacta ? 'h-[6px]' : 'h-[8px]')}
        aria-hidden="true"
      />
    );
  }
  const largura = Math.min(100, Math.max(0, p));
  const marca = item.esperadoPct !== null && item.esperadoPct > 0 && item.esperadoPct < 100 ? item.esperadoPct : null;
  return (
    <div className="relative">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(largura)}
        aria-label={`${item.titulo}: ${Math.round(p)}% do planejado${marca !== null ? `; o ritmo pedia ${Math.round(marca)}% até hoje` : ''}`}
        className={cn('overflow-hidden rounded-full bg-[var(--fin-surface-2)]', compacta ? 'h-[6px]' : 'h-[8px]')}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', corDaBarra(item))} style={{ width: `${largura}%` }} />
      </div>
      {marca !== null ? (
        <div className="pointer-events-none absolute -top-[3px] -bottom-[3px] w-[2px] -translate-x-1/2 rounded-full bg-[var(--fin-text)]" style={{ left: `${marca}%` }} aria-hidden="true" />
      ) : null}
    </div>
  );
}

// ============================================================
// Um item do plano
// ============================================================

function ListaDeContas({ titulo, contas, tom }: { titulo: string; contas: ContaDoMes[]; tom: 'negativo' | 'neutro' }) {
  if (contas.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className={cn('fin-t-overline', tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')}>{titulo}</span>
      <ul className="flex flex-col">
        {contas.slice(0, 4).map(c => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 py-0.5">
            <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-2)]">
              {c.descricao || c.fornecedor || 'Conta'} · vence {dataBR(c.vencimento)}
            </span>
            <span className="fin-t-caption shrink-0 tabular-nums text-[var(--fin-text)]">{formatBRL(Math.max(0, c.valor - c.pago))}</span>
          </li>
        ))}
        {contas.length > 4 ? <li className="fin-t-caption text-[var(--fin-text-3)]">e mais {contas.length - 4}</li> : null}
      </ul>
    </div>
  );
}

function LinhaDoItem({ item, onRegistrar, registros, onApagarRegistro, podeEditar }: {
  item: ItemDoPlano;
  onRegistrar?: () => void;
  registros?: RealizadoDoMes['registros'];
  onApagarRegistro?: (id: string) => void;
  podeEditar: boolean;
}) {
  const limitar = item.sentido === 'limitar';
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="fin-t-body-strong text-[var(--fin-text)]">{item.titulo}</h3>
          <p className="fin-t-caption mt-0.5 text-[var(--fin-text-2)]">{item.porque}</p>
        </div>
        <Chip situacao={item.situacao} />
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <dt className="fin-t-caption text-[var(--fin-text-3)]">{limitar ? 'Planejado (teto)' : 'Planejado'}</dt>
          <dd className="fin-t-body tabular-nums text-[var(--fin-text)]">{valor(item.planejado, item.formato)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="fin-t-caption text-[var(--fin-text-3)]">{limitar && item.contas ? 'Pago' : 'Realizado'}</dt>
          <dd className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{item.situacao === 'sem_dados' ? 'Sem dados' : valor(item.realizado, item.formato)}</dd>
        </div>
        {limitar && !item.contas ? (
          // Custo por venda não se paga: o que importa é a diferença para o plano.
          <div className="min-w-0">
            <dt className="fin-t-caption text-[var(--fin-text-3)]">Diferença</dt>
            <dd className="fin-t-body tabular-nums text-[var(--fin-text)]">
              {item.realizado === null || item.planejado === null
                ? '—'
                : `${item.realizado >= item.planejado ? '+' : '−'}${formatBRL(Math.abs(item.realizado - item.planejado))}`}
            </dd>
          </div>
        ) : (
          <div className="min-w-0">
            <dt className="fin-t-caption text-[var(--fin-text-3)]">{limitar ? 'Falta pagar' : 'Falta'}</dt>
            <dd className="fin-t-body tabular-nums text-[var(--fin-text)]">
              {item.falta === null ? '—' : item.falta === 0 ? (limitar ? 'Nada' : 'Nada, meta batida') : valor(item.falta, item.formato)}
            </dd>
          </div>
        )}
      </dl>

      {item.chave !== 'custos_variaveis' ? <BarraDoRitmo item={item} /> : null}

      {item.contas && (item.contas.vencidas.length > 0 || item.contas.aVencer.length > 0) ? (
        <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">
          <ListaDeContas titulo={`Vencidas (${item.contas.vencidas.length})`} contas={item.contas.vencidas} tom="negativo" />
          <ListaDeContas titulo={`A vencer (${item.contas.aVencer.length})`} contas={item.contas.aVencer} tom="neutro" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="fin-t-caption text-[var(--fin-text-3)]">{item.fonte}</p>
        {item.registravel && podeEditar && onRegistrar ? (
          <button
            type="button"
            onClick={onRegistrar}
            className="fin-t-caption inline-flex items-center gap-1 rounded-[var(--fin-r-sm)] px-2 py-1 font-medium text-[var(--fin-accent)] hover:bg-[var(--fin-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
          >
            <Plus aria-hidden="true" className="size-3.5" /> Registrar atendimentos
          </button>
        ) : null}
        {item.contas && (item.contas.vencidas.length > 0 || item.contas.aVencer.length > 0) ? (
          <Link
            href={item.contas.vencidas.length > 0 ? '/financeiro-ag/pagar?status=VENCIDO' : '/financeiro-ag/pagar'}
            className="fin-t-caption inline-flex items-center gap-1 font-medium text-[var(--fin-accent)] hover:underline"
          >
            Abrir contas a pagar <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {registros && registros.length > 0 ? (
        <ul className="flex flex-col rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
          {registros.slice(0, 5).map(r => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-2)]">
                <b className="font-semibold tabular-nums text-[var(--fin-text)]">{r.valor}</b> até {dataBR(r.data)}
                {r.autor ? ` · ${r.autor}` : ''}{r.observacao ? ` · ${r.observacao}` : ''}
              </span>
              {podeEditar && onApagarRegistro ? (
                <button
                  type="button"
                  onClick={() => onApagarRegistro(r.id)}
                  aria-label={`Apagar o registro de ${r.valor} atendimentos em ${dataBR(r.data)}`}
                  className="grid size-7 shrink-0 place-items-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-negative-text)]"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ============================================================
// O número grande do topo
// ============================================================

function Destaque({ item, rotulo }: { item: ItemDoPlano; rotulo: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--fin-s-2)]">
      <p className="fin-t-caption text-[var(--fin-text-2)]">{rotulo}</p>
      <p className="min-w-0 truncate tabular-nums">
        <span className="text-[clamp(24px,2.4vw,32px)] font-bold leading-none text-[var(--fin-text)]">
          {item.situacao === 'sem_dados' ? '—' : valor(item.realizado, item.formato)}
        </span>
        {item.planejado !== null ? (
          <span className="fin-t-body text-[var(--fin-text-3)]"> de {valor(item.planejado, item.formato)}</span>
        ) : null}
      </p>
      <BarraDoRitmo item={item} compacta />
      <div className="flex items-center justify-between gap-2">
        <Chip situacao={item.situacao} />
        {item.progresso !== null ? (
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{Math.round(item.progresso)}%</span>
        ) : null}
      </div>
    </div>
  );
}

function Indicadores({ itens }: { itens: IndicadorDoPlano[] }) {
  const v = (i: IndicadorDoPlano, x: number | null) => {
    if (x === null) return '—';
    if (i.formato === 'percentual') return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    return i.formato === 'dinheiro' ? formatBRL(x) : String(x);
  };
  return (
    <div className={cn(CARTAO, 'overflow-hidden')}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[var(--fin-surface-2)]">
            <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-left text-[var(--fin-text-3)]">Premissa</th>
            <th scope="col" className="fin-t-overline px-[var(--fin-s-2)] py-[var(--fin-s-2)] text-right text-[var(--fin-text-3)]">No plano</th>
            <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right text-[var(--fin-text-3)]">No mês</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(i => (
            <tr key={i.titulo} className="border-t border-[var(--fin-border)]">
              <th scope="row" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-left font-normal">
                <span className="fin-t-body text-[var(--fin-text)]">{i.titulo}</span>
                <span className="fin-t-caption block text-[var(--fin-text-3)]">{i.nota}</span>
              </th>
              <td className="fin-t-body px-[var(--fin-s-2)] py-[var(--fin-s-2)] text-right tabular-nums text-[var(--fin-text-2)]">{v(i, i.planejado)}</td>
              <td className={cn('fin-t-body-strong px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right tabular-nums', i.desvio ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text)]')}>
                {i.desvio ? <AlertTriangle aria-label="Abaixo do plano" className="mr-1 inline size-3.5 -mt-0.5" /> : null}
                {v(i, i.realizado)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// O painel
// ============================================================

export function Acompanhamento({ mes, mesPorExtenso, plano, rel, temPlano, podeEditar, onEditarPlano }: {
  mes: string;
  mesPorExtenso: string;
  plano: CustosData | null;
  rel: Relatorio | null;
  temPlano: boolean;
  podeEditar: boolean;
  onEditarPlano: () => void;
}) {
  const [realizado, setRealizado] = useState<RealizadoDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [registrando, setRegistrando] = useState(false);
  const [form, setForm] = useState({ valor: '', data: hojeISO(), observacao: '' });
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
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

  // O plano que está na tela, não o gravado: editar uma meta muda tudo aqui na hora.
  const painel = useMemo(
    () => (realizado ? montarAcompanhamento({ plano: temPlano ? plano : null, rel: temPlano ? rel : null, realizado }) : null),
    [realizado, plano, rel, temPlano],
  );

  const abrirRegistro = () => {
    const ultimo = realizado ? ultimoRegistro(realizado.registros, 'atendimentos') : null;
    const hoje = hojeISO();
    // Registro é do mês que está aberto na tela: num mês passado, o último dia dele.
    const fimDoMes = (() => {
      const [a, m] = mes.split('-').map(Number);
      return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
    })();
    const data = hoje.slice(0, 7) === mes ? hoje : hoje.slice(0, 7) > mes ? fimDoMes : hoje;
    setForm({ valor: ultimo ? String(ultimo.valor) : '', data, observacao: '' });
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
      await carregar(true);
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : 'Não foi possível gravar o registro.');
    } finally {
      setGravando(false);
    }
  };

  const apagar = async (id: string) => {
    const res = await fetch(`/api/planejamento/progresso?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) await carregar(true);
    else setErro('Não foi possível apagar o registro.');
  };

  if (carregando && !realizado) {
    return (
      <div className="flex flex-col gap-[var(--fin-s-4)]" aria-busy="true">
        <div className={cn(CARTAO, 'h-[210px] animate-pulse')} />
        <div className="grid grid-cols-1 gap-[var(--fin-s-4)] lg:grid-cols-2">
          <div className={cn(CARTAO, 'h-[260px] animate-pulse')} />
          <div className={cn(CARTAO, 'h-[260px] animate-pulse')} />
        </div>
      </div>
    );
  }

  if (erro && !realizado) {
    return (
      <div role="alert" className="flex max-w-xl items-start gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-negative)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-4)]">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-negative-text)]" />
        <div>
          <p className="fin-t-body-strong text-[var(--fin-text)]">Não foi possível montar o acompanhamento</p>
          <p className="fin-t-caption mt-1 text-[var(--fin-text-2)]">{erro}</p>
          <button type="button" onClick={() => void carregar()} className="fin-t-caption mt-2 inline-flex items-center gap-1.5 font-semibold text-[var(--fin-negative-text)]">
            <RefreshCw aria-hidden="true" className="size-3.5" /> Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!painel || !realizado) return null;

  const porChave = Object.fromEntries(painel.areas.flatMap(a => a.itens).map(i => [i.chave, i])) as Record<ItemDoPlano['chave'], ItemDoPlano>;
  const registrosAtendimento = realizado.registros.filter(r => r.chave === 'atendimentos');
  const cal = painel.calendario;
  const contagens: Array<[Situacao, string, string]> = [
    ['concluido', 'concluído', 'concluídos'], ['pendente', 'pendente', 'pendentes'], ['atrasado', 'atrasado', 'atrasados'],
    ['acima', 'acima do plano', 'acima do plano'], ['sem_dados', 'sem dados', 'sem dados'],
  ];

  return (
    <div className="flex flex-col gap-[var(--fin-s-6)]">
      {/* ── O MÊS NUM RELANCE ─────────────────────────────────────────── */}
      <section className={cn(CARTAO, 'overflow-hidden')} aria-labelledby="titulo-acompanhamento">
        <div className="flex flex-wrap items-start justify-between gap-3 px-[var(--fin-s-5)] pt-[var(--fin-s-4)]">
          <div className="min-w-0">
            <p className="fin-t-overline text-[var(--fin-text-3)]">
              {cal.futuro ? 'Mês que vem' : cal.aberto ? `Dia útil ${cal.diasUteisPassados} de ${cal.diasUteis}` : 'Mês encerrado'}
              {cal.aberto ? ` · ${Math.round(cal.fracao * 100)}% do mês` : ''}
            </p>
            <h2 id="titulo-acompanhamento" className="fin-t-subhead mt-1 text-[var(--fin-text)]">{painel.frase}</h2>
          </div>
          <div className="flex items-center gap-2">
            {carregando ? <Loader2 aria-label="Atualizando" className="size-4 animate-spin text-[var(--fin-text-3)]" /> : (
              <button
                type="button"
                onClick={() => void carregar(true)}
                aria-label="Atualizar o realizado"
                className="grid size-9 place-items-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
              </button>
            )}
            {podeEditar ? (
              <button
                type="button"
                onClick={onEditarPlano}
                className={cn(
                  'fin-t-body inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] px-3 font-medium',
                  temPlano
                    ? 'border border-[var(--fin-border-strong)] text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]'
                    : 'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)]',
                )}
              >
                <PencilLine aria-hidden="true" className="size-4" />
                {temPlano ? 'Editar plano' : 'Preencher o plano'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-[var(--fin-s-5)] py-[var(--fin-s-5)] sm:grid-cols-2 lg:grid-cols-3">
          <Destaque item={porChave.vendas} rotulo="Vendas fechadas" />
          <Destaque item={porChave.comissao} rotulo="Receita de comissões" />
          <Destaque item={porChave.lucro} rotulo={cal.aberto ? 'Lucro até agora (provisório)' : 'Lucro do mês'} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-5)] py-[var(--fin-s-2)]">
          {contagens.filter(([s]) => painel.contagem[s] > 0).map(([s, um, varios]) => (
            <span key={s} className="fin-t-caption inline-flex items-center gap-1.5 text-[var(--fin-text-2)]">
              <span aria-hidden="true" className={cn('size-2 rounded-[var(--fin-r-dot)]', s === 'sem_dados' ? 'border border-[var(--fin-text-3)]' : BARRA[s])} />
              <b className="font-semibold tabular-nums text-[var(--fin-text)]">{painel.contagem[s]}</b> {painel.contagem[s] === 1 ? um : varios}
            </span>
          ))}
          {temPlano && cal.aberto ? (
            <span className="fin-t-caption ml-auto inline-flex items-center gap-1.5 text-[var(--fin-text-3)]">
              <span aria-hidden="true" className="inline-block h-3 w-[2px] rounded-full bg-[var(--fin-text)]" /> onde o plano pedia estar hoje
            </span>
          ) : null}
        </div>
      </section>

      {/* ── O QUE PRECISA DE ATENÇÃO ──────────────────────────────────── */}
      {painel.atencao.length > 0 ? (
        <section aria-labelledby="titulo-atencao" className="flex flex-col gap-[var(--fin-s-2)]">
          <h2 id="titulo-atencao" className="fin-t-overline text-[var(--fin-text-3)]">Pontos de atenção</h2>
          <ul className={cn(CARTAO, 'divide-y divide-[var(--fin-border)]')}>
            {painel.atencao.map((p, i) => (
              <li key={`${p.chave}-${i}`} className="flex flex-wrap items-start gap-3 px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                {p.tom === 'negativo'
                  ? <AlertTriangle aria-label="Atrasado" className="mt-0.5 size-4 shrink-0 text-[var(--fin-negative-text)]" />
                  : <Info aria-label="Aviso" className="mt-0.5 size-4 shrink-0 text-[var(--fin-warning-text)]" />}
                <p className="fin-t-body min-w-0 flex-1 text-[var(--fin-text)]">{p.texto}</p>
                {p.acao?.href ? (
                  <Link href={p.acao.href} className="fin-t-caption inline-flex shrink-0 items-center gap-1 font-medium text-[var(--fin-accent)] hover:underline">
                    {p.acao.rotulo} <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                ) : p.acao?.registrar && podeEditar ? (
                  <button type="button" onClick={abrirRegistro} className="fin-t-caption inline-flex shrink-0 items-center gap-1 font-medium text-[var(--fin-accent)] hover:underline">
                    {p.acao.rotulo} <ArrowRight aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : temPlano && !cal.futuro ? (
        <p className="fin-t-body inline-flex items-center gap-2 text-[var(--fin-text-2)]">
          <Check aria-hidden="true" className="size-4 text-[var(--fin-positive)]" /> Nada pedindo atenção agora.
        </p>
      ) : null}

      {/* ── POR ÁREA ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-[var(--fin-s-4)] lg:grid-cols-2">
        {painel.areas.map(area => (
          <section key={area.id} aria-labelledby={`area-${area.id}`} className={cn(CARTAO, 'overflow-hidden')}>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-[var(--fin-s-2)]">
              <h2 id={`area-${area.id}`} className="fin-t-overline text-[var(--fin-text-2)]">{area.titulo}</h2>
            </div>
            {area.itens.map(item => (
              <LinhaDoItem
                key={item.chave}
                item={item}
                podeEditar={podeEditar}
                onRegistrar={item.registravel ? abrirRegistro : undefined}
                registros={item.chave === 'atendimentos' ? registrosAtendimento : undefined}
                onApagarRegistro={item.chave === 'atendimentos' ? (id => void apagar(id)) : undefined}
              />
            ))}
          </section>
        ))}
      </div>

      {/* ── AS PREMISSAS CONTRA A REALIDADE ───────────────────────────── */}
      {painel.indicadores.length > 0 ? (
        <section aria-labelledby="titulo-premissas" className="flex flex-col gap-[var(--fin-s-2)]">
          <h2 id="titulo-premissas" className="fin-t-overline text-[var(--fin-text-3)]">As premissas do plano no mês</h2>
          <Indicadores itens={painel.indicadores} />
        </section>
      ) : null}

      <p className="fin-t-caption inline-flex items-start gap-1.5 text-[var(--fin-text-3)]">
        <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        O realizado conta desde o dia 1 de {mesPorExtenso}, com a mesma régua do relatório Lucro real, mesmo que o plano tenha sido feito depois. Editar o plano refaz as metas e não apaga nenhum registro.
      </p>

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
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                className="fin-t-body h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 tabular-nums text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
              />
            )}
          </Field>
          <Field rotulo="Até o dia" ajuda="O total acumulado no mês até este dia, não só o do dia.">
            {a => (
              <input
                {...a}
                type="date"
                min={`${mes}-01`}
                max={hojeISO()}
                value={form.data}
                onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                className="fin-t-body h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
              />
            )}
          </Field>
          <Field rotulo="Observação" ajuda="Opcional. Ex.: contei pelo relatório do CRM.">
            {a => (
              <input
                {...a}
                type="text"
                maxLength={280}
                value={form.observacao}
                onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                className="fin-t-body h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
              />
            )}
          </Field>
        </div>
      </RecordSheet>
    </div>
  );
}
