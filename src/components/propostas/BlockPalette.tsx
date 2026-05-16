'use client';

import { useState } from 'react';
import {
  Plane, Hotel, Type, Calendar, Image as ImageIcon, CheckSquare, DollarSign,
  Quote, MousePointer, Video, Map as MapIcon, HelpCircle, Timer, Bed, Car,
  Sparkles, PanelLeftClose, PanelLeftOpen, Loader2, GripVertical,
  LayoutGrid, ListTree, EyeOff,
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import type { ComponentType } from 'react';
import type { SecaoProposta } from '@/lib/crm-types';
import { BlockHeaderSummary } from './BlockHeaderSummary';

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

// Mesma estrutura que o BlockPalette anterior — agrupamento intencional
// por finalidade: primeiro os blocos "ricos" (hospedagem/transporte/
// roteiro), depois conteudo geral, comercial e social.
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
      { tipo: 'ROTEIRO_DIA', icon: Calendar, label: 'Roteiro', desc: 'Atividades por dia' },
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
      { tipo: 'INCLUSOS', icon: CheckSquare, label: 'Inclusos', desc: 'Lista de inclusos e não inclusos' },
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

const TIPO_ICONS: Record<string, IconType> = CATEGORIES.flatMap(c => c.items)
  .reduce((acc, it) => ({ ...acc, [it.tipo]: it.icon }), {} as Record<string, IconType>);
const TIPO_LABELS: Record<string, string> = CATEGORIES.flatMap(c => c.items)
  .reduce((acc, it) => ({ ...acc, [it.tipo]: it.label }), {} as Record<string, string>);

// Item Elementor-style: 2-col grid, card quadrado com icone centralizado
// no topo e label abaixo. Descricao vira tooltip on hover (title attr).
// Draggable via useDraggable (data.source = 'palette') e clickable como
// fallback (adiciona no fim da lista).
function DraggablePaletteCard({ item, onClick }: { item: PaletteItem; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.tipo}`,
    data: { source: 'palette', tipo: item.tipo },
  });
  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`flex flex-col items-center justify-center gap-1.5 aspect-square p-2 rounded-lg border bg-[var(--t-bg)] cursor-grab active:cursor-grabbing transition-all hover:border-[var(--t-green)] hover:bg-[var(--t-green)]/5 hover:shadow-sm ${
        isDragging ? 'opacity-40 border-[var(--t-green)]' : 'border-[var(--t-border)]'
      }`}
      title={`${item.label} — ${item.desc}. Arraste pro canvas ou clique pra adicionar no fim.`}
    >
      <Icon className="w-6 h-6 text-[var(--t-text-secondary)] group-hover:text-[var(--t-green)]" />
      <span className="text-[11px] font-medium text-[var(--t-text)] leading-tight text-center">
        {item.label}
      </span>
    </div>
  );
}

interface Props {
  onAddBlock: (tipo: string) => void;
  onSearchFlight: () => void;
  onSearchHotel: () => void;
  onGenerateFullAI: () => void;
  generatingFull: boolean;
  // Tab Estrutura (outline) — listagem dos blocos atuais.
  secoes: SecaoProposta[];
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}

export function BlockPalette({
  onAddBlock, onSearchFlight, onSearchHotel, onGenerateFullAI, generatingFull,
  secoes, selectedBlockId, onSelectBlock,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'blocos' | 'estrutura'>('blocos');

  // Modo colapsado: so icones verticais — preserva comportamento anterior.
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
          <CollapsedItem key={item.tipo} item={item} onClick={() => onAddBlock(item.tipo)} />
        ))}
      </aside>
    );
  }

  return (
    <aside
      className="w-72 shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Paleta de blocos"
    >
      {/* Tabs no topo */}
      <div className="shrink-0 flex items-center border-b border-[var(--t-border)] bg-[var(--t-surface)]">
        <button
          onClick={() => setTab('blocos')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] uppercase tracking-wider font-semibold transition-all ${
            tab === 'blocos'
              ? 'text-[var(--t-text)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] border-b-2 border-transparent hover:text-[var(--t-text-secondary)]'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Blocos
        </button>
        <button
          onClick={() => setTab('estrutura')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] uppercase tracking-wider font-semibold transition-all ${
            tab === 'estrutura'
              ? 'text-[var(--t-text)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] border-b-2 border-transparent hover:text-[var(--t-text-secondary)]'
          }`}
        >
          <ListTree className="w-3.5 h-3.5" /> Estrutura
          {secoes.length > 0 && (
            <span className="text-[9px] font-normal text-[var(--t-text-muted)]">({secoes.length})</span>
          )}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="w-9 h-9 flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] border-l border-[var(--t-border)]"
          title="Colapsar paleta"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Atalhos especiais — sempre visiveis, independente da tab */}
      <div className="shrink-0 px-3 py-2.5 border-b border-[var(--t-border)] space-y-1.5">
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

      {/* Conteudo da tab */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'blocos' ? (
          // ========== Tab: Blocos ==========
          <div className="py-2">
            {CATEGORIES.map(cat => (
              <div key={cat.label} className="px-3 py-1.5">
                <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] mb-2">
                  {cat.label}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {cat.items.map(item => (
                    <DraggablePaletteCard
                      key={item.tipo}
                      item={item}
                      onClick={() => onAddBlock(item.tipo)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // ========== Tab: Estrutura ==========
          <div className="py-1">
            {secoes.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <ListTree className="w-6 h-6 text-[var(--t-text-muted)] mx-auto mb-2" />
                <p className="text-xs text-[var(--t-text-muted)]">Nenhum bloco ainda</p>
                <p className="text-[10px] text-[var(--t-text-muted)] mt-1">Adicione pela aba Blocos</p>
              </div>
            ) : (
              <div className="px-1.5 py-1">
                {secoes.map((s, i) => {
                  const Icon = TIPO_ICONS[s.tipo] || Type;
                  const isSelected = selectedBlockId === s.id;
                  const isHidden = s.visivel === false;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelectBlock(s.id)}
                      className={`w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors mb-0.5 ${
                        isSelected
                          ? 'bg-[var(--t-green)]/10 ring-1 ring-[var(--t-green)]/40'
                          : 'hover:bg-[var(--t-surface-hover)]'
                      }`}
                      title={`Ir para ${TIPO_LABELS[s.tipo] || s.tipo}`}
                    >
                      <span className="text-[9px] font-mono text-[var(--t-text-muted)] mt-1 w-4 text-right shrink-0">
                        {i + 1}
                      </span>
                      <div className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center ${
                        isSelected ? 'bg-[var(--t-green)]/20' : 'bg-[var(--t-bg)] border border-[var(--t-border)]'
                      }`}>
                        <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--t-green)]' : 'text-[var(--t-text-secondary)]'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${
                            isHidden ? 'text-[var(--t-text-muted)] line-through' : 'text-[var(--t-text)]'
                          }`}>
                            {TIPO_LABELS[s.tipo] || s.tipo}
                          </span>
                          {isHidden && <EyeOff className="w-3 h-3 text-[var(--t-text-muted)] shrink-0" />}
                        </div>
                        <div className={`min-w-0 ${isHidden ? 'opacity-50' : ''}`}>
                          <BlockHeaderSummary tipo={s.tipo} conteudo={s.conteudo} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// Item da paleta colapsada (so icone). Draggable + clickable.
function CollapsedItem({ item, onClick }: { item: PaletteItem; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.tipo}`,
    data: { source: 'palette', tipo: item.tipo },
  });
  const Icon = item.icon;
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
