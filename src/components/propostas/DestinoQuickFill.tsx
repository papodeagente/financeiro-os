'use client';

import { Destino } from '@/lib/crm-types';
import {
  MapPin, Thermometer, Globe, Clock, Utensils, Lightbulb,
  CalendarHeart, Plus, Type, Image, Sparkles, X,
} from 'lucide-react';

interface Props {
  destino: Destino;
  onAddTextoBlock: (conteudo: Record<string, unknown>) => void;
  onAddGaleriaBlock: (conteudo: Record<string, unknown>) => void;
  onUseAsAIContext: (destino: Destino) => void;
  onClose: () => void;
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className="w-3.5 h-3.5 text-[var(--t-green)] shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[10px] text-[var(--t-text-muted)] uppercase">{label}</div>
        <div className="text-xs text-[var(--t-text)] leading-relaxed">{value}</div>
      </div>
    </div>
  );
}

export function DestinoQuickFill({ destino, onAddTextoBlock, onAddGaleriaBlock, onUseAsAIContext, onClose }: Props) {
  const handleAddDescricao = () => {
    onAddTextoBlock({
      titulo: `Sobre ${destino.nome}`,
      corpo: destino.descricao,
      alinhamento: 'left',
    });
  };

  const handleAddDicas = () => {
    onAddTextoBlock({
      titulo: `Dicas para ${destino.nome}`,
      corpo: destino.dicas,
      alinhamento: 'left',
    });
  };

  const handleAddGastronomia = () => {
    onAddTextoBlock({
      titulo: `Gastronomia em ${destino.nome}`,
      corpo: destino.gastronomia,
      alinhamento: 'left',
    });
  };

  const handleAddImagens = () => {
    onAddGaleriaBlock({
      imagens: destino.imagens.map(url => ({ url, legenda: '' })),
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[var(--t-green)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--t-text)]">{destino.nome}</div>
            {destino.pais && <div className="text-[10px] text-[var(--t-text-muted)]">{destino.pais}</div>}
          </div>
        </div>
        <button onClick={onClose} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Fast Facts */}
      {destino.fast_facts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {destino.fast_facts.slice(0, 6).map((f, i) => (
            <span key={i} className="text-[10px] bg-[var(--t-bg)] border border-[var(--t-border)] px-1.5 py-0.5 rounded text-[var(--t-text)]">
              <strong>{f.label}:</strong> {f.valor}
            </span>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="space-y-0.5">
        <InfoRow icon={Globe} label="Idioma" value={destino.idioma} />
        <InfoRow icon={Thermometer} label="Clima" value={destino.clima} />
        <InfoRow icon={Clock} label="Fuso" value={destino.fuso} />
        <InfoRow icon={CalendarHeart} label="Melhor epoca" value={destino.melhor_epoca} />
        <InfoRow icon={Utensils} label="Gastronomia" value={destino.gastronomia ? destino.gastronomia.slice(0, 120) + '...' : ''} />
        <InfoRow icon={Lightbulb} label="Dicas" value={destino.dicas ? destino.dicas.slice(0, 120) + '...' : ''} />
      </div>

      {/* Action buttons */}
      <div className="border-t border-[var(--t-border)] pt-3 space-y-1.5">
        <p className="text-[10px] text-[var(--t-text-muted)] uppercase font-medium">Adicionar a proposta</p>

        {destino.descricao && (
          <button
            onClick={handleAddDescricao}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-[var(--t-surface-hover)] transition-colors text-xs text-[var(--t-text)]"
          >
            <Plus className="w-3 h-3 text-[var(--t-green)]" />
            <Type className="w-3 h-3 text-[var(--t-text-muted)]" />
            Descricao como bloco Texto
          </button>
        )}

        {destino.dicas && (
          <button
            onClick={handleAddDicas}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-[var(--t-surface-hover)] transition-colors text-xs text-[var(--t-text)]"
          >
            <Plus className="w-3 h-3 text-[var(--t-green)]" />
            <Lightbulb className="w-3 h-3 text-[var(--t-text-muted)]" />
            Dicas como bloco Texto
          </button>
        )}

        {destino.gastronomia && (
          <button
            onClick={handleAddGastronomia}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-[var(--t-surface-hover)] transition-colors text-xs text-[var(--t-text)]"
          >
            <Plus className="w-3 h-3 text-[var(--t-green)]" />
            <Utensils className="w-3 h-3 text-[var(--t-text-muted)]" />
            Gastronomia como bloco Texto
          </button>
        )}

        {destino.imagens.length > 0 && (
          <button
            onClick={handleAddImagens}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-[var(--t-surface-hover)] transition-colors text-xs text-[var(--t-text)]"
          >
            <Plus className="w-3 h-3 text-[var(--t-green)]" />
            <Image className="w-3 h-3 text-[var(--t-text-muted)]" />
            {destino.imagens.length} imagens na Galeria
          </button>
        )}

        <button
          onClick={() => onUseAsAIContext(destino)}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-purple-500/10 transition-colors text-xs text-purple-400"
        >
          <Sparkles className="w-3 h-3" />
          Usar como contexto para IA
        </button>
      </div>
    </div>
  );
}
