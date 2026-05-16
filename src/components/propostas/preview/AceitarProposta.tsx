'use client';

import { useState } from 'react';
import { CheckCircle, MessageSquare, Loader2, ThumbsUp, Send, X, User, Phone, Mail, FileText } from 'lucide-react';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  slug: string;
  status: string;
  corPrimaria: string;
  vendedorNome: string;
  aceite?: { nome_aceite: string; data_aceite: string } | null;
  idioma?: IdiomaProposal;
}

type Mode = 'idle' | 'aceitar' | 'alteracao' | 'aceito' | 'alteracao_enviada';

// Formulario UNICO de aceite/alteracao da proposta publica.
// Cliente escolhe entre "Aceitar Proposta" ou "Solicitar Alteracoes".
// Em ambos os casos preenche nome + telefone + email; "Solicitar
// Alteracoes" tem campo extra de anotacao.
// Submit cria automaticamente Cliente + Negociacao (Venda CRM) no
// backend pra o vendedor ja achar tudo organizado no CRM.
export function AceitarProposta({ slug, status, corPrimaria, vendedorNome, aceite, idioma }: Props) {
  const i18n = t(idioma);
  const [mode, setMode] = useState<Mode>(status === 'ACEITO' ? 'aceito' : 'idle');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [anotacao, setAnotacao] = useState('');
  const [termos, setTermos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';

  // Already accepted
  if (status === 'ACEITO' || mode === 'aceito') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-[20px] border-2 border-emerald-200 bg-emerald-50">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <ThumbsUp className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-emerald-800">{i18n.propostaAceita}</h3>
          <p className="text-emerald-600 mt-2 text-sm">
            {aceite?.nome_aceite
              ? `${aceite.nome_aceite} — ${new Date(aceite.data_aceite).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : i18n.obrigadoAceite
            }
          </p>
          {vendedorNome && (
            <p className="text-emerald-500 text-sm mt-3">
              {vendedorNome} {i18n.voltarContato}
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
        <div className="text-center p-8 rounded-[20px] border-2 border-red-200 bg-red-50">
          <h3 className="text-lg font-bold text-red-800">Proposta Recusada</h3>
        </div>
      </div>
    );
  }

  // Solicitacao de alteracao enviada
  if (mode === 'alteracao_enviada') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-[20px] border-2 border-blue-200 bg-blue-50">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-blue-800">{i18n.feedbackEnviado}</h3>
          <p className="text-blue-600 mt-2 text-sm">{i18n.obrigadoFeedback}</p>
          {vendedorNome && (
            <p className="text-blue-500 text-sm mt-3">
              {vendedorNome} {i18n.voltarContato}
            </p>
          )}
        </div>
      </div>
    );
  }

  function validarComuns(): string {
    if (!nome.trim()) return i18n.nomeCompleto;
    if (!telefone.trim() && !email.trim()) return 'Informe telefone ou email para contato';
    return '';
  }

  const handleAceitar = async () => {
    const err = validarComuns();
    if (err) { setError(err); return; }
    if (!termos) { setError(i18n.termosCondicoes); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/propostas/public/${slug}/aceitar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          telefone: telefone.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMode('aceito');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setLoading(false);
  };

  const handleAlteracao = async () => {
    const err = validarComuns();
    if (err) { setError(err); return; }
    if (!anotacao.trim()) { setError('Descreva a alteracao desejada'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/propostas/public/${slug}/solicitar-alteracao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          telefone: telefone.trim(),
          email: email.trim(),
          anotacao: anotacao.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMode('alteracao_enviada');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="rounded-[20px] border-2 overflow-hidden" style={{ borderColor: `${corPrimaria}30` }}>
        {/* Header */}
        <div className="p-6 text-center" style={{ backgroundColor: `${corPrimaria}08` }}>
          <h3 className="text-xl font-bold" style={{ color: corPrimaria }}>
            {idioma === 'en' ? 'What do you think?' : idioma === 'es' ? 'Que te parece?' : 'O que achou da proposta?'}
          </h3>
        </div>

        {/* Idle: show 2 botoes */}
        {mode === 'idle' && (
          <div className="p-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => { setMode('aceitar'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ backgroundColor: corPrimaria }}
            >
              <CheckCircle className="w-5 h-5" />
              {i18n.aceitarProposta}
            </button>
            <button
              onClick={() => { setMode('alteracao'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-semibold text-sm border-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ borderColor: corPrimaria, color: corPrimaria }}
            >
              <MessageSquare className="w-5 h-5" />
              {i18n.solicitarAlteracoes}
            </button>
          </div>
        )}

        {/* FORM UNICO — nome/telefone/email pra ambos os caminhos.
            Solicitar Alteracoes ganha textarea extra de anotacao. */}
        {(mode === 'aceitar' || mode === 'alteracao') && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">
                {mode === 'aceitar' ? i18n.aceitarProposta : i18n.solicitarAlteracoes}
              </h4>
              <button onClick={() => setMode('idle')} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nome */}
            <div>
              <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                <User className="w-3.5 h-3.5" /> {i18n.nomeCompleto} *
              </label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder={i18n.nomeCompleto}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
            </div>

            {/* Telefone */}
            <div>
              <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                <Phone className="w-3.5 h-3.5" /> Telefone / WhatsApp *
              </label>
              <input
                type="tel"
                value={telefone}
                onChange={e => setTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
            </div>

            {/* Email */}
            <div>
              <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5" /> E-mail *
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
            </div>

            {/* Anotacao — so em modo alteracao */}
            {mode === 'alteracao' && (
              <div>
                <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                  <FileText className="w-3.5 h-3.5" /> Sua solicitacao *
                </label>
                <textarea
                  value={anotacao}
                  onChange={e => setAnotacao(e.target.value)}
                  rows={4}
                  placeholder="Descreva o que voce gostaria de mudar (datas, hotel, voos, valor, etc)"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                />
              </div>
            )}

            {/* Termos — so em modo aceitar */}
            {mode === 'aceitar' && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termos}
                  onChange={e => setTermos(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300"
                />
                <span className="text-sm text-gray-600 leading-relaxed">
                  {i18n.liEConcordo} {i18n.termosCondicoes}.
                </span>
              </label>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={mode === 'aceitar' ? handleAceitar : handleAlteracao}
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 ${
                mode === 'aceitar' ? 'text-white' : 'border-2'
              }`}
              style={mode === 'aceitar'
                ? { backgroundColor: corPrimaria }
                : { borderColor: corPrimaria, color: corPrimaria }
              }
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : mode === 'aceitar' ? <CheckCircle className="w-4 h-4" /> : <Send className="w-4 h-4" />
              }
              {mode === 'aceitar' ? i18n.confirmarAceite : i18n.enviarSolicitacao}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
