'use client';

// Pagina dedicada para preview de proposta dentro de iframe. Usada pelo
// LivePreviewPanel no editor — pra que o conteudo respeite a largura
// do "celular" (430px) e Tailwind disparare breakpoints mobile reais.
//
// Sem API calls. A proposta chega via window.postMessage do parent
// (editor). Quando o parent atualiza o estado, manda nova mensagem e
// o iframe re-renderiza. Reuso completo dos renderers que /p/[slug] usa.

import { useEffect, useState } from 'react';
import type { Proposta } from '@/lib/crm-types';
import { CapaSection } from '@/components/propostas/preview/CapaSection';
import { PreviewRenderer } from '@/components/propostas/preview/PreviewRenderer';
import { RodapeSection } from '@/components/propostas/preview/RodapeSection';
import { DiscoveryRenderer } from '@/components/propostas/preview/discovery/DiscoveryRenderer';
import type { IdiomaProposal } from '@/lib/i18n-proposta';

interface PreviewMessage {
  kind: 'entur:preview:proposta';
  proposta: Proposta;
}

export default function PreviewIframePage() {
  const [proposta, setProposta] = useState<Proposta | null>(null);

  useEffect(() => {
    // Aceita mensagens do parent (LivePreviewPanel). Em producao, o
    // parent e o mesmo origin (fin.enturos.com) entao postMessage e
    // direto. Em iframe cross-origin precisaria checar event.origin —
    // aqui assumimos same-origin.
    const handler = (e: MessageEvent) => {
      const data = e.data as PreviewMessage | undefined;
      if (data && data.kind === 'entur:preview:proposta' && data.proposta) {
        setProposta(data.proposta);
      }
    };
    window.addEventListener('message', handler);
    // Sinaliza ao parent que esta pronto pra receber dados.
    window.parent?.postMessage({ kind: 'entur:preview:ready' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!proposta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Aguardando dados...</p>
        </div>
      </div>
    );
  }

  const isDiscovery = proposta.visual?.layout === 'DISCOVERY';
  const corFundo = proposta.visual?.cor_fundo || '#ffffff';
  const corTexto = proposta.visual?.cor_texto || '#1a1a2e';
  const corPrimaria = proposta.visual?.cor_primaria || '#004aad';
  const fonte = proposta.visual?.fonte || 'Inter';
  const idioma = (proposta.idioma || 'pt-BR') as IdiomaProposal;

  // Discovery encapsula tudo (hero + sections + footer + cta proprio).
  if (isDiscovery) {
    return (
      <div style={{ fontFamily: `'${fonte}', sans-serif` }}>
        <DiscoveryRenderer proposta={proposta} slug="preview" idioma={idioma} />
      </div>
    );
  }

  // Classico — replica exatamente o layout de /p/[slug] sem widgets de
  // engajamento (chat/lead/aceitacao) que nao fazem sentido em preview.
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: corFundo, color: corTexto, fontFamily: `'${fonte}', sans-serif` }}
    >
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
    </div>
  );
}
