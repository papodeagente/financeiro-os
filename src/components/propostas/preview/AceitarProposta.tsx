'use client';

import { useState } from 'react';
import { CheckCircle, MessageSquare, Loader2, ThumbsUp, Send, X } from 'lucide-react';

interface Props {
  slug: string;
  status: string;
  corPrimaria: string;
  vendedorNome: string;
  aceite?: { nome_aceite: string; data_aceite: string } | null;
}

type Mode = 'idle' | 'aceitar' | 'feedback' | 'aceito' | 'feedback_sent';

export function AceitarProposta({ slug, status, corPrimaria, vendedorNome, aceite }: Props) {
  const [mode, setMode] = useState<Mode>(status === 'ACEITO' ? 'aceito' : 'idle');
  const [nome, setNome] = useState('');
  const [termos, setTermos] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [nomeFeedback, setNomeFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Already accepted
  if (status === 'ACEITO' || mode === 'aceito') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-2xl border-2 border-emerald-200 bg-emerald-50">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <ThumbsUp className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-emerald-800">Proposta Aceita!</h3>
          <p className="text-emerald-600 mt-2 text-sm">
            {aceite?.nome_aceite
              ? `Aceita por ${aceite.nome_aceite} em ${new Date(aceite.data_aceite).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'Esta proposta foi aceita com sucesso.'
            }
          </p>
          {vendedorNome && (
            <p className="text-emerald-500 text-sm mt-3">
              {vendedorNome} entrara em contato em breve para os proximos passos.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Already rejected
  if (status === 'RECUSADO') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-2xl border-2 border-red-200 bg-red-50">
          <h3 className="text-lg font-bold text-red-800">Proposta Recusada</h3>
          <p className="text-red-600 mt-2 text-sm">
            Esta proposta foi recusada. Entre em contato com seu agente para mais informacoes.
          </p>
        </div>
      </div>
    );
  }

  // Feedback sent confirmation
  if (mode === 'feedback_sent') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-2xl border-2 border-blue-200 bg-blue-50">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-blue-800">Mensagem Enviada!</h3>
          <p className="text-blue-600 mt-2 text-sm">
            Suas solicitacoes de alteracao foram enviadas para {vendedorNome || 'o vendedor'}.
          </p>
          <button
            onClick={() => setMode('idle')}
            className="mt-4 text-sm text-blue-500 hover:text-blue-700 underline"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const handleAceitar = async () => {
    if (!nome.trim()) { setError('Preencha seu nome completo'); return; }
    if (!termos) { setError('Aceite os termos para continuar'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/propostas/public/${slug}/aceitar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome_aceite: nome.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao aceitar');
      setMode('aceito');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao aceitar proposta');
    }
    setLoading(false);
  };

  const handleFeedback = async () => {
    if (!mensagem.trim()) { setError('Escreva sua mensagem'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/propostas/public/${slug}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: mensagem.trim(), nome: nomeFeedback.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      setMode('feedback_sent');
      setMensagem('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mensagem');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: `${corPrimaria}30` }}>
        {/* Header */}
        <div className="p-6 text-center" style={{ backgroundColor: `${corPrimaria}08` }}>
          <h3 className="text-xl font-bold" style={{ color: corPrimaria }}>
            O que achou da proposta?
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            Escolha uma opcao abaixo para dar seu retorno
          </p>
        </div>

        {/* Idle: show buttons */}
        {mode === 'idle' && (
          <div className="p-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => { setMode('aceitar'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ backgroundColor: corPrimaria }}
            >
              <CheckCircle className="w-5 h-5" />
              Aceitar Proposta
            </button>
            <button
              onClick={() => { setMode('feedback'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-semibold text-sm border-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ borderColor: corPrimaria, color: corPrimaria }}
            >
              <MessageSquare className="w-5 h-5" />
              Solicitar Alteracoes
            </button>
          </div>
        )}

        {/* Aceitar form */}
        {mode === 'aceitar' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">Aceitar Proposta</h4>
              <button onClick={() => setMode('idle')} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-sm text-gray-600 block mb-1">Seu nome completo *</label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Digite seu nome completo"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={termos}
                onChange={e => setTermos(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-gray-300"
              />
              <span className="text-sm text-gray-600 leading-relaxed">
                Declaro que li e concordo com os termos desta proposta, incluindo valores, condicoes de pagamento e servicos descritos.
              </span>
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={handleAceitar}
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: corPrimaria }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {loading ? 'Processando...' : 'Confirmar Aceite'}
            </button>
          </div>
        )}

        {/* Feedback form */}
        {mode === 'feedback' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">Solicitar Alteracoes</h4>
              <button onClick={() => setMode('idle')} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-sm text-gray-600 block mb-1">Seu nome</label>
              <input
                type="text"
                value={nomeFeedback}
                onChange={e => setNomeFeedback(e.target.value)}
                placeholder="Seu nome (opcional)"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              />
            </div>

            <div>
              <label className="text-sm text-gray-600 block mb-1">O que gostaria de alterar? *</label>
              <textarea
                value={mensagem}
                onChange={e => setMensagem(e.target.value)}
                rows={4}
                placeholder="Descreva as alteracoes desejadas: datas, destinos, servicos, valores..."
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:border-transparent"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={handleFeedback}
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border-2 transition-all hover:opacity-90 disabled:opacity-50"
              style={{ borderColor: corPrimaria, color: corPrimaria }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {loading ? 'Enviando...' : 'Enviar Solicitacao'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
