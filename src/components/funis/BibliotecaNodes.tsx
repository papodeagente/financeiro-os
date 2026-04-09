'use client';

/**
 * Sidebar esquerda da tela de edição de funil. 8 categorias, cada uma
 * expandida, cada tipo é arrastável.
 */

import { CATEGORIA_INFO, CATEGORIAS_ORDEM } from './categorias';
import type { TipoNode } from '@/lib/funil-types';

interface BibliotecaNodesProps {
  onDragStart: (e: React.DragEvent, tipo: TipoNode) => void;
}

export function BibliotecaNodes({ onDragStart }: BibliotecaNodesProps) {
  return (
    <aside className="w-[240px] shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto p-3">
      <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider mb-2">
        Arraste para o canvas
      </p>
      {CATEGORIAS_ORDEM.map(cat => {
        const info = CATEGORIA_INFO[cat];
        const Icon = info.icon;
        return (
          <div key={cat} className="mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div
                className="w-3.5 h-3.5 rounded-sm flex items-center justify-center"
                style={{ background: info.color }}
              >
                <Icon className="w-2.5 h-2.5 text-white" />
              </div>
              <p className="text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider">
                {info.label}
              </p>
            </div>
            <div className="space-y-1">
              {info.tipos.map(t => {
                const TipoIcon = t.icone;
                return (
                  <div
                    key={t.tipo}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.tipo)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] hover:bg-[var(--t-green-bg)]/30 cursor-grab active:cursor-grabbing transition-colors"
                    title={`Arraste ${t.label} para o canvas`}
                  >
                    <TipoIcon className="w-3.5 h-3.5 shrink-0" style={{ color: info.color }} />
                    <span className="text-[11px] text-[var(--t-text)] truncate">{t.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
