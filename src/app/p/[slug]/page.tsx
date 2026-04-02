'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Proposta } from '@/lib/crm-types';
import { CapaSection } from '@/components/propostas/preview/CapaSection';
import { PreviewRenderer } from '@/components/propostas/preview/PreviewRenderer';
import { RodapeSection } from '@/components/propostas/preview/RodapeSection';
import { AceitarProposta } from '@/components/propostas/preview/AceitarProposta';
import { LeadCapture } from '@/components/propostas/preview/LeadCapture';
import { ChatWidget } from '@/components/propostas/preview/ChatWidget';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

export default function PublicPropostaPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/propostas/public/${slug}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(data => {
        if (!data?.id) throw new Error('Not found');
        setProposta(data);
        // Initial view track (without time)
        fetch(`/api/propostas/public/${slug}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tempo_segundos: 0 }),
        }).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Track time on page
  const startTime = useRef(Date.now());
  useEffect(() => {
    const sendTime = () => {
      const segundos = Math.round((Date.now() - startTime.current) / 1000);
      if (segundos > 5) {
        navigator.sendBeacon(
          `/api/propostas/public/${slug}/view`,
          JSON.stringify({ tempo_segundos: segundos })
        );
      }
    };
    window.addEventListener('beforeunload', sendTime);
    return () => window.removeEventListener('beforeunload', sendTime);
  }, [slug]);

  // Update page title
  useEffect(() => {
    if (proposta) {
      document.title = proposta.cabecalho.titulo || 'Proposta de Viagem';
    }
  }, [proposta]);

  const idioma = (proposta?.idioma || 'pt-BR') as IdiomaProposal;
  const i18n = t(idioma);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm mt-4">{i18n.carregando}</p>
        </div>
      </div>
    );
  }

  if (error || !proposta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center px-6">
          <div className="text-6xl mb-4">🗺️</div>
          <h1 className="text-2xl font-bold text-gray-800">{i18n.propostaNaoEncontrada}</h1>
          <p className="text-gray-500 mt-2">{i18n.linkExpirado}</p>
          <p className="text-gray-400 text-sm mt-4">{i18n.contateAgente}</p>
        </div>
      </div>
    );
  }

  const corFundo = proposta.visual.cor_fundo || '#ffffff';
  const corTexto = proposta.visual.cor_texto || '#1a1a2e';
  const fonte = proposta.visual.fonte || 'Inter';
  const needsPlayfair = fonte === 'Playfair Display';

  return (
    <div className="min-h-screen" style={{ backgroundColor: corFundo, color: corTexto, fontFamily: `'${fonte}', sans-serif` }}>
      {/* Google Fonts */}
      {needsPlayfair && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      )}
      {/* Capa */}
      <CapaSection proposta={proposta} />

      {/* Mensagem de abertura */}
      {proposta.cabecalho.mensagem_abertura && (
        <div className="max-w-3xl mx-auto px-6 py-10 text-center">
          <p className="text-lg leading-relaxed opacity-80 italic">
            {proposta.cabecalho.mensagem_abertura}
          </p>
        </div>
      )}

      {/* Conteudo */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <PreviewRenderer
          secoes={proposta.secoes}
          corPrimaria={proposta.visual.cor_primaria || '#004aad'}
          idioma={idioma}
        />
      </div>

      {/* Rodape */}
      <div className="max-w-3xl mx-auto px-6">
        <RodapeSection proposta={proposta} />
      </div>

      {/* Aceitacao Digital */}
      {proposta.status !== 'EXPIRADO' && proposta.status !== 'CONVERTIDO' && (
        <AceitarProposta
          slug={slug}
          status={proposta.status}
          corPrimaria={proposta.visual.cor_primaria || '#004aad'}
          vendedorNome={proposta.rodape.nome_vendedor}
          aceite={proposta.aceite}
          idioma={idioma}
        />
      )}

      {/* Lead Capture — shown for proposals without specific client */}
      <LeadCapture
        slug={slug}
        corPrimaria={proposta.visual.cor_primaria || '#004aad'}
        vendedorNome={proposta.rodape.nome_vendedor}
        idioma={idioma}
      />

      {/* Validade */}
      {proposta.cabecalho.validade && (
        <div className="text-center pb-8 text-sm opacity-40">
          {i18n.validaAte} {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString(idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR')}
        </div>
      )}

      {/* AI Chat Widget */}
      <ChatWidget
        slug={slug}
        corPrimaria={proposta.visual.cor_primaria || '#004aad'}
        idioma={idioma}
      />
    </div>
  );
}
