'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { Proposta } from '@/lib/crm-types';
import { CapaSection } from './preview/CapaSection';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { RodapeSection } from './preview/RodapeSection';
import { DiscoveryRenderer } from './preview/discovery/DiscoveryRenderer';
import { PhoneFrame } from './PhoneFrame';
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

  // O frame e desenhado em 430px de largura. Quando o painel disponivel
  // for menor, escalamos via CSS transform pra caber. Medimos o
  // container e calculamos um scale dinamico.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // Phone base: 430 px largura, ~932 px altura (aspect 9:19.5).
    // Deixamos margem de 32px nos dois eixos.
    const compute = () => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      const sx = w / 430;
      const sy = h / 932;
      const s = Math.min(sx, sy, 1); // nunca passa de 1:1
      setScale(Math.max(0.35, s));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Conteudo da proposta — encapsulado pra ser reutilizado dentro do
  // PhoneFrame. CapaSection/PreviewRenderer/RodapeSection consomem o
  // tema (cor_fundo/cor_texto/fonte) via style externo.
  const propostaContent = (
    <div
      className="min-h-full"
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
            <div className="px-4 py-6 text-center">
              <p className="text-sm leading-relaxed opacity-80 italic">
                {proposta.cabecalho.mensagem_abertura}
              </p>
            </div>
          )}
          <div className="px-4 py-4">
            <PreviewRenderer
              secoes={proposta.secoes}
              corPrimaria={corPrimaria}
              idioma={idioma}
            />
          </div>
          <div className="px-4 pb-8">
            <RodapeSection proposta={proposta} />
          </div>
        </>
      )}
    </div>
  );

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
            · iPhone Pro Max · {proposta.secoes.filter(s => s.visivel).length} blocos visíveis
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

      {/* Stage: gradient sutil de fundo + flex centralizado. O frame
          do celular fica centralizado e escalado pra caber. */}
      <div
        ref={stageRef}
        className="flex-1 flex items-center justify-center p-4 overflow-hidden"
        style={{
          background: 'radial-gradient(circle at 50% 30%, rgba(10, 132, 255, 0.06), transparent 60%), var(--t-bg)',
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            transition: 'transform 200ms ease-out',
          }}
        >
          <PhoneFrame>{propostaContent}</PhoneFrame>
        </div>
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
