'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { TRACEJADO_AUSENCIA } from '@/lib/escala';
import { useMolduraDoGrafico } from '@/components/fin/GraficoMoldura';
import { Balao, useBalao } from '@/components/fin/Balao';

/**
 * Uma marca por PESSOA.
 *
 * POR QUE NÃO É UM PERCENTUAL. Com cinco pessoas, "60% da equipe recebe
 * comissão" esconde o n e finge uma precisão que não existe; e uma rosca de
 * duas fatias seria o pior desenho disponível para o caso. A unidade conta a
 * história certa — faltam estes dois, com nome — e degrada até n=1 sem virar
 * decoração.
 *
 * OS TRÊS ESTADOS SE DISTINGUEM POR FORMA ANTES DE COR: preenchida, contorno
 * e contorno tracejado. Tracejado é ausência, coerente com o resto do sistema.
 */

export type EstadoDaUnidade = 'preenchida' | 'contorno' | 'tracejada';

export type Unidade = {
  id: string;
  rotulo: string;
  estado: EstadoDaUnidade;
  /** 'Karen · sem plano · não gera comissão' */
  descricao: string;
};

export type UnidadesProps = {
  unidades: Unidade[];
  legenda: { estado: EstadoDaUnidade; rotulo: string }[];
  onAtivar?: (id: string) => void;
  /** Acima disto a forma cede lugar à contagem: parede de quadradinhos não é gráfico. */
  maximo?: number;
  className?: string;
};

const LADO = 16;
const MAXIMO_PADRAO = 24;

function Pastilha({ estado, tamanho = LADO }: { estado: EstadoDaUnidade; tamanho?: number }) {
  const comum = { x: 0.75, y: 0.75, width: tamanho - 1.5, height: tamanho - 1.5, rx: 4 };
  if (estado === 'preenchida') return <rect {...comum} fill="var(--fin-serie-1)" />;
  return (
    <rect
      {...comum}
      fill="none"
      stroke="var(--fin-eixo)"
      strokeWidth={1.5}
      strokeDasharray={estado === 'tracejada' ? TRACEJADO_AUSENCIA : undefined}
    />
  );
}

export function Unidades({ unidades, legenda, onAtivar, maximo = MAXIMO_PADRAO, className }: UnidadesProps) {
  const { container } = useMolduraDoGrafico();
  const balao = useBalao(container);

  if (unidades.length === 0) return null;

  // Acima do teto a contagem nomeada lê melhor que a parede de marcas.
  if (unidades.length > maximo) {
    const porEstado = legenda.map(l => ({
      ...l,
      quantos: unidades.filter(u => u.estado === l.estado).length,
    }));
    return (
      <ul className={cn('flex flex-col gap-1', className)}>
        {porEstado.map(e => (
          <li key={e.estado} className="fin-t-body text-[var(--fin-text-2)]">
            {`${e.quantos} ${e.rotulo}`}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn('relative flex flex-col gap-3', className)}>
      {/* <ul> de verdade: o gráfico não é um bloco opaco para quem lê com
          leitor de tela, e a ordem do Tab é a mesma da lista abaixo. */}
      <ul className="flex flex-wrap gap-3">
        {unidades.map(u => (
          <li key={u.id}>
            <div
              role="button"
              tabIndex={0}
              aria-label={u.descricao}
              onMouseEnter={e => balao.abrir(e.currentTarget, { id: u.id, titulo: u.rotulo, linhas: [u.descricao] }, false)}
              onMouseLeave={() => { if (!balao.porTeclado) balao.fechar(); }}
              onFocus={e => balao.abrir(e.currentTarget, { id: u.id, titulo: u.rotulo, linhas: [u.descricao] }, true)}
              onBlur={() => balao.fechar()}
              onTouchStart={e => balao.abrir(e.currentTarget, { id: u.id, titulo: u.rotulo, linhas: [u.descricao] }, false)}
              onTouchEnd={() => balao.fecharDepoisDoToque()}
              onClick={() => onAtivar?.(u.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onAtivar?.(u.id);
                }
              }}
              // A pastilha tem 16px; o alvo, 44px. É o alvo que define a
              // altura da fileira.
              className={cn(
                'flex min-h-[44px] w-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--fin-r-sm)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                onAtivar && 'hover:bg-[var(--fin-surface-2)]',
              )}
            >
              <svg width={LADO} height={LADO} viewBox={`0 0 ${LADO} ${LADO}`} aria-hidden="true">
                <Pastilha estado={u.estado} />
              </svg>
              <span className="fin-t-caption w-full truncate text-center text-[var(--fin-text-3)]">
                {u.rotulo.split(' ')[0]}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Legenda nomeando os três estados: o preenchimento nunca é o único
          portador do significado. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {legenda.map(l => (
          <li key={l.estado} className="flex items-center gap-2">
            <svg width={12} height={12} viewBox={`0 0 ${LADO} ${LADO}`} aria-hidden="true" className="shrink-0">
              <Pastilha estado={l.estado} />
            </svg>
            <span className="fin-t-caption text-[var(--fin-text-2)]">{l.rotulo}</span>
          </li>
        ))}
      </ul>

      <Balao container={container} conteudo={balao.conteudo} posicao={balao.posicao} porTeclado={balao.porTeclado} />
    </div>
  );
}

export default Unidades;
