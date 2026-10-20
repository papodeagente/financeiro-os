/**
 * Peças de PAINEL ANALÍTICO no design system do Entur OS: a linguagem das
 * Análises do CRM (client/src/components/analises/PecasDasAnalises.tsx), com
 * o azul do Financeiro no lugar do roxo (Bruno, 20/10/2026).
 *
 *   CARTAO_DO_PAINEL   cartão de 24px com sombra de vidro
 *   ChipDoTom          a casquinha CHEIA: degradê da cor, ícone claro, sombra
 *                      da própria cor (a suave, de tinta, é a IconeDeIndicador)
 *   TituloDeSecao      rótulo de seção em maiúsculas com a bolinha
 *   CabecaDoBloco      casquinha + título + legenda de um bloco grande
 *   SeloDoTom          pílula de valor/estado ("↘ 22% do plano")
 *   CartaoDeNumero     o indicador das Análises: brilho no canto, casquinha,
 *                      selo, rótulo, número grande, legenda e mini barras ou anel
 *   BarraDoTom         linha com nome, números, selo e barra em degradê, com a
 *                      marca de onde deveria estar
 *
 * A COR VEM DO TOM, como no resto do sistema: acento é o padrão; verde, vermelho
 * e âmbar só quando o número tem esse sentido. Nada de hex: tudo é token e
 * transparência é comAlfa().
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Info, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { comAlfa } from '@/lib/cor';

export type TomDoPainel = 'acento' | 'positivo' | 'negativo' | 'aviso' | 'info' | 'neutro';

/** A cor cheia de cada tom. */
export const COR_DO_PAINEL: Record<TomDoPainel, string> = {
  acento: 'var(--fin-accent)',
  positivo: 'var(--fin-positive)',
  negativo: 'var(--fin-negative)',
  aviso: 'var(--fin-warning)',
  info: 'var(--fin-info)',
  neutro: 'var(--fin-text-3)',
};

/** A cor de TEXTO de cada tom (contraste sobre fundo claro). */
const TEXTO_DO_TOM: Record<TomDoPainel, string> = {
  acento: 'var(--fin-accent)',
  positivo: 'var(--fin-positive)',
  negativo: 'var(--fin-negative-text)',
  aviso: 'var(--fin-warning-text)',
  info: 'var(--fin-info)',
  neutro: 'var(--fin-text-2)',
};

export const CARTAO_DO_PAINEL =
  'rounded-[var(--fin-r-painel)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-painel)]';

const ROTULO = 'fin-t-overline whitespace-nowrap';
const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

/** A casquinha cheia: degradê da cor, ícone em texto-sobre-preenchimento, sombra da própria cor. */
export function ChipDoTom({ tom = 'acento', icone: Icone, tamanho = 40 }: { tom?: TomDoPainel; icone: LucideIcon; tamanho?: number }) {
  const cor = COR_DO_PAINEL[tom];
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center text-[var(--fin-text-on-fill)]"
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: Math.round(tamanho * 0.3),
        backgroundImage: `linear-gradient(140deg, ${comAlfa(cor, 62)}, ${cor})`,
        boxShadow: `0 6px 16px ${comAlfa(cor, 25)}`,
      }}
    >
      <Icone style={{ width: tamanho * 0.44, height: tamanho * 0.44 }} strokeWidth={2.25} />
    </span>
  );
}

export function TituloDeSecao({ children, extra, id }: { children: React.ReactNode; extra?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
      <i aria-hidden="true" className="size-1.5 rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)]" />
      <h2 id={id} className={cn(ROTULO, 'text-[var(--fin-text)]')}>{children}</h2>
      {extra ? <span className="fin-t-caption text-[var(--fin-text-3)]">{extra}</span> : null}
    </div>
  );
}

