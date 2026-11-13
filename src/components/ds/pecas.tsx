'use client';

/**
 * Peças do design system do Entur OS CRM, importadas no Financeiro
 * (12/11/2026). Origem: client/src/components/analises/PecasDasAnalises.tsx
 * no entur-os-crm (as Análises, crm.enturos.com/analytics).
 *
 * Forma, medida e tipografia são as do CRM; a COR vem dos tokens --ds-*,
 * que no Financeiro apontam para --fin-* (ver src/styles/ds.css). Os ícones
 * são os do Financeiro (lucide), no mesmo tamanho e peso visual.
 *
 * Toda tela que entra no design system usa a raiz `ds ds-pagina` e importa
 * '@/styles/ds.css'.
 */
import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Info, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import '@/styles/ds.css';

export type TomDoDs = 'brand' | 'success' | 'danger' | 'info' | 'warning';

/** A cor de um tom, para estilo inline (barra, bolinha, sombra). */
export const corDoTom = (tom: TomDoDs) => `var(--ds-${tom})`;

/** Cor com transparência, sem hex: "var(--ds-brand)" + 0,12. */
export const suave = (cor: string, a: number) =>
  `color-mix(in srgb, ${cor} ${Math.round(a * 100)}%, transparent)`;

export const FOCO =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-border-focus)]';

/** O cartão das Análises: 24 px, borda sutil, sombra de vidro. */
export const CARTAO_DS =
  'rounded-[var(--ds-radius-card)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-card)] shadow-[var(--ds-glass-shadow)]';

export const ROTULO_DS = 'text-[11px] font-medium uppercase tracking-[0.08em] whitespace-nowrap';

/** Botão em pílula (filtros, "Ver os números", ações do topo). */
export const PILULA_DS =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ds-border-default)] bg-[var(--ds-surface-card)] px-3.5 text-[13px] text-[var(--ds-text-strong)] transition-colors hover:bg-[var(--ds-surface-hover)] ' +
  FOCO;

/** Ladrilho do ícone em degradê do tom. */
export function ChipDoTom({ tom = 'brand', Icone, tamanho = 40 }: { tom?: TomDoDs; Icone: LucideIcon; tamanho?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: tamanho * 0.3,
        color: 'var(--ds-text-on-fill)',
        background: `linear-gradient(140deg, var(--ds-tom-${tom}-de), var(--ds-tom-${tom}-ate))`,
        boxShadow: `0 6px 16px ${suave(`var(--ds-tom-${tom}-ate)`, 0.25)}`,
      }}
    >
      <Icone style={{ width: tamanho * 0.44, height: tamanho * 0.44 }} strokeWidth={2.4} />
    </span>
  );
}

