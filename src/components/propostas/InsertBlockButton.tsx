'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Plus, Plane, Hotel, Type, Calendar, Image as ImageIcon, CheckSquare,
  DollarSign, Quote, MousePointer, Video, Map as MapIcon, HelpCircle, Timer,
  Bed, Car, Sparkles,
} from 'lucide-react';
import type { ComponentType } from 'react';

type IconType = ComponentType<{ className?: string }>;

interface QuickItem {
  tipo: string;
  icon: IconType;
  label: string;
}

const QUICK_CATEGORIES: Array<{ label: string; items: QuickItem[] }> = [
  {
    label: 'Hospedagem & Transporte',
    items: [
      { tipo: 'ALOJAMENTO', icon: Bed, label: 'Hospedagem' },
      { tipo: 'VOO', icon: Plane, label: 'Voo' },
      { tipo: 'TRANSPORTE', icon: Car, label: 'Transporte' },
    ],
  },
  {
    label: 'Roteiro',
    items: [
      { tipo: 'ROTEIRO_DIA', icon: Calendar, label: 'Roteiro Dia a Dia' },
      { tipo: 'MAPA', icon: MapIcon, label: 'Mapa' },
    ],
  },
  {
    label: 'Conteúdo',
    items: [
      { tipo: 'TEXTO', icon: Type, label: 'Texto' },
      { tipo: 'GALERIA', icon: ImageIcon, label: 'Galeria' },
      { tipo: 'VIDEO', icon: Video, label: 'Vídeo' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { tipo: 'VALORES', icon: DollarSign, label: 'Valores' },
      { tipo: 'INCLUSOS', icon: CheckSquare, label: 'Inclusos' },
      { tipo: 'SERVICO', icon: Sparkles, label: 'Serviço' },
      { tipo: 'CTA', icon: MousePointer, label: 'Botão CTA' },
    ],
  },
  {
    label: 'Social',
    items: [
      { tipo: 'DEPOIMENTO', icon: Quote, label: 'Depoimento' },
      { tipo: 'FAQ', icon: HelpCircle, label: 'FAQ' },
      { tipo: 'COUNTDOWN', icon: Timer, label: 'Countdown' },
    ],
  },
];

interface Props {
  // Funcao que insere o bloco do tipo escolhido na posicao definida.
  onInsert: (tipo: string) => void;
  // Quando true, expande o popover automaticamente — usado pra empty state.
  defaultOpen?: boolean;
  // Atalhos especiais opcionais (Buscar Hotel API, etc.) — sao botoes
  // separados que ficam no topo do popover.
  onSearchHotel?: () => void;
  onSearchFlight?: () => void;
}

// Botao "+" inline entre blocos. Padrao: pequeno botao que aparece
// no hover do gap entre blocos. Click expande um popover com a
// biblioteca de blocos organizada por categoria — facilita add sem
// precisar arrastar da paleta lateral.
//
// Quando o popover esta aberto, click fora fecha. Esc tambem fecha.
export function InsertBlockButton({
  onInsert, defaultOpen = false, onSearchHotel, onSearchFlight,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const handlePick = (tipo: string) => {
    onInsert(tipo);
    setOpen(false);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative flex items-center justify-center group/insert"
      // Container ocupa altura minima — botao aparece centralizado no
      // gap entre blocos.
      style={{ minHeight: '20px' }}
    >
      {/* Linha guia central, visivel no hover do gap */}
      <div
        className={`absolute left-0 right-0 h-px transition-opacity ${
          open ? 'opacity-100 bg-[#2563EB]' : 'opacity-0 group-hover/insert:opacity-100 bg-blue-300'
        }`}
        style={{ pointerEvents: 'none' }}
      />

      {/* Botao "+" — sempre presente em modo edicao, opacidade controlada */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className={`relative z-10 w-6 h-6 flex items-center justify-center rounded-full transition-all shadow-sm ${
          open
            ? 'bg-[#2563EB] text-white scale-110'
            : 'bg-white border border-blue-300 text-[#2563EB] opacity-0 group-hover/insert:opacity-100 hover:scale-110'
        }`}
        title="Adicionar bloco aqui"
        aria-label="Adicionar bloco"
        aria-expanded={open}
      >
        <Plus className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>

      {/* Popover com a biblioteca rapida */}
      {open && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-30 w-80 rounded-xl bg-white border border-gray-200 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          onClick={e => e.stopPropagation()}
        >
          {/* Atalhos especiais no topo */}
          {(onSearchHotel || onSearchFlight) && (
            <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-1.5">
              {onSearchHotel && (
                <button
                  onClick={() => { onSearchHotel(); setOpen(false); }}
                  className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-700 bg-white border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
                  title="Buscar hotel na API"
                >
                  <Hotel className="w-3 h-3 text-emerald-600" />
                  Hotel API
                </button>
              )}
              {onSearchFlight && (
                <button
                  onClick={() => { onSearchFlight(); setOpen(false); }}
                  className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-700 bg-white border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
                  title="Buscar voo na API"
                >
                  <Plane className="w-3 h-3 text-emerald-600" />
                  Voo API
                </button>
              )}
            </div>
          )}

          {/* Categorias */}
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {QUICK_CATEGORIES.map(cat => (
              <div key={cat.label} className="px-2 py-1.5">
                <h4 className="text-[9px] uppercase tracking-wider font-semibold text-gray-400 px-1.5 mb-1">
                  {cat.label}
                </h4>
                <div className="grid grid-cols-2 gap-1">
                  {cat.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.tipo}
                        onClick={() => handlePick(item.tipo)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-blue-50 transition-colors group/item text-left"
                      >
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded bg-gray-100 group-hover/item:bg-blue-100 transition-colors">
                          <Icon className="w-3.5 h-3.5 text-gray-600 group-hover/item:text-blue-600" />
                        </div>
                        <span className="text-[11px] font-medium text-gray-700 group-hover/item:text-blue-700 truncate">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
