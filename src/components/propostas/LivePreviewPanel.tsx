'use client';

import { memo } from 'react';
import type { Proposta } from '@/lib/crm-types';
import { CapaSection } from './preview/CapaSection';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { RodapeSection } from './preview/RodapeSection';
import { DiscoveryRenderer } from './preview/discovery/DiscoveryRenderer';
import { Eye, X } from 'lucide-react';

interface Props {
  proposta: Proposta;
  onClose: () => void;
}

// Renderiza a proposta exatamente como o cliente final ve em /p/[slug]
// — porem dentro do editor, lado a lado com a edicao. O componente e
// memo'd contra a referencia de proposta pra evitar re-render desneces-
// sario quando outros estados do editor mudam (auto-save status etc.).
//
// Funciona pros dois layouts (CLASSICO e DISCOVERY) consumindo os
// mesmos renderers usados em /p/[slug].
function LivePreviewPanelInner({ proposta, onClose }: Props) {
  const isDiscovery = proposta.visual?.layout === 'DISCOVERY';
  const corFundo = proposta.visual?.cor_fundo || '#ffffff';
  const corTexto = proposta.visual?.cor_texto || '#1a1a2e';
  const corPrimaria = proposta.visual?.cor_primaria || '#004aad';
  const fonte = proposta.visual?.fonte || 'Inter';
  const idioma = proposta.idioma || 'pt-BR';

  return (
    <aside
      className="flex-1 border-l border-[var(--t-border)] bg-[var(--t-bg)] flex flex-col overflow-hidden"
      aria-label="Preview ao vivo da proposta"
    >
      {/* Toolbar do preview */}
      <div className="shrink-0 px-4 py-2 border-b border-[var(--t-border)] bg-[var(--t-surface)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-[var(--t-green)]" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">
            Preview ao vivo
          </span>
          <span className="text-[10px] text-[var(--t-text-muted)]">
            · {proposta.secoes.filter(s => s.visivel).length} blocos visíveis
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Fechar preview"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Iframe-like container — escopo da fonte e cores pra nao
          vazar pro chrome do editor. Scroll proprio. */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: corFundo, color: corTexto, fontFamily: `'${fonte}', sans-serif` }}
      >
        {isDiscovery ? (
          // Discovery renderiza tudo (hero + sections + footer). slug
          // 'preview' e simbolico — chat/lead-capture nao sao ativados.
          <DiscoveryRenderer proposta={proposta} slug="preview" idioma={idioma} />
        ) : (
          <>
            <CapaSection proposta={proposta} />
            {proposta.cabecalho.mensagem_abertura && (
              <div className="max-w-3xl mx-auto px-6 py-10 text-center">
                <p className="text-lg leading-relaxed opacity-80 italic">
                  {proposta.cabecalho.mensagem_abertura}
                </p>
              </div>
            )}
            <div className="max-w-3xl mx-auto px-6 py-8">
              <PreviewRenderer
                secoes={proposta.secoes}
                corPrimaria={corPrimaria}
                idioma={idioma}
              />
            </div>
            <div className="max-w-3xl mx-auto px-6 pb-12">
              <RodapeSection proposta={proposta} />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export const LivePreviewPanel = memo(
  LivePreviewPanelInner,
  // Re-render apenas quando a proposta mudar de referencia. Outros
  // estados (paletteDragging, autoSaveStatus, etc.) nao precisam
  // disparar o re-render pesado do preview.
  (prev, next) => prev.proposta === next.proposta,
);
