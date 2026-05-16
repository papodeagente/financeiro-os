'use client';

import { useState } from 'react';
import {
  Plane, Hotel, Type, Calendar, Image as ImageIcon, CheckSquare, DollarSign,
  Quote, MousePointer, Video, Map as MapIcon, HelpCircle, Timer, Bed, Car,
  Sparkles, PanelLeftClose, PanelLeftOpen, Loader2,
  EyeOff, Layers, ListTree, ChevronRight, Rows3, Columns2, Columns3, Columns4,
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

// Categorias preservadas — 5 grupos, 15 tipos. Ordem por relevancia
// (hospedagem/transporte primeiro, comercial proximo).
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
      { tipo: 'ROTEIRO_DIA', icon: Calendar, label: 'Roteiro', desc: 'Atividades por dia da viagem' },
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

// Item compacto da paleta — 2-col grid, aspect 5:4 (mais largo que
// alto, ~22% mais baixo que aspect-square anterior). Sem hover-bg
// pesado, so border verde — design discreto.
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
      className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-md border bg-[var(--t-bg)] cursor-grab active:cursor-grabbing transition-colors hover:border-[var(--t-green)] ${
        isDragging ? 'opacity-40 border-[var(--t-green)]' : 'border-[var(--t-border)]'
      }`}
      title={`${item.label} — ${item.desc}`}
    >
      <Icon className="w-4 h-4 text-[var(--t-text-secondary)]" />
      <span className="text-[10px] font-medium text-[var(--t-text)] leading-none text-center">
        {item.label}
      </span>
    </div>
  );
}

interface Props {
  onAddBlock: (tipo: string) => void;
  onAddRow: (numCols: 1 | 2 | 3 | 4) => void;
  onSearchFlight: () => void;
  onSearchHotel: () => void;
  onGenerateFullAI: () => void;
  generatingFull: boolean;
  secoes: SecaoProposta[];
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}

export function BlockPalette({
  onAddBlock, onAddRow, onSearchFlight, onSearchHotel, onGenerateFullAI, generatingFull,
  secoes, selectedBlockId, onSelectBlock,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'blocos' | 'estrutura'>('blocos');
  // Categorias colapsaveis. Default todas abertas (Set vazio = nenhuma
  // colapsada).
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const toggleCat = (label: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  // ========== Modo colapsado: 48px so com icones ==========
  if (collapsed) {
    return (
      <aside
        className="w-12 shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto flex flex-col items-center py-2 gap-1"
        aria-label="Paleta de blocos colapsada"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="w-9 h-9 flex items-center justify-center rounded-md text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Expandir paleta"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <div className="w-6 h-px bg-[var(--t-border)] my-0.5" />
        {CATEGORIES.flatMap(c => c.items).map(item => (
          <CollapsedItem key={item.tipo} item={item} onClick={() => onAddBlock(item.tipo)} />
        ))}
      </aside>
    );
  }

  // ========== Modo expandido: 220px minimal ==========
  return (
    <aside
      className="w-[220px] shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Paleta de blocos"
    >
      {/* Tabs minimal — sem icones, so texto. Botao colapsar a direita. */}
      <div className="shrink-0 flex items-center border-b border-[var(--t-border)]">
        <button
          onClick={() => setTab('blocos')}
          className={`flex-1 h-9 text-[10px] uppercase tracking-wider font-semibold transition-all ${
            tab === 'blocos'
              ? 'text-[var(--t-text)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] border-b-2 border-transparent hover:text-[var(--t-text-secondary)]'
          }`}
        >
          Blocos
        </button>
        <button
          onClick={() => setTab('estrutura')}
          className={`flex-1 h-9 text-[10px] uppercase tracking-wider font-semibold transition-all ${
            tab === 'estrutura'
              ? 'text-[var(--t-text)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] border-b-2 border-transparent hover:text-[var(--t-text-secondary)]'
          }`}
        >
          Estrutura{secoes.length > 0 && <span className="ml-0.5 normal-case font-normal text-[9px] text-[var(--t-text-muted)]">({secoes.length})</span>}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="w-8 h-9 flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] border-l border-[var(--t-border)]"
          title="Colapsar paleta"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Atalhos especiais — compacto, 3 botoes em linha icon + texto.
          Antes ocupava 3 linhas grandes; agora linhas baixas (py-1). */}
      <div className="shrink-0 px-2 py-2 border-b border-[var(--t-border)] space-y-1">
        <button
          onClick={onSearchHotel}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium text-[var(--t-text-secondary)] hover:bg-[var(--t-green)]/5 hover:text-[var(--t-text)] transition-colors"
          title="Buscar hotel na API"
        >
          <Hotel className="w-3.5 h-3.5 text-[var(--t-green)]" /> Hotel API
        </button>
        <button
          onClick={onSearchFlight}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium text-[var(--t-text-secondary)] hover:bg-[var(--t-green)]/5 hover:text-[var(--t-text)] transition-colors"
          title="Buscar voo na API"
        >
          <Plane className="w-3.5 h-3.5 text-[var(--t-green)]" /> Voo API
        </button>
        <button
          onClick={onGenerateFullAI}
          disabled={generatingFull}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium text-purple-500 hover:bg-purple-500/5 transition-colors disabled:opacity-50"
          title="Gerar proposta completa com IA"
        >
          {generatingFull ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generatingFull ? 'Gerando...' : 'Gerar com IA'}
        </button>
      </div>

      {/* Conteudo da tab */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'blocos' ? (
          // ========== Tab Blocos — categorias colapsaveis ==========
          <div className="py-1">
            {/* Estrutura (Elementor-like) — cria linhas vazias com N
                colunas. Cada coluna vira um PLACEHOLDER selecionavel que
                o usuario transforma no tipo desejado clicando. */}
            <div className="px-2 mb-1">
              <div className="px-1 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] flex items-center gap-1">
                <Rows3 className="w-3 h-3" /> Estrutura
              </div>
              <div className="grid grid-cols-4 gap-1 px-1 pb-1.5">
                <button
                  onClick={() => onAddRow(1)}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] transition-colors"
                  title="Linha com 1 coluna (full width)"
                  aria-label="Linha 1 coluna"
                >
                  <Type className="w-3.5 h-3.5 text-[var(--t-text-secondary)]" />
                  <span className="text-[9px] font-mono text-[var(--t-text-muted)]">1</span>
                </button>
                <button
                  onClick={() => onAddRow(2)}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] transition-colors"
                  title="Linha com 2 colunas (50% cada)"
                  aria-label="Linha 2 colunas"
                >
                  <Columns2 className="w-3.5 h-3.5 text-[var(--t-text-secondary)]" />
                  <span className="text-[9px] font-mono text-[var(--t-text-muted)]">2</span>
                </button>
                <button
                  onClick={() => onAddRow(3)}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] transition-colors"
                  title="Linha com 3 colunas (33% cada)"
                  aria-label="Linha 3 colunas"
                >
                  <Columns3 className="w-3.5 h-3.5 text-[var(--t-text-secondary)]" />
                  <span className="text-[9px] font-mono text-[var(--t-text-muted)]">3</span>
                </button>
                <button
                  onClick={() => onAddRow(4)}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] transition-colors"
                  title="Linha com 4 colunas (25% cada)"
                  aria-label="Linha 4 colunas"
                >
                  <Columns4 className="w-3.5 h-3.5 text-[var(--t-text-secondary)]" />
                  <span className="text-[9px] font-mono text-[var(--t-text-muted)]">4</span>
                </button>
              </div>
            </div>
            <div className="border-t border-[var(--t-border)] mx-2 mb-1" />

            {CATEGORIES.map(cat => {
              const isCatCollapsed = collapsedCats.has(cat.label);
              return (
                <div key={cat.label} className="px-2">
                  <button
                    onClick={() => toggleCat(cat.label)}
                    className="w-full flex items-center gap-1 px-1 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] hover:text-[var(--t-text-secondary)] transition-colors"
                    aria-expanded={!isCatCollapsed}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${isCatCollapsed ? '' : 'rotate-90'}`} />
                    {cat.label}
                  </button>
                  {!isCatCollapsed && (
                    <div className="grid grid-cols-2 gap-1 px-1 pb-1.5">
                      {cat.items.map(item => (
                        <DraggablePaletteCard
                          key={item.tipo}
                          item={item}
                          onClick={() => onAddBlock(item.tipo)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // ========== Tab Estrutura — outline compacto ==========
          <div className="py-1">
            {secoes.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <Layers className="w-5 h-5 text-[var(--t-text-muted)] mx-auto mb-1.5" />
                <p className="text-[11px] text-[var(--t-text-muted)]">Nenhum bloco</p>
                <p className="text-[9px] text-[var(--t-text-muted)] mt-0.5">Adicione pela aba Blocos</p>
              </div>
            ) : (
              <div className="px-1 py-0.5">
                {secoes.map((s, i) => {
                  const Icon = TIPO_ICONS[s.tipo] || Type;
                  const isSelected = selectedBlockId === s.id;
                  const isHidden = s.visivel === false;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelectBlock(s.id)}
                      className={`w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--t-green)]/10 text-[var(--t-text)]'
                          : 'hover:bg-[var(--t-surface-hover)] text-[var(--t-text)]'
                      }`}
                      title={TIPO_LABELS[s.tipo] || s.tipo}
                    >
                      <span className="text-[9px] font-mono text-[var(--t-text-muted)] w-3 text-right shrink-0">
                        {i + 1}
                      </span>
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[var(--t-green)]' : 'text-[var(--t-text-muted)]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${
                            isHidden ? 'text-[var(--t-text-muted)] line-through' : ''
                          }`}>
                            {TIPO_LABELS[s.tipo] || s.tipo}
                          </span>
                          {isHidden && <EyeOff className="w-2.5 h-2.5 text-[var(--t-text-muted)] shrink-0" />}
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
      className={`w-9 h-9 flex items-center justify-center rounded-md text-[var(--t-text-secondary)] hover:bg-[var(--t-green)]/10 hover:text-[var(--t-green)] transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
      title={`${item.label} — arraste para o canvas ou clique para adicionar`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