export function CabecaDoBloco({ tom = 'acento', icone, titulo, sub, id, children }: {
  tom?: TomDoPainel; icone: LucideIcon; titulo: string; sub?: React.ReactNode; id?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--fin-s-3)]">
      <ChipDoTom tom={tom} icone={icone} tamanho={38} />
      <div className="min-w-[11rem] flex-1">
        <h2 id={id} className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        {sub ? <p className="fin-t-caption mt-0.5 text-[var(--fin-text-3)]">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Pílula de valor ou estado, na cor do tom. `seta`: ↗ subiu, ↘ desceu. */
export function SeloDoTom({ tom, children, seta, title }: { tom: TomDoPainel; children: React.ReactNode; seta?: 'sobe' | 'desce'; title?: string }) {
  const Seta = seta === 'sobe' ? ArrowUpRight : seta === 'desce' ? ArrowDownRight : null;
  return (
    <span
      title={title}
      className="fin-t-caption inline-flex h-[22px] shrink-0 items-center gap-[3px] whitespace-nowrap rounded-[var(--fin-r-dot)] px-2 font-medium tabular-nums"
      style={{ backgroundColor: tom === 'neutro' ? 'var(--fin-surface-2)' : comAlfa(COR_DO_PAINEL[tom], 11), color: TEXTO_DO_TOM[tom] }}
    >
      {Seta ? <Seta aria-hidden="true" className="size-3" strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}

/** O anel de progresso das Análises (0 a 100). Acima de 100 fecha o anel. */
export function Anel({ pct, tom = 'acento', tamanho = 48, espessura = 5, rotulo }: {
  pct: number; tom?: TomDoPainel; tamanho?: number; espessura?: number; rotulo: string;
}) {
  const id = React.useId().replace(/:/g, '');
  const r = (tamanho - espessura) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const cor = COR_DO_PAINEL[tom];
  return (
    <span className="relative inline-block shrink-0" style={{ width: tamanho, height: tamanho }} role="img" aria-label={rotulo}>
      <svg width={tamanho} height={tamanho} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" style={{ stopColor: cor }} />
            <stop offset="1" style={{ stopColor: comAlfa(cor, 55) }} />
          </linearGradient>
        </defs>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" style={{ stroke: 'var(--fin-surface-2)' }} strokeWidth={espessura} />
        {p > 0 ? (
          <circle
            cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={espessura} strokeLinecap="round"
            strokeDasharray={`${(c * p) / 100} ${c}`}
          />
        ) : null}
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center font-medium tabular-nums text-[var(--fin-text)]" style={{ fontSize: tamanho * 0.24 }}>
        {Math.round(Number.isFinite(pct) ? pct : 0)}%
      </span>
    </span>
  );
}

/** As mini barras do cartão: a última em cor cheia, as outras suaves. */
export function MiniBarras({ valores, tom = 'acento', rotulo }: { valores: number[]; tom?: TomDoPainel; rotulo: string }) {
  if (!valores.some(v => v > 0)) return null;
  const maior = Math.max(...valores);
  const cor = COR_DO_PAINEL[tom];
  return (
    <span role="img" aria-label={rotulo} className="flex h-10 shrink-0 items-end gap-[2px]">
      {valores.map((v, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="w-[5px] rounded-[3px]"
          // Pedaço sem nada fica num toco de 3px: a série continua lida como série.
          style={{
            height: v > 0 ? `${(v / maior) * 100}%` : 3,
            backgroundColor: i === valores.length - 1 && v > 0 ? cor : comAlfa(cor, v > 0 ? 28 : 14),
          }}
        />
      ))}
    </span>
  );
}

/** Soma uma série em `n` pedaços (as mini barras do cartão). */
export function baldes(valores: number[], n = 8): number[] {
  if (!valores.length) return [];
  const k = Math.min(n, valores.length);
  const out = Array.from({ length: k }, () => 0);
  valores.forEach((v, i) => { out[Math.min(k - 1, Math.floor((i * k) / valores.length))] += v; });
  return out;
}

export interface NumeroDoPainel {
  rotulo: string;
  valor: string;
  /** O valor por extenso quando o do cartão vem arredondado (dica e leitor de tela). */
  valorCompleto?: string;
  sub: string;
  tom: TomDoPainel;
  icone: LucideIcon;
  /** Pílula no canto: "↘ 22% do plano". */
  selo?: { tom: TomDoPainel; texto: string; seta?: 'sobe' | 'desce'; dica?: string } | null;
  barras?: { valores: number[]; rotulo: string } | null;
  anel?: { pct: number; rotulo: string } | null;
  aviso?: string;
  /** O cartão vira link (com a seta ↗ no canto). */
  href?: string;
  grande?: boolean;
}

/** O indicador das Análises: brilho no canto, casquinha, selo, número grande e mini gráfico. */
export function CartaoDeNumero({ n }: { n: NumeroDoPainel }) {
  const cor = COR_DO_PAINEL[n.tom];
  const conteudo = (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[60px] -top-[60px] size-[180px] rounded-[var(--fin-r-dot)]"
        style={{ backgroundImage: `radial-gradient(circle, ${comAlfa(cor, 14)}, transparent 70%)` }}
      />
      <span className="relative flex items-center gap-[var(--fin-s-2)]">
        <ChipDoTom tom={n.tom} icone={n.icone} tamanho={36} />
        <span className="flex-1" />
        {n.selo ? <SeloDoTom tom={n.selo.tom} seta={n.selo.seta} title={n.selo.dica}>{n.selo.texto}</SeloDoTom> : null}
        {n.href ? <ArrowUpRight aria-hidden="true" className="size-[15px] text-[var(--fin-text-3)] transition-colors group-hover:text-[var(--fin-accent)]" /> : null}
      </span>
      <span className="relative flex flex-col">
        <span className={cn(ROTULO, 'text-[var(--fin-text-3)]')}>{n.rotulo}</span>
        <span className="mt-1.5 flex items-end gap-[var(--fin-s-3)]">
          <span className="min-w-0 flex-1">
            {/* O número acompanha a largura do cartão (4 por linha no desktop, 1 no celular). */}
            <span
              title={n.valorCompleto}
              className={cn(
                'block truncate font-medium leading-[1.1] tracking-[-0.03em] tabular-nums text-[var(--fin-text)]',
                n.grande ? 'text-[length:clamp(24px,11cqw,30px)]' : 'text-[length:clamp(26px,12.5cqw,34px)]',
              )}
            >
              {n.valor}
            </span>
            <span className="fin-t-caption mt-1 block text-[var(--fin-text-2)]">{n.sub}</span>
          </span>
          {n.barras ? <MiniBarras valores={n.barras.valores} tom={n.tom} rotulo={n.barras.rotulo} /> : null}
          {n.anel ? <Anel pct={n.anel.pct} tom={n.tom} rotulo={n.anel.rotulo} /> : null}
        </span>
      </span>
      {n.aviso ? (
        <span className="fin-t-caption relative flex items-start gap-1.5 rounded-[12px] bg-[var(--fin-warning-soft)] px-2.5 py-2 text-[var(--fin-text-2)]">
          <Info aria-hidden="true" className="mt-px size-[13px] shrink-0 text-[var(--fin-warning-text)]" />{n.aviso}
        </span>
      ) : null}
    </>
  );
  const base = cn(CARTAO_DO_PAINEL, '@container group relative flex min-w-0 flex-col gap-3.5 overflow-hidden p-5 text-left');
  if (n.href) {
    return (
      <Link
        href={n.href}
        aria-label={`${n.rotulo}: ${n.valorCompleto ?? n.valor}. ${n.sub}`}
        className={cn(base, FOCO, 'transition-[transform,box-shadow,border-color] duration-[var(--fin-dur-base)] hover:-translate-y-0.5 hover:border-[var(--fin-border-strong)] hover:shadow-[var(--fin-e1)]')}
      >
        {conteudo}
      </Link>
    );
  }
  return <div className={base}>{conteudo}</div>;
}

/**
 * Uma linha de progresso das Análises: bolinha, nome, números, selo e a barra
 * em degradê; a marca vertical é onde o valor deveria estar (o ritmo).
 */
export function BarraDoTom({ tom, nome, numeros, selo, pct, marca, sub, children }: {
  tom: TomDoPainel;
  nome: string;
  numeros?: React.ReactNode;
  selo?: React.ReactNode;
  /** 0 a 100 (acima de 100 enche a barra). null: sem barra (sem dado). */
  pct: number | null;
  marca?: { pct: number; rotulo: string } | null;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const cor = COR_DO_PAINEL[tom];
  const largura = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const marcaVisivel = marca && marca.pct > 0 && marca.pct < 100 ? marca : null;
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="flex items-center gap-2.5">
        <i aria-hidden="true" className="size-2 shrink-0 rounded-[var(--fin-r-dot)]" style={{ backgroundColor: cor, boxShadow: `0 0 0 3px ${comAlfa(cor, 18)}` }} />
        <span className="fin-t-body-strong min-w-0 flex-1 truncate text-[var(--fin-text)]">{nome}</span>
        {numeros ? <span className="fin-t-caption whitespace-nowrap tabular-nums text-[var(--fin-text-3)]">{numeros}</span> : null}
        {selo}
      </span>
      {pct === null ? (
        <span aria-hidden="true" className="h-2 rounded-[var(--fin-r-dot)] border border-dashed border-[var(--fin-border-strong)]" />
      ) : (
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(largura)}
          aria-label={`${nome}: ${Math.round(pct)}%${marcaVisivel ? `. ${marcaVisivel.rotulo}: ${Math.round(marcaVisivel.pct)}%` : ''}`}
          className="relative h-2 rounded-[var(--fin-r-dot)] bg-[var(--fin-surface-2)]"
        >
          <span
            className="block h-full rounded-[var(--fin-r-dot)]"
            style={{ width: `${largura}%`, backgroundImage: `linear-gradient(90deg, ${comAlfa(cor, 55)}, ${cor})` }}
          />
          {marcaVisivel ? (
            <span
              aria-hidden="true"
              title={marcaVisivel.rotulo}
              className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-[var(--fin-r-sm)] bg-[var(--fin-text)]"
              style={{ left: `${marcaVisivel.pct}%` }}
            />
          ) : null}
        </span>
      )}
      {sub ? <span className="fin-t-caption flex flex-wrap items-center gap-1.5 pl-[18px] text-[var(--fin-text-3)]">{sub}</span> : null}
      {children ? <div className="pl-[18px]">{children}</div> : null}
    </div>
  );
}
