'use client';

import { useEffect, useRef, useState } from 'react';
import type { Proposta } from '@/lib/crm-types';
import type { PreviewEditorBlockType } from './PreviewEditorContext';

interface Props {
  proposta: Proposta;
  // Disparado quando o iframe envia postMessage de clique em bloco.
  onBlockSelect: (blockType: PreviewEditorBlockType, conteudoId: string) => void;
}

// Wrapper de iframe pra renderizar a proposta com viewport REAL do
// dispositivo (Tablet 768 / Mobile 410). Dentro do iframe, breakpoints
// do Tailwind disparam corretamente porque o viewport do documento e
// a largura do iframe — entao md:/lg: respondem como se fosse um
// celular/tablet de verdade.
//
// Sincronizacao com a proposta via postMessage:
// - Mount: aguarda iframe sinalizar "ready"
// - State change: envia proposta atualizada
// - Click em bloco dentro do iframe: iframe posta de volta com
//   { blockType, conteudoId } → parent chama onBlockSelect
export function PreviewIframeCanvas({ proposta, onBlockSelect }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  // Listener das mensagens do iframe child
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { kind?: string } | undefined;
      if (!data) return;
      if (data.kind === 'entur:preview:ready') {
        setReady(true);
      }
      if (data.kind === 'entur:preview:select') {
        const { blockType, conteudoId } = data as {
          blockType: PreviewEditorBlockType;
          conteudoId: string;
        };
        onBlockSelect(blockType, conteudoId);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onBlockSelect]);

  // Sincroniza proposta com o iframe a cada mudanca de estado
  useEffect(() => {
    if (!ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({
      kind: 'entur:preview:proposta',
      proposta,
      editor: true,
    }, '*');
  }, [proposta, ready]);

  return (
    <iframe
      ref={iframeRef}
      src="/preview-iframe"
      title="Preview da proposta"
      className="w-full border-0 block"
      // Altura cheia da viewport disponivel — iframe internamente
      // controla seu proprio scroll quando o conteudo passa.
      style={{ height: 'calc(100vh - 12rem)', display: 'block' }}
    />
  );
}
