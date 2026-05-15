'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { Proposta } from '@/lib/crm-types';
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
  // O frame e desenhado em 430px de largura (escala 1:1 do iPhone Pro
  // Max). Quando o painel disponivel for menor, escalamos via CSS
  // transform pra caber sem cortar. Medimos o painel via ResizeObserver
  // e calculamos scale dinamico.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(1);
  const [iframeReady, setIframeReady] = useState(false);
  const PHONE_W = 430;
  const PHONE_H = 932;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      // Margem interna pra dar respiro (16px top, 16px laterais, 16px bottom).
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      const sx = w / PHONE_W;
      const sy = h / PHONE_H;
      const s = Math.min(sx, sy, 1); // nunca passa de 1:1 (real size)
      setScale(Math.max(0.3, s));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Listener pra mensagem 'ready' do iframe child. Quando o iframe
  // monta e avisa que esta pronto, marcamos pra mandar o estado.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { kind?: string } | undefined;
      if (data?.kind === 'entur:preview:ready') {
        setIframeReady(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Sempre que a proposta mudar (ou o iframe avisar que esta pronto),
  // envia o estado atual via postMessage. O iframe re-renderiza com os
  // dados novos — sem reload, sem flicker.
  useEffect(() => {
    if (!iframeReady) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ kind: 'entur:preview:proposta', proposta }, '*');
  }, [proposta, iframeReady]);

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

      {/* Stage: gradient sutil de fundo. Phone alinhado ao TOPO pra que
          o cabecalho da proposta fique sempre visivel. Wrapper com
          dimensoes escaladas reserva exatamente o espaco visual do
          phone (transformOrigin top-left + container com tamanho
          escalado), sem deixar whitespace ao redor. */}
      <div
        ref={stageRef}
        className="flex-1 flex items-start justify-center pt-4 pb-4 px-4 overflow-hidden"
        style={{
          background: 'radial-gradient(circle at 50% 20%, rgba(10, 132, 255, 0.06), transparent 60%), var(--t-bg)',
        }}
      >
        <div
          // Container com dimensoes escaladas — assim o flex pai trata
          // o phone visualmente como se fosse desse tamanho. Sem isso,
          // o wrapper interno teria 430×932 no DOM e haveria
          // whitespace ao redor do phone visivel.
          style={{
            width: PHONE_W * scale,
            height: PHONE_H * scale,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              transition: 'transform 200ms ease-out',
              width: PHONE_W,
              height: PHONE_H,
            }}
          >
            <PhoneFrame>
              {/* iframe ocupa toda a tela do phone (cobre safe areas
                  intencionalmente — em iOS o conteudo vai por baixo do
                  status bar; mantemos esse comportamento). Largura
                  efetiva ~410px = renderiza em mobile breakpoint real. */}
              <iframe
                ref={iframeRef}
                src="/preview-iframe"
                title="Preview da proposta"
                className="w-full h-full border-0"
                style={{ display: 'block' }}
              />
            </PhoneFrame>
          </div>
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
