'use client';

import { X, Eye, EyeOff, CopyPlus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  Plane, Hotel as HotelIcon, Type, Calendar, Image as ImageIcon, CheckSquare,
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
}

// Painel direito do editor — vira o "Properties Panel" estilo Elementor
// quando ha um bloco selecionado no canvas. Reaproveita o BlockRenderer
// existente (mesmo dispatcher dos forms de edicao por tipo) — nenhum
// componente de bloco precisa ser reescrito.
export function BlockPropertiesPanel({
  secao, onChange, onClose, onDuplicate, onToggleVisivel, onRemove,
  onGenerateAI, generating, onInsertAfter,
}: Props) {
  const TipoIcon = TIPO_ICONS[secao.tipo] || Type;
  const hidden = secao.visivel === false;
  const canAI = AI_SUPPORTED_TYPES.includes(secao.tipo);

  return (
    <aside
      className="w-[360px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Propriedades do bloco selecionado"
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[var(--t-green)]/10">
            <TipoIcon className="w-4 h-4 text-[var(--t-green)]" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">Editando</div>
            <div className="text-sm font-medium text-[var(--t-text)] truncate">{TIPO_LABELS[secao.tipo] || secao.tipo}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
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
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-red-400 ml-auto"
          onClick={onRemove}
          title="Deletar bloco"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
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
