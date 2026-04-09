'use client';

/**
 * Sidebar esquerda da tela de edição de funil. 8 categorias expandidas,
 * cada tipo é arrastável com ícone e cor específica.
 */

import { CATEGORIA_INFO, CATEGORIAS_ORDEM, type TipoInfo } from './categorias';
import type { TipoNode } from '@/lib/funil-types';

interface BibliotecaNodesProps {
  onDragStart: (e: React.DragEvent, tipo: TipoNode) => void;
}

/** Mini-preview visual que aparece ao lado do label na sidebar. */
function MiniPreview({ t, catColor }: { t: TipoInfo; catColor: string }) {
  const visual = t.visual ?? 'document';
  const brandColor = t.brandColor ?? catColor;
  const Icon = t.icone;

  if (visual === 'circle' || visual === 'phone') {
    return (
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={{ background: brandColor }}
      >
        <Icon className="w-3 h-3 text-white" />
      </div>
    );
  }

  if (visual === 'diamond') {
    return (
      <div
        className="w-5 h-5 rotate-45 rounded-sm flex items-center justify-center shrink-0"
        style={{ background: brandColor }}
      >
        <Icon className="w-2.5 h-2.5 text-white -rotate-45" />
      </div>
    );
  }

  if (visual === 'page' || visual === 'page-success' || visual === 'video') {
    return (
      <div className="w-7 h-6 rounded-[3px] overflow-hidden bg-white border border-[#e5e7eb] shrink-0">
        <div className="h-[4px] bg-[#f1f3f5] flex items-center gap-[1px] px-[2px]">
          <span className="w-[2px] h-[2px] rounded-full bg-[#ff6b6b]" />
          <span className="w-[2px] h-[2px] rounded-full bg-[#ffd43b]" />
          <span className="w-[2px] h-[2px] rounded-full bg-[#51cf66]" />
        </div>
        <div className="px-1 py-0.5 flex flex-col gap-[1px]">
          <div className="h-[1.5px] w-[60%] bg-[#dee2e6] rounded-sm" />
          <div className="h-[3px] rounded-[1px]" style={{ background: catColor }} />
        </div>
      </div>
    );
  }

  // email, chat, content, document
  return (
    <div
      className="w-6 h-6 rounded flex items-center justify-center shrink-0"
      style={{ background: brandColor + '18' }}
    >
      <Icon className="w-3 h-3" style={{ color: brandColor }} />
    </div>
  );
}

export function BibliotecaNodes({ onDragStart }: BibliotecaNodesProps) {
  return (
    <aside className="w-[250px] shrink-0 border-r border-[var(--t-border)] bg-[var(--t-surface)] overflow-y-auto p-3">
      <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider mb-3 font-semibold">
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
              <span className="text-[9px] text-[var(--t-text-muted)] ml-auto">{info.tipos.length}</span>
            </div>
            <div className="space-y-1">
              {info.tipos.map(t => (
                <div
                  key={t.tipo}
                  draggable
                  onDragStart={(e) => onDragStart(e, t.tipo)}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] hover:bg-[var(--t-green-bg)]/30 cursor-grab active:cursor-grabbing transition-colors"
                  title={`Arraste ${t.label} para o canvas`}
                >
                  <MiniPreview t={t} catColor={info.color} />
                  <span className="text-[11px] text-[var(--t-text)] truncate">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
