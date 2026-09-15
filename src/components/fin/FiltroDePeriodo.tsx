'use client';

import * as React from 'react';
import { CalendarRange } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  PERIODOS_NA_ORDEM, ROTULO_DE_PERIODO, resolverPeriodo,
  type ChaveDePeriodo, type JanelaDePeriodo,
} from '@/lib/periodo-financeiro';
import { hojeISO } from '@/lib/money';

/**
 * O período do painel, e a comparação que vem junto.
 *
 * DUAS DECISÕES QUE EVITAM MENTIRA:
 *
 * 1. As janelas do mês, trimestre e ano CORRENTES terminam HOJE, não no último
 *    dia do calendário. Somar um mês inteiro de despesa contra vinte dias de
 *    receita anuncia um prejuízo que não existe.
 * 2. A comparação tem o MESMO tamanho da janela. Comparar quinze dias de
 *    setembro com trinta e um de agosto produz uma queda que é só diferença de
 *    tamanho de janela — e ninguém percebe olhando a seta vermelha.
 *
 * A janela escolhida vive na URL, então o período atravessa o recarregar e pode
 * ser mandado por link para o contador.
 */

const CHAVE_VALIDA = new Set<string>(PERIODOS_NA_ORDEM);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export type EstadoDoPeriodo = {
  chave: ChaveDePeriodo;
  de: string;
  ate: string;
};

/** Lê o período da URL e o mantém lá. Sem useSearchParams, que exigiria
 *  fronteira de Suspense numa página cliente e transformaria um filtro em
 *  risco de build. */
export function usePeriodoDaUrl(): [JanelaDePeriodo, EstadoDoPeriodo, (e: EstadoDoPeriodo) => void] {
  const hoje = hojeISO();
  const [estado, setEstado] = React.useState<EstadoDoPeriodo>(() => {
    const j = resolverPeriodo('ESTE_MES', hoje);
    return { chave: 'ESTE_MES', de: j.de, ate: j.ate };
  });

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const chave = p.get('periodo') ?? '';
    const de = p.get('de') ?? '';
    const ate = p.get('ate') ?? '';
    if (!CHAVE_VALIDA.has(chave)) return;
    const j = resolverPeriodo(chave as ChaveDePeriodo, hoje, {
      de: DATA.test(de) ? de : undefined,
      ate: DATA.test(ate) ? ate : undefined,
    });
    setEstado({ chave: chave as ChaveDePeriodo, de: j.de, ate: j.ate });
  }, [hoje]);

  const trocar = React.useCallback((novo: EstadoDoPeriodo) => {
    setEstado(novo);
    const url = new URL(window.location.href);
    url.searchParams.set('periodo', novo.chave);
    if (novo.chave === 'PERSONALIZADO') {
      url.searchParams.set('de', novo.de);
      url.searchParams.set('ate', novo.ate);
    } else {
      url.searchParams.delete('de');
      url.searchParams.delete('ate');
    }
    window.history.replaceState(null, '', url);
  }, []);

  const janela = React.useMemo(
    () => resolverPeriodo(estado.chave, hoje, { de: estado.de, ate: estado.ate }),
    [estado, hoje],
  );

  return [janela, estado, trocar];
}

const CONTROLE =
  'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 ' +
  'fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export function FiltroDePeriodo({
  janela,
  estado,
  onChange,
  className,
}: {
  janela: JanelaDePeriodo;
  estado: EstadoDoPeriodo;
  onChange: (e: EstadoDoPeriodo) => void;
  className?: string;
}) {
  const hoje = hojeISO();
  const dataBR = (iso: string) => iso.split('-').reverse().join('/');

  function escolher(chave: ChaveDePeriodo) {
    const j = resolverPeriodo(chave, hoje, { de: estado.de, ate: estado.ate });
    onChange({ chave, de: j.de, ate: j.ate });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <label className="sr-only" htmlFor="periodo-do-painel">
        Período
      </label>
      <div className="relative">
        <CalendarRange
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fin-text-3)]"
          aria-hidden="true"
        />
        <select
          id="periodo-do-painel"
          className={cn(CONTROLE, 'pl-9 pr-2')}
          value={estado.chave}
          onChange={e => escolher(e.target.value as ChaveDePeriodo)}
        >
          {PERIODOS_NA_ORDEM.map(c => (
            <option key={c} value={c}>
              {ROTULO_DE_PERIODO[c]}
            </option>
          ))}
        </select>
      </div>

      {estado.chave === 'PERSONALIZADO' && (
        <>
          <input
            type="date"
            aria-label="Data inicial"
            className={CONTROLE}
            value={estado.de}
            max={estado.ate}
            onChange={e => onChange({ ...estado, de: e.target.value || estado.de })}
          />
          <span className="fin-t-caption text-[var(--fin-text-3)]">até</span>
          <input
            type="date"
            aria-label="Data final"
            className={CONTROLE}
            value={estado.ate}
            min={estado.de}
            onChange={e => onChange({ ...estado, ate: e.target.value || estado.ate })}
          />
        </>
      )}

      {/* A janela escrita por extenso: "Este mês" não diz se termina hoje ou
          no dia 30, e essa diferença muda todo número da tela. */}
      <span className="fin-t-caption text-[var(--fin-text-3)]">
        {`${dataBR(janela.de)} a ${dataBR(janela.ate)}`}
        {janela.comparacao === 'ano-anterior' ? ' · comparado com o ano passado' : ' · comparado com o período anterior'}
      </span>
    </div>
  );
}

export default FiltroDePeriodo;
