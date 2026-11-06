'use client';

/**
 * Peças comuns da ficha da venda (E5): formato de dinheiro e data, campos
 * densos de valor e as classes da tela. O modelo guarda centavos; a tela
 * mostra e recebe reais.
 */
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { deCentavos, parseMoneyBR } from '@/lib/money';
import { cn } from '@/lib/utils';

export const SECAO = 'flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] md:p-[var(--fin-s-5)]';
export const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
export const SELECT = cn(CONTROLE, 'w-full border px-3 text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] disabled:opacity-60');
export const ROTULO = 'fin-t-caption font-medium text-[var(--fin-text-2)]';
export const LINK = 'text-[var(--fin-accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos de real → "R$ 1.234,56". */
export function reais(centavos: number): string {
  return BRL.format(deCentavos(centavos));
}

/** Centavos na moeda do produto → "US$ 900,00". */
export function naMoeda(centavos: number, moeda: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'BRL' }).format(deCentavos(centavos));
  } catch {
    return `${moeda} ${deCentavos(centavos).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }
}

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
}

export function quandoBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '—';
}

/**
 * Campo de valor em reais que guarda centavos. Enquanto a pessoa digita, o
 * texto é dela; ao sair do campo vira "1.234,56".
 */
export function CampoReais({
  centavos, onChange, rotulo, id, desabilitado, className, prefixo = 'R$',
}: {
  centavos: number;
  onChange: (centavos: number) => void;
  rotulo: string;
  id?: string;
  desabilitado?: boolean;
  className?: string;
  prefixo?: string;
}) {
  const formatado = (c: number) => (c ? deCentavos(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const [texto, setTexto] = React.useState(formatado(centavos));
  const [focado, setFocado] = React.useState(false);
  React.useEffect(() => { if (!focado) setTexto(formatado(centavos)); }, [centavos, focado]);
  return (
    <div className={cn('relative min-w-0', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center fin-t-caption text-[var(--fin-text-3)]">{prefixo}</span>
      <Input
        id={id}
        aria-label={rotulo}
        inputMode="decimal"
        disabled={desabilitado}
        value={texto}
        placeholder="0,00"
        onFocus={() => setFocado(true)}
        onBlur={() => { setFocado(false); setTexto(formatado(centavos)); }}
        onChange={e => {
          setTexto(e.target.value);
          const v = parseMoneyBR(e.target.value);
          onChange(v === null ? 0 : Math.max(0, Math.round(v * 100)));
        }}
        className={cn(CONTROLE, 'pl-10 text-right tabular-nums')}
      />
    </div>
  );
}

/** Um número curto à direita do rótulo, para os totais da venda. */
export function Total({ rotulo, valor, destaque = false, tom = 'neutro', dica }: {
  rotulo: string; valor: string; destaque?: boolean; tom?: 'neutro' | 'positivo' | 'aviso' | 'negativo'; dica?: string;
}) {
  const cor = tom === 'positivo' ? 'text-[var(--fin-positive)]'
    : tom === 'aviso' ? 'text-[var(--fin-warning-text)]'
      : tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]';
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={dica}>
      <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
      <dd className={cn('tabular-nums', destaque ? 'fin-t-metric-sm' : 'fin-t-body-strong', cor)}>{valor}</dd>
    </div>
  );
}

/** Rótulo pequeno em pílula (quem cobra, origem, situação). */
export function Pilula({ children, tom = 'neutro' }: { children: React.ReactNode; tom?: 'neutro' | 'acento' | 'positivo' | 'aviso' | 'violeta' }) {
  const cores = {
    neutro: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
    acento: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
    positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
    aviso: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
    violeta: 'bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]',
  }[tom];
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--fin-r-sm)] px-1.5 py-0.5 fin-t-caption font-medium', cores)}>{children}</span>;
}