/** Topo da página: ladrilho de 46 px, título de 28/36 px e a linha de apoio. */
export function TopoDoDs({
  Icone, titulo, sub, children,
}: { Icone: LucideIcon; titulo: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <ChipDoTom Icone={Icone} tamanho={46} />
      <div className="min-w-0 flex-1">
        <h1 className="text-[28px] font-medium leading-[1.1] tracking-[-0.03em] text-[var(--ds-text-strong)] sm:text-[36px]">
          {titulo}
        </h1>
        {sub ? <p className="mt-1 text-[14px] text-[var(--ds-text-body)]">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Cabeçalho de um bloco: ladrilho de 38 px, título e legenda; ações à direita. */
export function CabecaDoBloco({
  tom, Icone, titulo, sub, children, id, nivel = 2,
}: {
  tom: TomDoDs;
  Icone: LucideIcon;
  titulo: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  id?: string;
  nivel?: 2 | 3;
}) {
  const Titulo = nivel === 3 ? 'h3' : 'h2';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ChipDoTom tom={tom} Icone={Icone} tamanho={38} />
      {/* min-w: no celular o título não espreme; a legenda e as ações descem. */}
      <div className="min-w-[11rem] flex-1">
        <Titulo id={id} className="text-[16.5px] font-medium tracking-[-0.01em] text-[var(--ds-text-strong)]">
          {titulo}
        </Titulo>
        {sub ? <p className="mt-0.5 text-[12.5px] text-[var(--ds-text-muted)]">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Título de seção: bolinha do tom da marca e rótulo em caixa alta. */
export function TituloDeSecao({ children, extra, primeira }: { children: React.ReactNode; extra?: React.ReactNode; primeira?: boolean }) {
  return (
    <div className={cn('mb-3.5 flex items-center gap-2', primeira ? 'mt-[26px]' : 'mt-[34px]')}>
      <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--ds-brand)]" />
      <h2 className={cn(ROTULO_DS, 'text-[var(--ds-text-strong)]')}>{children}</h2>
      {extra ? <span className="text-[12px] text-[var(--ds-text-muted)]">{extra}</span> : null}
    </div>
  );
}

/* ── Selo de variação ─────────────────────────────────────────────────── */

export interface VariacaoDoDs {
  /** Percentual contra o período anterior; null = sem base para comparar. */
  pct: number | null;
  /** Subir é bom? null = neutro (não pinta de verde nem de vermelho). */
  bom: boolean | null;
}

/** Verde quando é bom para a agência, vermelho quando não. "Sem base" é cinza, nunca zero. */
export function SeloDeVariacao({ v, dica }: { v: VariacaoDoDs; dica?: string }) {
  if (v.pct === null) {
    return (
      <span title={dica} className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-[var(--ds-surface-sunken)] px-2 text-[11px] font-medium text-[var(--ds-text-muted)]">
        sem base
      </span>
    );
  }
  const estavel = Math.abs(v.pct) < 0.05;
  const cor = estavel || v.bom === null ? 'var(--ds-text-muted)' : v.bom ? corDoTom('success') : corDoTom('danger');
  const Seta = v.pct >= 0 ? ArrowUpRight : ArrowDownRight;
  const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(v.pct));
  return (
    <span
      title={dica}
      className="ds-num inline-flex h-[22px] items-center gap-[3px] whitespace-nowrap rounded-full px-2 text-[11px] font-medium"
      style={{ background: estavel || v.bom === null ? 'var(--ds-surface-sunken)' : suave(cor, 0.1), color: cor }}
    >
      {estavel ? 'estável' : (
        <>
          <Seta className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
          {v.pct > 0 ? '+' : '−'}{numero}%
        </>
      )}
    </span>
  );
}

/* ── Cartão de número ─────────────────────────────────────────────────── */

export interface NumeroDoDs {
  chave: string;
  rotulo: string;
  /** Já formatado (respeita o "Ocultar valores"). */
  valor: React.ReactNode;
  sub: React.ReactNode;
  tom: TomDoDs;
  Icone: LucideIcon;
  aviso?: React.ReactNode;
  dica?: string;
  onAbrir?: () => void;
  variacao?: VariacaoDoDs | null;
  dicaDaVariacao?: string;
  /** Valor negativo: o número sai na tinta de perigo. */
  negativo?: boolean;
}

export function CartaoDeNumero({ n }: { n: NumeroDoDs }) {
  const cor = corDoTom(n.tom);
  const estilo = {
    '--cor': cor,
    '--cor-borda': suave(cor, 0.35),
    '--cor-sombra': `0 14px 34px ${suave(cor, 0.16)}`,
  } as React.CSSProperties;
  const Raiz = n.onAbrir ? 'button' : 'div';
  return (
    <Raiz
      {...(n.onAbrir ? { type: 'button' as const, onClick: n.onAbrir } : {})}
      title={n.dica}
      style={estilo}
      className={cn(
        CARTAO_DS,
        'group relative flex min-w-0 flex-col gap-3.5 overflow-hidden p-5 text-left transition-[transform,box-shadow,border-color] duration-[180ms]',
        n.onAbrir && 'cursor-pointer hover:-translate-y-0.5 hover:border-[var(--cor-borda)] hover:shadow-[var(--cor-sombra)]',
        n.onAbrir && FOCO,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[60px] -top-[60px] h-[180px] w-[180px] rounded-full"
        style={{ background: `radial-gradient(circle, ${suave(cor, 0.14)}, transparent 70%)` }}
      />
      <span className="relative flex items-center gap-2.5">
        <ChipDoTom tom={n.tom} Icone={n.Icone} tamanho={36} />
        <span className="flex-1" />
        {n.variacao ? <SeloDeVariacao v={n.variacao} dica={n.dicaDaVariacao} /> : null}
        {n.onAbrir ? (
          <ArrowUpRight className="h-[15px] w-[15px] text-[var(--ds-text-muted)] transition-colors group-hover:text-[var(--cor)]" aria-hidden="true" />
        ) : null}
      </span>
      <span className="relative">
        <span className={cn(ROTULO_DS, 'block text-[10.5px] text-[var(--ds-text-muted)]')}>{n.rotulo}</span>
        <span
          className={cn(
            'ds-num mt-1.5 block truncate text-[30px] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[32px]',
            n.negativo ? 'text-[var(--ds-danger-ink)]' : 'text-[var(--ds-text-strong)]',
          )}
        >
          {n.valor}
        </span>
        <span className="mt-1 block text-[12.5px] text-[var(--ds-text-body)]">{n.sub}</span>
      </span>
      {n.aviso ? (
        <span className="relative flex items-start gap-1.5 rounded-[12px] bg-[var(--ds-warning-soft)] px-2.5 py-2 text-[11.5px] text-[var(--ds-text-body)]">
          <Info className="mt-px h-[13px] w-[13px] shrink-0 text-[var(--ds-warning)]" aria-hidden="true" />
          {n.aviso}
        </span>
      ) : null}
    </Raiz>
  );
}
