'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Proposta } from '@/lib/crm-types';
import { CapaSection } from '@/components/propostas/preview/CapaSection';
import { PreviewRenderer } from '@/components/propostas/preview/PreviewRenderer';
import { RodapeSection } from '@/components/propostas/preview/RodapeSection';

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
        // Track view
        fetch(`/api/propostas/public/${slug}/view`, { method: 'POST' }).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Update page title
  useEffect(() => {
    if (proposta) {
      document.title = proposta.cabecalho.titulo || 'Proposta de Viagem';
    }
  }, [proposta]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm mt-4">Carregando proposta...</p>
        </div>
      </div>
    );
  }

  if (error || !proposta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center px-6">
          <div className="text-6xl mb-4">🗺️</div>
          <h1 className="text-2xl font-bold text-gray-800">Proposta nao encontrada</h1>
          <p className="text-gray-500 mt-2">
            Este link pode ter expirado ou a proposta foi removida.
          </p>
          <p className="text-gray-400 text-sm mt-4">
            Entre em contato com seu agente de viagens para obter um novo link.
          </p>
        </div>
      </div>
    );
  }

  const corFundo = proposta.visual.cor_fundo || '#ffffff';
  const corTexto = proposta.visual.cor_texto || '#1a1a2e';

  return (
    <div className="min-h-screen" style={{ backgroundColor: corFundo, color: corTexto }}>
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
          corPrimaria={proposta.visual.cor_primaria || '#10b981'}
        />
      </div>

      {/* Rodape */}
      <div className="max-w-3xl mx-auto px-6">
        <RodapeSection proposta={proposta} />
      </div>

      {/* Validade */}
      {proposta.cabecalho.validade && (
        <div className="text-center pb-8 text-sm opacity-40">
          Proposta valida ate {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString('pt-BR')}
        </div>
      )}
    </div>
  );
}
