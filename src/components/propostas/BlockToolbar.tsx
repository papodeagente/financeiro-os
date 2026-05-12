'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Plus, Type, Plane, Calendar, Image, CheckSquare,
  DollarSign, Quote, MousePointer, Hotel, Sparkles, Loader2,
  Video, Map, HelpCircle, Timer, Bed, Car,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const SECAO_TIPOS = [
  { tipo: 'TEXTO', label: 'Texto', icon: Type, desc: 'Bloco de texto livre' },
  // 'Voos' substitui o antigo tile 'Servico' (que era genérico para voo, hotel, transfer).
  // Hotel agora é 'Alojamento' (já existe), transfer é 'Transporte' (sem voo).
  { tipo: 'VOO', label: 'Voos', icon: Plane, desc: 'Voo com detalhes do Google' },
  { tipo: 'ROTEIRO_DIA', label: 'Roteiro', icon: Calendar, desc: 'Dia a dia da viagem' },
  { tipo: 'GALERIA', label: 'Galeria', icon: Image, desc: 'Grid de fotos' },
  { tipo: 'INCLUSOS', label: 'Inclusos', icon: CheckSquare, desc: 'O que esta/nao esta incluso' },
  { tipo: 'VALORES', label: 'Valores', icon: DollarSign, desc: 'Tabela de precos' },
  { tipo: 'DEPOIMENTO', label: 'Depoimento', icon: Quote, desc: 'Prova social' },
  { tipo: 'CTA', label: 'CTA', icon: MousePointer, desc: 'Botao de acao' },
  { tipo: 'VIDEO', label: 'Video', icon: Video, desc: 'YouTube ou Vimeo' },
  { tipo: 'MAPA', label: 'Mapa', icon: Map, desc: 'Pontos no mapa' },
  { tipo: 'FAQ', label: 'FAQ', icon: HelpCircle, desc: 'Perguntas frequentes' },
  { tipo: 'COUNTDOWN', label: 'Countdown', icon: Timer, desc: 'Contagem regressiva' },
  { tipo: 'ALOJAMENTO', label: 'Hospedagem', icon: Bed, desc: 'Hotel estruturado' },
  { tipo: 'TRANSPORTE', label: 'Transporte', icon: Car, desc: 'Transfer, carro, trem...' },
] as const;

interface Props {
  onAddBlock: (tipo: string) => void;
  onSearchFlight: () => void;
  onSearchHotel: () => void;
  onGenerateFullAI?: () => void;
  generatingFull?: boolean;
}

export function BlockToolbar({ onAddBlock, onSearchFlight, onSearchHotel, onGenerateFullAI, generatingFull }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-4 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-secondary)] hover:text-[var(--t-green)] hover:border-[var(--t-green)] transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> Adicionar bloco
      </button>
    );
  }

  return (
    <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] border-dashed">
      <CardContent className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SECAO_TIPOS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.tipo}
                onClick={() => { onAddBlock(t.tipo); setOpen(false); }}
                className="flex items-center gap-2 p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] hover:border-[var(--t-green)] hover:bg-[var(--t-green)]/5 transition-all text-left"
              >
                <Icon className="w-4 h-4 text-[var(--t-green)]" />
                <div>
                  <div className="text-xs font-medium text-[var(--t-text)]">{t.label}</div>
                  <div className="text-[10px] text-[var(--t-text-muted)]">{t.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--t-border)]">
          <button
            onClick={() => { onSearchFlight(); setOpen(false); }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--t-blue-bg)] border border-blue-500/20 hover:border-blue-400 text-blue-400 text-xs font-medium transition-all"
          >
            <Plane className="w-4 h-4" /> Buscar Voo (API)
          </button>
          <button
            onClick={() => { onSearchHotel(); setOpen(false); }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-400 text-emerald-400 text-xs font-medium transition-all"
          >
            <Hotel className="w-4 h-4" /> Buscar Hotel (API)
          </button>
          {onGenerateFullAI && (
            <button
              onClick={() => { onGenerateFullAI(); setOpen(false); }}
              disabled={generatingFull}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:border-purple-400 text-purple-400 text-xs font-medium transition-all disabled:opacity-50"
            >
              {generatingFull ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generatingFull ? 'Gerando...' : 'Gerar Roteiro Completo (IA)'}
            </button>
          )}
        </div>
        <Button variant="ghost" size="sm" className="mt-2 text-xs text-[var(--t-text-secondary)]"
          onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </CardContent>
    </Card>
  );
}
