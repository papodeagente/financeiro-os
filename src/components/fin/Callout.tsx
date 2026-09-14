'use client';

/**
 * Um aviso que ocupa a largura do conteúdo e diz o que fazer.
 *
 * O sistema vinha montando essas caixas à mão em cada tela, cada uma com uma
 * cor e um espaçamento. Aqui o tom decide a cor, e um aviso negativo nasce
 * como role="alert" — o resto como role="status", que não interrompe quem usa
 * leitor de tela no meio de outra coisa.
 */

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TomDoCallout = 'info' | 'aviso' | 'positivo' | 'negativo';

const APARENCIA: Record<TomDoCallout, { caixa: string; icone: string; titulo: string }> = {
  info: {
    caixa: 'border-[var(--fin-border)] bg-[var(--fin-surface-2)]',
    icone: 'text-[var(--fin-text-3)]',
    titulo: 'text-[var(--fin-text)]',
  },
  aviso: {
    caixa: 'border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]',
    icone: 'text-[var(--fin-warning-text)]',
    titulo: 'text-[var(--fin-warning-text)]',
  },
  positivo: {
    caixa: 'border-[var(--fin-positive)] bg-[var(--fin-surface-2)]',
    icone: 'text-[var(--fin-positive)]',
    titulo: 'text-[var(--fin-positive)]',
  },
  negativo: {
    caixa: 'border-[var(--fin-negative)] bg-[var(--fin-surface-2)]',
    icone: 'text-[var(--fin-negative)]',
    titulo: 'text-[var(--fin-negative)]',
  },
};

const ICONE: Record<TomDoCallout, typeof Info> = {
  info: Info,
  aviso: AlertTriangle,
  positivo: CheckCircle2,
  negativo: XCircle,
};

export interface CalloutProps {
  tom?: TomDoCallout;
  titulo?: string;
  children?: React.ReactNode;
  /** Ação principal. No celular ocupa a largura toda. */
  acao?: { rotulo: string; onClick: () => void; carregando?: boolean };
  acaoSecundaria?: { rotulo: string; onClick: () => void };
  className?: string;
}

export function Callout({
  tom = 'info',
  titulo,
  children,
  acao,
  acaoSecundaria,
  className,
}: CalloutProps) {
  const aparencia = APARENCIA[tom];
  const Icone = ICONE[tom];
  return (
    <div
      role={tom === 'negativo' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--fin-r-lg)] border p-4',
        aparencia.caixa,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icone aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', aparencia.icone)} />
        <div className="flex min-w-0 flex-col gap-1">
          {titulo ? (
            <span className={cn('fin-t-body-strong', aparencia.titulo)}>{titulo}</span>
          ) : null}
          {children ? (
            <div className="fin-t-caption text-[var(--fin-text-2)]">{children}</div>
          ) : null}
        </div>
      </div>
      {acao || acaoSecundaria ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {acaoSecundaria ? (
            <button
              type="button"
              onClick={acaoSecundaria.onClick}
              className="fin-t-body h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface)] lg:h-10"
            >
              {acaoSecundaria.rotulo}
            </button>
          ) : null}
          {acao ? (
            <button
              type="button"
              onClick={acao.onClick}
              disabled={acao.carregando}
              className="fin-t-body h-11 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 text-white hover:opacity-90 disabled:opacity-60 lg:h-10"
            >
              {acao.rotulo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
