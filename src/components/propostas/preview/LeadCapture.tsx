'use client';

import { useState } from 'react';
import { Send, Loader2, CheckCircle, User, Mail, Phone, MessageSquare } from 'lucide-react';

interface Props {
  slug: string;
  corPrimaria: string;
  vendedorNome: string;
}

export function LeadCapture({ slug, corPrimaria, vendedorNome }: Props) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (sent) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-center p-8 rounded-2xl border-2 border-emerald-200 bg-emerald-50">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-emerald-600" />
          </div>
          <h3 className="text-lg font-bold text-emerald-800">Interesse registrado!</h3>
          <p className="text-emerald-600 mt-2 text-sm">
            {vendedorNome || 'Nosso consultor'} entrara em contato em breve.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!nome.trim()) { setError('Preencha seu nome'); return; }
    if (!email.trim() && !telefone.trim()) { setError('Preencha email ou telefone'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/propostas/public/${slug}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, telefone, mensagem }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${corPrimaria}25` }}>
        <div className="p-5 text-center" style={{ backgroundColor: `${corPrimaria}08` }}>
          <h3 className="text-lg font-bold text-gray-800">Gostou desta proposta?</h3>
          <p className="text-gray-500 text-sm mt-1">
            Deixe seus dados e {vendedorNome || 'nosso consultor'} entra em contato
          </p>
        </div>

        <div className="p-5 space-y-3">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Seu nome *"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="tel"
                value={telefone}
                onChange={e => setTelefone(e.target.value)}
                placeholder="WhatsApp"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              />
            </div>
          </div>
          <div className="relative">
            <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <textarea
              value={mensagem}
              onChange={e => setMensagem(e.target.value)}
              placeholder="Alguma duvida ou preferencia? (opcional)"
              rows={2}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:border-transparent"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: corPrimaria }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? 'Enviando...' : 'Tenho interesse!'}
          </button>

          <p className="text-[10px] text-gray-400 text-center">
            Seus dados serao usados apenas para contato sobre esta proposta.
          </p>
        </div>
      </div>
    </div>
  );
}
