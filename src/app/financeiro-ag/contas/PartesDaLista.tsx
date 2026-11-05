'use client';

import * as React from 'react';
import { CalendarClock, CheckCheck, ChevronLeft, ChevronRight, Copy, Tags, Trash2, X } from 'lucide-react';

import type { LinhaDeConta, TotaisDaLista } from '@/lib/contas-pagar-receber';
import { round2 } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Barra das contas marcadas e rodapé de totais da lista Contas a Pagar/Receber (05/11/2026). */

const contas = (n: number) => (n === 1 ? '1 conta' : `${n.toLocaleString('pt-BR')} contas`);
const BOTAO = 'h-11 gap-[var(--fin-s-2)] lg:h-9';

export type AcaoDaBarra = 'liquidar' | 'reagendar' | 'recategorizar' | 'copiar' | 'excluir' | 'desmarcar' | 'marcar_todas';

/**
 * Aparece quando há conta marcada e acompanha a rolagem. Mostra quantas e
 * quanto está em aberto de cada lado, e as ações que valem para o lote.
 */
export function BarraDoLote({
  marcadas, totalDoFiltro, oferecerTodas, marcandoTodas, pode, onAcao,
}: {
  marcadas: readonly LinhaDeConta[];
  totalDoFiltro: number;
  /** A página inteira está marcada e o filtro tem mais contas. */
  oferecerTodas: boolean;
  marcandoTodas: boolean;
  pode: { liquidar: boolean; editar: boolean; excluir: boolean };
  onAcao: (acao: AcaoDaBarra) => void;
}) {
  const soma = (tipo: 'pagar' | 'receber') => round2(marcadas.filter(l => l.tipo === tipo).reduce((s, l) => s + l.saldo, 0));
  const receber = soma('receber');
  const pagar = soma('pagar');
  return (
    <section
      aria-label="Contas marcadas"
      className={cn(
        'sticky top-[var(--fin-s-2)] z-[var(--fin-z-conteudo)] flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-accent)]',
        'bg-[var(--fin-surface)] p-[var(--fin-s-3)] shadow-[var(--fin-e1)] lg:flex-row lg:items-center lg:justify-between',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-[var(--fin-s-4)] gap-y-1 fin-t-body tabular-nums text-[var(--fin-text-2)]" aria-live="polite">
        <span className="fin-t-body-strong text-[var(--fin-text)]">
          {marcadas.length === 1 ? '1 marcada' : `${marcadas.length.toLocaleString('pt-BR')} marcadas`}
        </span>
        {receber > 0 ? <span>A receber em aberto <b className="font-semibold text-[var(--fin-positive)]">{formatBRL(receber)}</b></span> : null}
        {pagar > 0 ? <span>A pagar em aberto <b className="font-semibold text-[var(--fin-text)]">{formatBRL(pagar)}</b></span> : null}
        {oferecerTodas ? (
          <button
            type="button"
            disabled={marcandoTodas}
            onClick={() => onAcao('marcar_todas')}
            className="fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline disabled:opacity-60"
          >
            {marcandoTodas ? 'Marcando…' : `Marcar todas as ${contas(totalDoFiltro)} do filtro`}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
        {pode.liquidar ? (
          <Button type="button" size="sm" onClick={() => onAcao('liquidar')} className={BOTAO}>
            <CheckCheck aria-hidden="true" className="size-4" /> Liquidar
          </Button>
        ) : null}
        {pode.editar ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => onAcao('reagendar')} className={BOTAO}>
              <CalendarClock aria-hidden="true" className="size-4" /> Reagendar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onAcao('recategorizar')} className={BOTAO}>
              <Tags aria-hidden="true" className="size-4" /> Categoria e centro
            </Button>
          </>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => onAcao('copiar')} className={BOTAO}>
          <Copy aria-hidden="true" className="size-4" /> Copiar
        </Button>
        {pode.excluir ? (
          <Button
            type="button" variant="outline" size="sm" onClick={() => onAcao('excluir')}
            className={cn(BOTAO, 'text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')}
          >
            <Trash2 aria-hidden="true" className="size-4" /> Excluir
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" aria-label="Desmarcar todas" onClick={() => onAcao('desmarcar')} className="size-11 lg:size-9">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </section>
  );
}

function TotalDoRodape({ rotulo, valor, emAberto, tom = 'neutro', sinal = false }: {
  rotulo: string; valor: number; emAberto: number; tom?: 'neutro' | 'positivo'; sinal?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
      <dd className="flex flex-col">
        <span
          className={cn(
            'fin-t-body-strong',
            sinal && valor < 0 ? 'text-[var(--fin-negative-text)]' : tom === 'positivo' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]',
          )}
        >
          {formatBRL(valor)}
        </span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">em aberto {formatBRL(emAberto)}</span>
      </dd>
    </div>
  );
}

/** Totais do filtro inteiro (não só da página) e a navegação entre páginas. */
export function RodapeDaLista({
  totais, pagina, totalPaginas, porPagina, onPorPagina, onPagina,
}: {
  totais: TotaisDaLista;
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  onPorPagina: (n: number) => void;
  onPagina: (p: number) => void;
}) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)] border-t-2 border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] xl:flex-row xl:items-center xl:justify-between">
      <dl className="grid grid-cols-1 gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)] fin-t-body tabular-nums sm:grid-cols-3" aria-live="polite">
        <TotalDoRodape rotulo="A receber" valor={totais.receber.valor} emAberto={totais.receber.aberto} tom="positivo" />
        <TotalDoRodape rotulo="A pagar" valor={totais.pagar.valor} emAberto={totais.pagar.aberto} />
        <TotalDoRodape rotulo="Saldo do filtro" valor={totais.saldo} emAberto={totais.saldo_aberto} sinal />
      </dl>
      <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-center">
        {totais.canceladas > 0 ? (
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {totais.canceladas === 1 ? 'A conta cancelada não entra' : `As ${totais.canceladas} canceladas não entram`} nos totais.
          </span>
        ) : null}
        <nav aria-label="Páginas" className="flex items-center gap-[var(--fin-s-2)]">
          <label className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
            Por página
            <select
              value={porPagina}
              onChange={e => onPorPagina(Number(e.target.value))}
              className="h-9 w-20 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:h-8"
            >
              {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button type="button" variant="ghost" size="icon" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => onPagina(Math.max(1, pagina - 1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{pagina} de {totalPaginas}</span>
          <Button type="button" variant="ghost" size="icon" aria-label="Próxima página" disabled={pagina >= totalPaginas} onClick={() => onPagina(pagina + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </div>
    </div>
  );
}
