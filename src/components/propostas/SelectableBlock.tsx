'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, EyeOff } from 'lucide-react';
import type { SecaoProposta } from '@/lib/crm-types';
import type { IdiomaProposal } from '@/lib/i18n-proposta';
import { PreviewRenderer } from './preview/PreviewRenderer';

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
  corPrimaria: string;
  idioma: IdiomaProposal;
}

// Wrapper Elementor-like de cada bloco no canvas. O bloco renderiza o
// que o cliente final ve (via PreviewRenderer com 1 secao) e ganha:
// - Outline azul quando hover/selecionado
// - Label flutuante no topo com tipo do bloco
// - Drag handle pra reordenar (dnd-kit sortable)
// - Overlay cinzento sobre o conteudo quando 'oculto' na proposta
// - Click no bloco -> onSelect
//
// O conteudo renderizado fica com pointer-events-none pra que clicks
// dentro de imagens/botoes nao tirem o foco do bloco — toda interacao
// passa pelo wrapper (click = selecionar; o resto vai pro painel direito).
export function SelectableBlock({ secao, selected, onSelect, corPrimaria, idioma }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: secao.id,
  });
  const hidden = secao.visivel === false;

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className="relative group cursor-pointer"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Outline (ring) — sempre presente quando selected; aparece on hover senao */}
      <div
        className={`absolute inset-0 pointer-events-none rounded-lg transition-all ${
          selected
            ? 'ring-2 ring-[#2563EB] ring-offset-2 ring-offset-white shadow-lg shadow-blue-500/10'
            : 'ring-0 group-hover:ring-2 group-hover:ring-blue-300 group-hover:ring-offset-2 group-hover:ring-offset-white'
        }`}
        style={{ zIndex: 5 }}
      />

      {/* Label flutuante no topo com tipo + drag handle */}
      <div
        className={`absolute -top-6 left-0 right-0 flex items-center justify-between transition-opacity z-20 ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold text-white ${
            selected ? 'bg-[#2563EB]' : 'bg-blue-400/90'
          }`}
        >
          {hidden && <EyeOff className="w-3 h-3" />}
          {TIPO_LABELS[secao.tipo] || secao.tipo}
        </div>
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center justify-center w-5 h-5 rounded cursor-grab active:cursor-grabbing text-white ${
            selected ? 'bg-[#2563EB]' : 'bg-blue-400/90'
          }`}
          title="Arrastar para reordenar"
        >
          <GripVertical className="w-3 h-3" />
        </button>
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

      {/* Conteudo renderizado — pointer-events-none pra que clicks
          passem direto pro wrapper externo (selecao do bloco) */}
      <div className="pointer-events-none">
        <PreviewRenderer
          secoes={[{ ...secao, visivel: true }]}
          corPrimaria={corPrimaria}
          idioma={idioma}
        />
      </div>
    </div>
  );
}
