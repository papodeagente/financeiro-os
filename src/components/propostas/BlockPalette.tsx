'use client';

import { useState } from 'react';
import {
  Plane, Hotel, Type, Calendar, Image as ImageIcon, CheckSquare, DollarSign,
  Quote, MousePointer, Video, Map as MapIcon, HelpCircle, Timer, Bed, Car,
  Sparkles, PanelLeftClose, PanelLeftOpen, Loader2, GripVertical,
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import type { ComponentType } from 'react';

type IconType = ComponentType<{ className?: string }>;

interface PaletteItem {
  tipo: string;
  icon: IconType;
  label: string;
  desc: string;
}

interface Category {
  label: string;
  items: PaletteItem[];
}

// Agrupamento dos tipos de bloco por finalidade. Ordem intencional:
// primeiro os blocos "ricos" (hospedagem/transporte/roteiro) que sao o
// coracao da proposta; conteudo geral logo abaixo; comercial e social
// no fim.
const CATEGORIES: Category[] = [
  {
    label: 'Hospedagem & Transporte',
    items: [
      { tipo: 'ALOJAMENTO', icon: Bed, label: 'Hospedagem', desc: 'Hotel com galeria, amenities, preço' },
      { tipo: 'VOO', icon: Plane, label: 'Voo', desc: 'Cia, segmentos, bagagem, CO₂' },
      { tipo: 'TRANSPORTE', icon: Car, label: 'Transporte', desc: 'Transfer, ônibus, trem, barco' },
    ],
  },
  {
    label: 'Roteiro',
    items: [
      { tipo: 'ROTEIRO_DIA', icon: Calendar, label: 'Roteiro Dia a Dia', desc: 'Atividades por dia da viagem' },
      { tipo: 'MAPA', icon: MapIcon, label: 'Mapa', desc: 'Pontos no mapa interativo' },
    ],
  },
  {
    label: 'Conteúdo',
    items: [
      { tipo: 'TEXTO', icon: Type, label: 'Texto', desc: 'Parágrafos formatados' },
      { tipo: 'GALERIA', icon: ImageIcon, label: 'Galeria', desc: 'Coleção de imagens' },
      { tipo: 'VIDEO', icon: Video, label: 'Vídeo', desc: 'YouTube / Vimeo' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { tipo: 'VALORES', icon: DollarSign, label: 'Valores', desc: 'Opções e parcelamento' },
      { tipo: 'INCLUSOS', icon: CheckSquare, label: 'Inclusos / Não inclusos', desc: 'Duas colunas' },
      { tipo: 'SERVICO', icon: Sparkles, label: 'Serviço', desc: 'Item com preço opcional' },
      { tipo: 'CTA', icon: MousePointer, label: 'CTA', desc: 'Botão de ação principal' },
    ],
  },
  {
    label: 'Social',
    items: [
      { tipo: 'DEPOIMENTO', icon: Quote, label: 'Depoimento', desc: 'Avaliações de clientes' },
      { tipo: 'FAQ', icon: HelpCircle, label: 'FAQ', desc: 'Perguntas frequentes' },
      { tipo: 'COUNTDOWN', icon: Timer, label: 'Countdown', desc: 'Contagem regressiva' },
    ],
  },
];

// Item draggable da paleta. Wrapping em useDraggable expoe data.source
// 'palette' + tipo do bloco — consumido em handleDragEnd do editor
// para inserir o tipo na posicao do drop. Click continua adicionando
// no fim da lista (fallback sem drag).
function DraggablePaletteItem({ item, onClick, expanded }: {
  item: PaletteItem;
  onClick: () => void;
  expanded: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.tipo}`,
    data: { source: 'palette', tipo: item.tipo },
  });
  const Icon = item.icon;

  if (!expanded) {
    return (
      <button
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={`w-9 h-9 flex items-center justify-center rounded-lg text-[var(--t-text-secondary)] hover:bg-[var(--t-green)]/10 hover:text-[var(--t-green)] transition-colors cursor-grab active:cursor-grabbing ${
          isDragging ? 'opacity-40' : ''
        }`}
        title={`${item.label} — arraste para o canvas ou clique para adicionar no fim`}
      >
        <Icon className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-[var(--t-surface-hover)] transition-colors group cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
      title={`${item.label} — arraste para o canvas ou clique para adicionar no fim`}
    >
      <div className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-[var(--t-bg)] border border-[var(--t-border)] group-hover:border-[var(--t-green)] group-hover:bg-[var(--t-green)]/10 transition-colors">
        <Icon className="w-3.5 h-3.5 text-[var(--t-text-secondary)] group-hover:text-[var(--t-green)] transition-colors" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-xs font-medium text-[var(--t-text)] truncate">{item.label}</div>
        <div className="text-[10px] text-[var(--t-text-muted)] truncate">{item.desc}</div>
      </div>
      <GripVertical className="w-3 h-3 text-[var(--t-text-muted)] opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
    </div>
  );
}

interface Props {
  onAddBlock: (tipo: string) => void;
  onSearchFlight: () => void;
  onSearchHotel: () => void;
  onGenerateFullAI: () => void;
  generatingFull: boolean;
}

export function BlockPalette({
  onAddBlock, onSearchFlight, onSearchHotel, onGenerateFullAI, generatingFull,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside
        className="w-12 shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto flex flex-col items-center py-2 gap-1"
        aria-label="Paleta de blocos colapsada"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Expandir paleta"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <div className="w-6 h-px bg-[var(--t-border)] my-1" />
        {CATEGORIES.flatMap(c => c.items).map(item => (
          <DraggablePaletteItem
            key={item.tipo}
            item={item}
            onClick={() => onAddBlock(item.tipo)}
            expanded={false}
          />
        ))}
      </aside>
    );
  }

  return (
    <aside
      className="w-64 shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto"
      aria-label="Paleta de blocos"
    >
      {/* Header da paleta */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-[var(--t-border)] sticky top-0 bg-[var(--t-surface)] z-10">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">
          Adicionar bloco
        </h3>
        <button
          onClick={() => setCollapsed(true)}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Colapsar paleta"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Atalhos especiais */}
      <div className="px-3 py-3 border-b border-[var(--t-border)] space-y-1.5">
        <button
          onClick={onSearchHotel}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-[var(--t-text)] bg-[var(--t-bg)] border border-[var(--t-border)] hover:border-[var(--t-green)] hover:bg-[var(--t-green)]/5 transition-colors"
          title="Abrir busca de hotel na API"
        >
          <Hotel className="w-3.5 h-3.5 text-[var(--t-green)]" />
          Buscar hotel (API)
        </button>
        <button
          onClick={onSearchFlight}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-[var(--t-text)] bg-[var(--t-bg)] border border-[var(--t-border)] hover:border-[var(--t-green)] hover:bg-[var(--t-green)]/5 transition-colors"
          title="Abrir busca de voo na API"
        >
          <Plane className="w-3.5 h-3.5 text-[var(--t-green)]" />
          Buscar voo (API)
        </button>
        <button
          onClick={onGenerateFullAI}
          disabled={generatingFull}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-purple-400 bg-purple-400/5 border border-purple-400/30 hover:bg-purple-400/10 transition-colors disabled:opacity-50"
          title="Gerar proposta completa com IA"
        >
          {generatingFull ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generatingFull ? 'Gerando...' : 'Gerar com IA'}
        </button>
      </div>

      {/* Categorias */}
      <div className="py-1">
        {CATEGORIES.map(cat => (
          <div key={cat.label} className="px-2 py-1.5">
            <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] px-2 mb-1">
              {cat.label}
            </h4>
            <div className="space-y-0.5">
              {cat.items.map(item => (
                <DraggablePaletteItem
                  key={item.tipo}
                  item={item}
                  onClick={() => onAddBlock(item.tipo)}
                  expanded={true}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
