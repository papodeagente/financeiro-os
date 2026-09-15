import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn, formatBRL } from '@/lib/utils';

export const moneyVariants = cva('fin-money', {
  variants: {
    // Os algarismos vêm POR DEGRAU, não na base: coluna de tabela precisa de
    // tabular (dígitos alinham entre linhas) e a manchete precisa de
    // proporcional (tabular deixa o "1" boiando na caixa e desalinha o início
    // do número num corpo grande).
    size: {
      caption: 'fin-t-caption tabular-nums',
      body: 'fin-t-body tabular-nums',
      strong: 'fin-t-body-strong tabular-nums',
      metricSm: 'fin-t-metric-sm tabular-nums',
      metric: 'fin-t-metric tabular-nums',
      resposta: 'fin-t-resposta proportional-nums',
    },
    tone: {
      neutro: 'text-[var(--fin-text)]',
      positivo: 'text-[var(--fin-positive)]',
      negativo: 'text-[var(--fin-negative)]',
      suave: 'text-[var(--fin-text-3)]',
    },
    align: { direita: 'text-right', esquerda: 'text-left' },
  },
  defaultVariants: { size: 'body', tone: 'neutro', align: 'direita' },
});

export type MoneyEstado = 'ok' | 'carregando' | 'indisponivel';

export type MoneyProps = VariantProps<typeof moneyVariants> & {
  /** Valor já calculado pelos helpers auditados. O componente nunca faz aritmética. */
  valor: number | null | undefined;
  /** 'carregando' e 'indisponivel' NUNCA pintam número. Impede o R$ 0,00 falso. */
  estado?: MoneyEstado;
  /** Moeda estrangeira exibida como sublinha em caption, nunca em coluna nova. */
  original?: { valor: number; moeda: string; cambio: number } | null;
  /** 'auto' mostra menos em negativo; 'sempre' força o + em positivo. */
  sinal?: 'auto' | 'nunca' | 'sempre';
  /** Código ISO. Default 'BRL'. Existe para o i18n futuro não exigir reescrita. */
  moeda?: string;
  className?: string;
  'aria-label'?: string;
};

type Degrau = NonNullable<NonNullable<VariantProps<typeof moneyVariants>>['size']>;

const LARGURA_MINIMA: Record<Degrau, string> = {
  caption: 'min-w-[72px]',
  body: 'min-w-[112px]',
  strong: 'min-w-[112px]',
  metricSm: 'min-w-[140px]',
  metric: 'min-w-[200px]',
  // A resposta não reserva largura: ela é a manchete e ocupa a linha dela.
  // Um piso de 200px em 343px úteis empurraria "R$ 1.234.567,89" para fora.
  resposta: 'min-w-0',
};

const ALTURA_ESQUELETO: Record<Degrau, string> = {
  caption: 'h-[12px]',
  body: 'h-[16px]',
  strong: 'h-[16px]',
  metricSm: 'h-[22px]',
  metric: 'h-[32px]',
  resposta: 'h-[44px]',
};

function formatarMoeda(valor: number, moeda: string): string {
  if (moeda === 'BRL') return formatBRL(valor);
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(valor);
  } catch {
    return formatBRL(valor);
  }
}

function formatarCambio(cambio: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cambio);
}

function aplicarSinal(texto: string, valor: number, sinal: 'auto' | 'nunca' | 'sempre'): string {
  if (sinal === 'nunca') return texto.replace(/-\s*/, '');
  if (sinal === 'sempre' && valor > 0) return `+${texto}`;
  return texto;
}

export function Money({
  valor,
  estado = 'ok',
  original = null,
  sinal = 'auto',
  moeda = 'BRL',
  size,
  tone,
  align,
  className,
  'aria-label': ariaLabel,
}: MoneyProps) {
  const degrau: Degrau = size ?? 'body';
  const alinhamento = align ?? 'direita';

  if (estado === 'carregando') {
    return (
      <span
        data-fin-money="carregando"
        role="status"
        aria-label={ariaLabel ?? 'Carregando valor'}
        className={cn(
          'inline-flex w-full',
          alinhamento === 'esquerda' ? 'justify-start' : 'justify-end',
          LARGURA_MINIMA[degrau],
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'block w-full rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]',
            ALTURA_ESQUELETO[degrau],
          )}
        />
      </span>
    );
  }

  if (estado === 'indisponivel') {
    return (
      <span
        data-fin-money="indisponivel"
        title="Não foi possível carregar"
        aria-label={ariaLabel ?? 'Valor não disponível'}
        className={cn(
          moneyVariants({ size: degrau, tone: 'suave', align: alinhamento }),
          'inline-block',
          LARGURA_MINIMA[degrau],
          className,
        )}
      >
        {'—'}
      </span>
    );
  }

  const texto =
    valor === null || valor === undefined
      ? formatBRL(valor)
      : aplicarSinal(formatarMoeda(valor, moeda), valor, sinal);

  const numero = (
    <span
      data-fin-money="ok"
      aria-label={ariaLabel}
      className={cn(
        moneyVariants({ size: degrau, tone, align: alinhamento }),
        'inline-block',
        LARGURA_MINIMA[degrau],
        className,
      )}
    >
      {texto}
    </span>
  );

  if (!original) return numero;

  return (
    <span
      className={cn(
        'inline-flex flex-col gap-1',
        alinhamento === 'esquerda' ? 'items-start' : 'items-end',
      )}
    >
      {numero}
      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
        {`${formatarMoeda(original.valor, original.moeda)} a ${formatarCambio(original.cambio)}`}
      </span>
    </span>
  );
}

export default Money;
