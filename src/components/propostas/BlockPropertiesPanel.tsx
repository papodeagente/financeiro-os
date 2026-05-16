'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, CopyPlus, Trash2, Sparkles, Loader2, ChevronLeft, ChevronRight, ChevronLeft as BackIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  Plane, Type, Calendar, Image as ImageIcon, CheckSquare,
  DollarSign, Quote, MousePointer, Video, Map as MapIcon, HelpCircle, Timer,
  Bed, Car,
} from 'lucide-react';
import type { SecaoProposta } from '@/lib/crm-types';
import { BlockRenderer } from './BlockRenderer';
import { Button } from '@/components/ui/button';

const TIPO_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  TEXTO: Type, SERVICO: Plane, VOO: Plane, ROTEIRO_DIA: Calendar, GALERIA: ImageIcon,
  INCLUSOS: CheckSquare, VALORES: DollarSign, DEPOIMENTO: Quote, CTA: MousePointer,
  VIDEO: Video, MAPA: MapIcon, FAQ: HelpCircle, COUNTDOWN: Timer,
  ALOJAMENTO: Bed, TRANSPORTE: Car,
};

const TIPO_LABELS: Record<string, string> = {
  TEXTO: 'Texto', SERVICO: 'Serviço', VOO: 'Voo', ROTEIRO_DIA: 'Roteiro',
  GALERIA: 'Galeria', INCLUSOS: 'Inclusos', VALORES: 'Valores',
  DEPOIMENTO: 'Depoimento', CTA: 'CTA', VIDEO: 'Vídeo', MAPA: 'Mapa',
  FAQ: 'FAQ', COUNTDOWN: 'Countdown', ALOJAMENTO: 'Hospedagem',
  TRANSPORTE: 'Transporte',
};

const AI_SUPPORTED_TYPES = ['TEXTO', 'SERVICO', 'ROTEIRO_DIA', 'INCLUSOS', 'DEPOIMENTO', 'CTA'];
// Hotel/voo ja tem seu proprio CTA "Buscar API" dentro do bloco — nao
// duplicamos botao IA pra eles. Mas os demais ricos (VALORES, GALERIA)
// tambem nao tem IA — mantemos a lista historica.

interface Props {
  secao: SecaoProposta;
  onChange: (conteudo: Record<string, unknown>) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onToggleVisivel: () => void;
  onRemove: () => void;
  onGenerateAI: () => void;
  generating: boolean;
  onInsertAfter?: (tipo: string, conteudo: Record<string, unknown>) => void;
  // Navegacao prev/next entre blocos. Quando definidas, mostram setas
  // no header pra trocar de bloco sem fechar+reabrir.
  onPrev?: () => void;
  onNext?: () => void;
  position?: { current: number; total: number };
  // Quando definido, breadcrumb leva direto pra config da pagina ao
  // inves de apenas fechar.
  onGoToPageSettings?: () => void;
}

// Painel direito do editor — vira o "Properties Panel" estilo Elementor
// quando ha um bloco selecionado no canvas. Reaproveita o BlockRenderer
// existente (mesmo dispatcher dos forms de edicao por tipo) — nenhum
// componente de bloco precisa ser reescrito.
export function BlockPropertiesPanel({
  secao, onChange, onClose, onDuplicate, onToggleVisivel, onRemove,
  onGenerateAI, generating, onInsertAfter, onPrev, onNext, position,
  onGoToPageSettings,
}: Props) {
  const TipoIcon = TIPO_ICONS[secao.tipo] || Type;
  const hidden = secao.visivel === false;
  const canAI = AI_SUPPORTED_TYPES.includes(secao.tipo);

  // Estado de confirmacao do delete (2-stage). Primeiro click = pendente,
  // segundo click = deleta. Reset automatico em 3s ou ao clicar fora.
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!deleteConfirming) return;
    deleteTimerRef.current = setTimeout(() => setDeleteConfirming(false), 3000);
    return () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); };
  }, [deleteConfirming]);

  const handleDeleteClick = () => {
    if (deleteConfirming) {
      onRemove();
      setDeleteConfirming(false);
    } else {
      setDeleteConfirming(true);
    }
  };

  return (
    <aside
      className="w-[320px] xl:w-[360px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Propriedades do bloco selecionado"
    >
      {/* Breadcrumb — abre config da pagina (substitui o editor de bloco) */}
      <button
        onClick={onGoToPageSettings || onClose}
        className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] border-b border-[var(--t-border)] transition-colors group"
        title="Ir para configuração da página"
      >
        <BackIcon className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        <span>Configuração da página</span>
      </button>

      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[var(--t-green)]/10">
            <TipoIcon className="w-4 h-4 text-[var(--t-green)]" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] flex items-center gap-1">
              <span>Editando</span>
              {position && (
                <span className="text-[9px] font-mono text-[var(--t-text-muted)]/70">
                  {position.current}/{position.total}
                </span>
              )}
            </div>
            <div className="text-sm font-medium text-[var(--t-text)] truncate">{TIPO_LABELS[secao.tipo] || secao.tipo}</div>
          </div>
        </div>

        {/* Prev/Next entre blocos */}
        {(onPrev || onNext) && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onPrev}
              disabled={!onPrev}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-30 disabled:hover:bg-transparent"
              title="Bloco anterior (Ctrl+↑)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onNext}
              disabled={!onNext}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-30 disabled:hover:bg-transparent"
              title="Próximo bloco (Ctrl+↓)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] shrink-0"
          title="Fechar (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick actions bar */}
      <div className="shrink-0 px-2 py-1.5 border-b border-[var(--t-border)] flex items-center gap-1 bg-[var(--t-bg)]">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-[var(--t-text-secondary)]"
          onClick={onToggleVisivel}
          title={hidden ? 'Tornar visível' : 'Ocultar da proposta'}
        >
          {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-[var(--t-text-secondary)]"
          onClick={onDuplicate}
          title="Duplicar bloco"
        >
          <CopyPlus className="w-4 h-4" />
        </Button>
        {canAI && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-purple-400 hover:bg-purple-400/10 gap-1 text-[10px]"
            onClick={onGenerateAI}
            disabled={generating}
            title="Gerar conteúdo com IA"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Gerando...' : 'IA'}
          </Button>
        )}
        {/* Delete em 2 estagios: primeiro click pede confirmacao;
            segundo click (em <3s) deleta. Texto + cor mudam pra
            sinalizar o estado pendente. */}
        <button
          onClick={handleDeleteClick}
          className={`ml-auto h-8 inline-flex items-center gap-1 rounded-md text-[11px] font-medium transition-all ${
            deleteConfirming
              ? 'px-3 bg-red-500 text-white hover:bg-red-600 animate-in slide-in-from-right-1 duration-150'
              : 'w-8 justify-center text-red-400 hover:bg-red-500/10'
          }`}
          title={deleteConfirming ? 'Clique de novo para confirmar (Esc cancela)' : 'Deletar bloco'}
        >
          <Trash2 className="w-4 h-4" />
          {deleteConfirming && <span>Confirmar?</span>}
        </button>
      </div>

      {/* Content editor — scrollavel */}
      <div className="flex-1 overflow-y-auto p-4">
        <BlockRenderer
          tipo={secao.tipo}
          conteudo={secao.conteudo}
          onChange={onChange}
          onInsertAfter={onInsertAfter}
        />
      </div>
    </aside>
  );
}
