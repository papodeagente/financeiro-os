'use client';

import {
  DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Columns3, GripVertical, Rows3, X } from 'lucide-react';

import { CAMPOS_DO_DEMONSTRATIVO, ROTULO_DO_CAMPO, type CampoDemonstrativo } from '@/lib/resultado-por-categoria';
import { cn } from '@/lib/utils';

export interface Disposicao {
  linhas: CampoDemonstrativo[];
  colunas: CampoDemonstrativo[];
}

type Zona = 'linhas' | 'colunas' | 'disponiveis';

const TITULO_ZONA: Record<Zona, string> = { linhas: 'Linhas', colunas: 'Colunas', disponiveis: 'Campos disponíveis' };
const DICA_ZONA: Record<Zona, string> = {
  linhas: 'De fora para dentro: o primeiro agrupa os seguintes.',
  colunas: 'Sem campo, a tabela mostra só o total.',
  disponiveis: 'Arraste para Linhas ou Colunas.',
};

/** Tira o campo de onde estiver e põe na zona pedida (no fim ou na posição). */
export function moverCampo(d: Disposicao, campo: CampoDemonstrativo, destino: Zona, posicao?: number): Disposicao {
  const linhas = d.linhas.filter(c => c !== campo);
  const colunas = d.colunas.filter(c => c !== campo);
  if (destino === 'disponiveis') return { linhas, colunas };
  const alvo = destino === 'linhas' ? linhas : colunas;
  const i = posicao === undefined ? alvo.length : Math.max(0, Math.min(posicao, alvo.length));
  alvo.splice(i, 0, campo);
  return { linhas, colunas };
}

const BOTAO = cn(
  'inline-flex size-7 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)]',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-40',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--fin-accent)] max-lg:size-9',
);

function Campo({
  campo, zona, indice, total, onMover,
}: {
  campo: CampoDemonstrativo;
  zona: Zona;
  indice: number;
  total: number;
  onMover: (destino: Zona, posicao?: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: campo, data: { zona } });
  const nome = ROTULO_DO_CAMPO[campo];
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'flex items-center gap-0.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] py-0.5 pl-0.5 pr-1',
        isDragging && 'relative z-[var(--fin-z-popover)] shadow-[var(--fin-e1)]',
      )}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Arrastar ${nome}`}
        className={cn(BOTAO, 'cursor-grab touch-none active:cursor-grabbing')}
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      <span className="px-1 fin-t-body font-medium text-[var(--fin-text)]">{nome}</span>
      {zona !== 'disponiveis' ? (
        <>
          <button type="button" className={BOTAO} disabled={indice === 0} onClick={() => onMover(zona, indice - 1)} aria-label={`${nome} para antes`} title="Para antes">
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </button>
          <button type="button" className={BOTAO} disabled={indice === total - 1} onClick={() => onMover(zona, indice + 1)} aria-label={`${nome} para depois`} title="Para depois">
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        </>
      ) : null}
      {zona !== 'linhas' ? (
        <button type="button" className={BOTAO} onClick={() => onMover('linhas')} aria-label={`Levar ${nome} para Linhas`} title="Levar para Linhas">
          <Rows3 aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {zona !== 'colunas' ? (
        <button type="button" className={BOTAO} onClick={() => onMover('colunas')} aria-label={`Levar ${nome} para Colunas`} title="Levar para Colunas">
          <Columns3 aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {zona !== 'disponiveis' ? (
        <button type="button" className={BOTAO} onClick={() => onMover('disponiveis')} aria-label={`Tirar ${nome} da tabela`} title="Tirar da tabela">
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function AreaDeCampos({
  zona, campos, onMover,
}: {
  zona: Zona;
  campos: CampoDemonstrativo[];
  onMover: (campo: CampoDemonstrativo, destino: Zona, posicao?: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zona });
  return (
    <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
      <span className="fin-t-overline text-[var(--fin-text-3)]" id={`zona-${zona}`}>{TITULO_ZONA[zona]}</span>
      <ul
        ref={setNodeRef}
        aria-labelledby={`zona-${zona}`}
        className={cn(
          'flex min-h-12 flex-wrap items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-dashed p-[var(--fin-s-2)]',
          'transition-colors duration-[var(--fin-dur-rapida)]',
          isOver ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)]',
        )}
      >
        {campos.length === 0 ? (
          <li className="px-1 fin-t-caption text-[var(--fin-text-3)]">{DICA_ZONA[zona]}</li>
        ) : campos.map((c, i) => (
          <Campo key={c} campo={c} zona={zona} indice={i} total={campos.length} onMover={(d, p) => onMover(c, d, p)} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Os campos da tabela dinâmica (05/11/2026): arrastar entre Linhas, Colunas e
 * Disponíveis, ou usar os botões de cada campo (teclado e toque).
 */
export function CamposDaTabela({ disposicao, onChange }: { disposicao: Disposicao; onChange: (d: Disposicao) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const usados = new Set([...disposicao.linhas, ...disposicao.colunas]);
  const disponiveis = CAMPOS_DO_DEMONSTRATIVO.filter(c => !usados.has(c));

  function mover(campo: CampoDemonstrativo, destino: Zona, posicao?: number) {
    onChange(moverCampo(disposicao, campo, destino, posicao));
  }

  function aoSoltar(ev: DragEndEvent) {
    const destino = ev.over?.id as Zona | undefined;
    if (!destino) return;
    mover(ev.active.id as CampoDemonstrativo, destino);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={aoSoltar}>
      <div className="grid gap-[var(--fin-s-3)] lg:grid-cols-[1fr_1fr_1fr]">
        <AreaDeCampos zona="linhas" campos={disposicao.linhas} onMover={mover} />
        <AreaDeCampos zona="colunas" campos={disposicao.colunas} onMover={mover} />
        <AreaDeCampos zona="disponiveis" campos={disponiveis} onMover={mover} />
      </div>
    </DndContext>
  );
}

export default CamposDaTabela;
