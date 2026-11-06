'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErroDaMudanca, type Lote } from '@/lib/migracao/contrato-telas';
import type { IdDaEtapa } from '@/lib/migracao/telas/assistente';
import { mensagemDeErro } from '@/lib/migracao/telas/assistente';
import { cn } from '@/lib/utils';

/**
 * Peças comuns aos 7 passos do assistente "Mudar para o EnturOS"
 * (05/11/2026): o painel de cada passo, a barra de ações do pé e o que cada
 * passo recebe do assistente.
 */

export interface PropsDoPasso {
  lote: Lote | null;
  /** Troca o lote na tela depois de uma resposta do servidor. */
  onLote: (lote: Lote) => void;
  irPara: (etapa: IdDaEtapa) => void;
}

export const PAINEL = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
export const CONTROLE = cn(
  'h-11 w-full min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] lg:h-10',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] disabled:cursor-not-allowed disabled:opacity-60',
);

/** Erro de qualquer chamada em uma frase simples. */
export function textoDoErro(e: unknown): string {
  if (e instanceof ErroDaMudanca) return mensagemDeErro(e.codigo, e.message, e.status);
  return 'Algo deu errado. Nada foi gravado; tente de novo.';
}

/**
 * O pé de cada passo: voltar à esquerda, o motivo de não poder seguir no
 * meio (em vez de um botão cinza mudo) e a ação do passo à direita.
 */
export function BarraDoPasso({ voltar, principal, bloqueio, extra }: {
  voltar?: { rotulo: string; onClick: () => void };
  principal?: { rotulo: string; onClick: () => void; carregando?: boolean; icone?: React.ComponentType<{ className?: string }>; tom?: 'padrao' | 'destrutivo' };
  bloqueio?: string | null;
  extra?: React.ReactNode;
}) {
  const Icone = principal?.icone ?? ArrowRight;
  return (
    <div className="flex flex-col-reverse gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:flex-row sm:items-center">
      {voltar ? (
        <Button variant="ghost" onClick={voltar.onClick} className="max-sm:w-full">
          <ArrowLeft aria-hidden="true" /> {voltar.rotulo}
        </Button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:items-end sm:text-right">
        {bloqueio ? <p className="fin-t-caption text-[var(--fin-text-2)]" aria-live="polite">{bloqueio}</p> : null}
      </div>
      {extra}
      {principal ? (
        <Button
          variant={principal.tom === 'destrutivo' ? 'destructive' : 'default'}
          onClick={principal.onClick}
          disabled={Boolean(bloqueio) || principal.carregando}
          aria-busy={principal.carregando || undefined}
          className="max-sm:w-full"
        >
          {principal.rotulo}
          {principal.carregando ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Icone aria-hidden="true" />}
        </Button>
      ) : null}
    </div>
  );
}

/** Título e uma frase no topo do passo. */
export function CabecaDoPasso({ titulo, children, id }: { titulo: string; children?: React.ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
      {children ? <p className="max-w-[72ch] fin-t-body text-[var(--fin-text-2)]">{children}</p> : null}
    </div>
  );
}

export function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/** "1.240" */
export function contagem(n: number): string {
  return n.toLocaleString('pt-BR');
}

export function plural(n: number, um: string, varios: string): string {
  return `${contagem(n)} ${n === 1 ? um : varios}`;
}
