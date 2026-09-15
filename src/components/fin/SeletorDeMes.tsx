'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { hojeISO, mesDe } from '@/lib/money';

/**
 * O mês do pilar Equipe, em UM controle só, guardado na URL.
 *
 * POR QUE NA URL. Hoje cada tela tem o próprio seletor: trocar para agosto no
 * Painel e clicar em "Ver metas e ranking" devolve setembro, sem aviso. Com o
 * mês em ?mes=YYYY-MM o período atravessa a navegação, sobrevive ao recarregar
 * e pode ser mandado por link para outra pessoa da agência.
 *
 * Lê e escreve por history.replaceState em vez de useSearchParams: o hook
 * exige fronteira de Suspense em página cliente e transformaria um seletor de
 * mês em risco de build.
 */

export function mesAnterior(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  const t = a * 12 + (m - 1) - 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function mesSeguinte(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  const t = a * 12 + (m - 1) + 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function rotuloDoMes(ym: string, formato: 'longo' | 'curto' = 'longo'): string {
  const [a, m] = ym.split('-').map(Number);
  if (!a || !m) return ym;
  return new Date(a, m - 1, 15).toLocaleDateString('pt-BR', {
    month: formato === 'longo' ? 'long' : 'short',
    year: 'numeric',
  });
}

const VALIDO = /^\d{4}-\d{2}$/;

/** O mês da URL, ou o mês de hoje. Valor fora de forma é ignorado em silêncio. */
export function useMesDaUrl(): [string, (m: string) => void] {
  const [mes, setMes] = React.useState(() => mesDe(hojeISO()));

  React.useEffect(() => {
    const daUrl = new URLSearchParams(window.location.search).get('mes');
    if (daUrl && VALIDO.test(daUrl)) setMes(daUrl);
  }, []);

  const trocar = React.useCallback((novo: string) => {
    if (!VALIDO.test(novo)) return;
    setMes(novo);
    const url = new URL(window.location.href);
    url.searchParams.set('mes', novo);
    window.history.replaceState(null, '', url);
  }, []);

  return [mes, trocar];
}

export function SeletorDeMes({
  valor,
  onChange,
  /** Não deixa navegar para depois do mês corrente: mês futuro não tem fato. */
  maximo,
  className,
}: {
  valor: string;
  onChange: (mes: string) => void;
  maximo?: string;
  className?: string;
}) {
  const teto = maximo ?? mesDe(hojeISO());
  const proximo = mesSeguinte(valor);
  const podeAvancar = proximo <= teto;

  const botao =
    'inline-flex h-11 w-11 items-center justify-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] ' +
    'text-[var(--fin-text-2)] transition-colors hover:bg-[var(--fin-surface-2)] disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        className={botao}
        aria-label={`Ver ${rotuloDoMes(mesAnterior(valor))}`}
        onClick={() => onChange(mesAnterior(valor))}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>

      {/* Abreviado no celular, por extenso a partir de sm: o mês por extenso
          em 375px empurra as setas para fora da linha. */}
      <span className="fin-t-body-strong min-w-[104px] text-center text-[var(--fin-text)]">
        <span className="sm:hidden">{rotuloDoMes(valor, 'curto')}</span>
        <span className="hidden sm:inline">{rotuloDoMes(valor)}</span>
      </span>

      <button
        type="button"
        className={botao}
        disabled={!podeAvancar}
        aria-label={podeAvancar ? `Ver ${rotuloDoMes(proximo)}` : 'O mês seguinte ainda não começou'}
        onClick={() => podeAvancar && onChange(proximo)}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

export default SeletorDeMes;
