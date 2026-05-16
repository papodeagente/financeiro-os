'use client';

import { memo, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, EyeOff, Eye, CopyPlus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import type { SecaoProposta } from '@/lib/crm-types';
import type { IdiomaProposal } from '@/lib/i18n-proposta';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { getEmptyHint } from '@/lib/proposta-empty';

const TIPO_LABELS: Record<string, string> = {
  TEXTO: 'Texto',
  SERVICO: 'Serviço',
  VOO: 'Voo',
  ROTEIRO_DIA: 'Roteiro',
  GALERIA: 'Galeria',
  INCLUSOS: 'Inclusos',
  VALORES: 'Valores',
  DEPOIMENTO: 'Depoimento',
  CTA: 'CTA',
  VIDEO: 'Vídeo',
  MAPA: 'Mapa',
  FAQ: 'FAQ',
  COUNTDOWN: 'Countdown',
  ALOJAMENTO: 'Hospedagem',
  TRANSPORTE: 'Transporte',
};

interface Props {
  secao: SecaoProposta;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onToggleVisivel: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  corPrimaria: string;
  idioma: IdiomaProposal;
}

// Wrapper Elementor-like de cada bloco no canvas. O bloco renderiza o
// que o cliente final ve (via PreviewRenderer com 1 secao) e ganha:
// - Outline azul quando hover/selecionado
// - Mini-toolbar flutuante no topo: label (esq) + cluster de acoes (dir):
//   drag, editar (= selecionar), duplicar, ocultar, deletar
// - Overlay cinzento quando 'oculto' na proposta
// - Click no bloco -> onSelect (abre painel de propriedades a direita)
//
// O conteudo renderizado fica com pointer-events-none pra que clicks
// dentro de imagens/botoes nao tirem o foco do bloco — toda interacao
// passa pelo wrapper (click = selecionar; resto vai pro painel direito).
function SelectableBlockInner({
  secao, selected, onSelect, onDuplicate, onToggleVisivel, onRemove,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  corPrimaria, idioma,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: secao.id,
  });
  const hidden = secao.visivel === false;
  // Scroll suave pro bloco quando ele e selecionado (ex.: via Estrutura
  // tab ou prev/next no painel direito). Evita perder o bloco editado de
  // vista quando esta fora da janela. Skip se ja esta visivel.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selected || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!inView) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selected]);
  // Tons azuis estilo Elementor — selected mais saturado que hover.
  const colorBg = selected ? '#2563EB' : '#60A5FA';

  // Cada acao precisa stopPropagation pra nao re-disparar onSelect ao
  // clicar num botao da toolbar.
  const action = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  // Detecta se o bloco esta vazio pra mostrar empty state overlay com
  // dica + CTA pra editar. So aparece no editor (no /p/[slug] o bloco
  // renderiza como esta). Helper centralizado em /lib/proposta-empty.ts.
  const emptyHint = getEmptyHint(secao);

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        scrollRef.current = el;
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className="relative group"
      data-block-id={secao.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Outline (ring) — visivel quando selected (forte) ou hover (suave).
          Posicionado absoluto pra nao mexer no layout do conteudo. */}
      <div
        className={`absolute -inset-0.5 pointer-events-none rounded-lg transition-all ${
          selected
            ? 'ring-2 ring-[#2563EB] shadow-lg shadow-blue-500/15'
            : 'ring-0 group-hover:ring-2 group-hover:ring-blue-300'
        }`}
        style={{ zIndex: 5 }}
      />

      {/* Mini-toolbar Elementor-like — label esq + cluster acoes dir.
          Visivel quando selected ou hover. */}
      <div
        className={`absolute -top-7 left-0 right-0 flex items-center justify-between pointer-events-none transition-opacity z-20 ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {/* Label do tipo (esquerda) */}
        <div
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded-t-md text-[10px] uppercase tracking-wider font-semibold text-white shadow-sm"
          style={{ background: colorBg }}
        >
          {hidden && <EyeOff className="w-3 h-3" />}
          {TIPO_LABELS[secao.tipo] || secao.tipo}
        </div>

        {/* Cluster de acoes (direita) */}
        <div
          className="pointer-events-auto inline-flex items-center h-6 rounded-t-md overflow-hidden shadow-sm"
          style={{ background: colorBg }}
        >
          {/* Drag handle — usa listeners do useSortable */}
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 cursor-grab active:cursor-grabbing transition-colors"
            title="Arrastar para reordenar"
            aria-label="Arrastar"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-3.5 bg-white/30" />

          {/* Mover pra cima */}
          {onMoveUp && (
            <>
              <button
                onClick={action(onMoveUp)}
                disabled={!canMoveUp}
                className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Mover para cima"
                aria-label="Mover para cima"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-3.5 bg-white/30" />
            </>
          )}

          {/* Mover pra baixo */}
          {onMoveDown && (
            <>
              <button
                onClick={action(onMoveDown)}
                disabled={!canMoveDown}
                className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Mover para baixo"
                aria-label="Mover para baixo"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-3.5 bg-white/30" />
            </>
          )}

          {/* Editar (selecionar — abre painel direito) */}
          <button
            onClick={action(onSelect)}
            className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 transition-colors"
            title="Editar bloco"
            aria-label="Editar"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-3.5 bg-white/30" />

          {/* Duplicar */}
          <button
            onClick={action(onDuplicate)}
            className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 transition-colors"
            title="Duplicar bloco"
            aria-label="Duplicar"
          >
            <CopyPlus className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-3.5 bg-white/30" />

          {/* Ocultar / mostrar */}
          <button
            onClick={action(onToggleVisivel)}
            className="w-7 h-6 flex items-center justify-center text-white hover:bg-black/15 transition-colors"
            title={hidden ? 'Tornar visível' : 'Ocultar da proposta'}
            aria-label={hidden ? 'Mostrar' : 'Ocultar'}
          >
            {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <span className="w-px h-3.5 bg-white/30" />

          {/* Deletar */}
          <button
            onClick={action(onRemove)}
            className="w-7 h-6 flex items-center justify-center text-white hover:bg-red-500 transition-colors"
            title="Deletar bloco"
            aria-label="Deletar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Overlay de bloco oculto */}
      {hidden && (
        <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] flex items-center justify-center pointer-events-none rounded-lg">
          <span className="inline-flex items-center gap-1.5 text-xs uppercase font-semibold text-gray-700 bg-white border border-gray-300 px-3 py-1.5 rounded-full shadow-sm">
            <EyeOff className="w-3.5 h-3.5" />
            Oculto na proposta
          </span>
        </div>
      )}

      {/* PLACEHOLDER — coluna vazia de uma row estrutural. CTA grande
          convidando o usuario a clicar pra escolher o tipo do bloco no
          painel direito. So aparece no editor (preview publico nao
          renderiza PLACEHOLDER). */}
      {secao.tipo === 'PLACEHOLDER' && !hidden ? (
        <div className="pointer-events-none cursor-pointer py-6 px-3">
          <div className="bg-blue-50/50 border-2 border-dashed border-blue-300 rounded-xl px-3 py-8 text-center hover:bg-blue-50 hover:border-blue-400 transition-colors min-h-[140px] flex flex-col items-center justify-center">
            <div className="text-3xl mb-2" aria-hidden>＋</div>
            <div className="text-sm font-semibold text-blue-700 mb-1">
              Coluna vazia
            </div>
            <div className="text-[11px] text-blue-600/80 leading-relaxed mb-3 max-w-[200px]">
              Clique pra escolher um tipo de bloco
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold">
              <Pencil className="w-3 h-3" /> Escolher tipo
            </div>
          </div>
        </div>
      ) : emptyHint && !hidden ? (
        <div className="pointer-events-none cursor-pointer py-12 px-4">
          <div className="mx-auto bg-white border-2 border-dashed border-[var(--t-green)]/40 rounded-xl px-5 py-6 max-w-md text-center shadow-sm">
            <div className="text-4xl mb-2" aria-hidden>{emptyHint.icon}</div>
            <div className="text-base font-semibold text-[var(--t-text)] mb-1">
              {emptyHint.title}
            </div>
            <div className="text-xs text-[var(--t-text-muted)] leading-relaxed mb-3">
              {emptyHint.description}
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--t-green)]/10 text-[var(--t-green)] text-[10px] uppercase tracking-wider font-semibold">
              <Pencil className="w-3 h-3" /> Clique para editar
            </div>
          </div>
        </div>
      ) : (
        /* Conteudo renderizado normal — pointer-events-none pra que
           clicks passem direto pro wrapper externo (selecao do bloco) */
        <div className="pointer-events-none cursor-pointer">
          <PreviewRenderer
            secoes={[{ ...secao, visivel: true }]}
            corPrimaria={corPrimaria}
            idioma={idioma}
          />
        </div>
      )}
    </div>
  );
}


// React.memo removido temporariamente pra eliminar comparator como
// possivel causa de stale state com dnd-kit. Pode reintroduzir
// depois se performance for problema com 50+ blocos.
export const SelectableBlock = SelectableBlockInner;
