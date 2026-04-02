'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Bot } from 'lucide-react';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  slug: string;
  corPrimaria: string;
  idioma?: IdiomaProposal;
}

export function ChatWidget({ slug, corPrimaria, idioma }: Props) {
  const i18n = t(idioma);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const greeting = idioma === 'en'
    ? 'Hi! I can answer questions about this travel proposal. How can I help?'
    : idioma === 'es'
    ? 'Hola! Puedo responder preguntas sobre esta propuesta de viaje. Como puedo ayudarte?'
    : 'Oi! Posso responder duvidas sobre esta proposta de viagem. Como posso ajudar?';

  const placeholder = idioma === 'en'
    ? 'Ask about the trip...'
    : idioma === 'es'
    ? 'Pregunta sobre el viaje...'
    : 'Pergunte sobre a viagem...';

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`/api/propostas/public/${slug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem: text,
          historico: messages.slice(-10),
        }),
      });
      const data = await res.json();
      if (data.resposta) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.resposta }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.error || 'Erro ao processar.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erro de conexao.' }]);
    }
    setLoading(false);
  };

  // Floating button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-all hover:scale-110 active:scale-95 z-50"
        style={{ backgroundColor: corPrimaria }}
        title={idioma === 'en' ? 'Chat' : idioma === 'es' ? 'Chat' : 'Tirar duvidas'}
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-3rem)] rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 border border-gray-200 bg-white">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white shrink-0"
        style={{ backgroundColor: corPrimaria }}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <span className="font-semibold text-sm">
            {idioma === 'en' ? 'Travel Assistant' : idioma === 'es' ? 'Asistente de Viaje' : 'Assistente de Viagem'}
          </span>
        </div>
        <button onClick={() => setOpen(false)} className="hover:opacity-70 transition-opacity">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: corPrimaria }}>
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-700 max-w-[80%]">
              {greeting}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: corPrimaria }}>
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'text-white rounded-tr-sm'
                  : 'bg-gray-100 text-gray-700 rounded-tl-sm'
              }`}
              style={msg.role === 'user' ? { backgroundColor: corPrimaria } : undefined}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: corPrimaria }}>
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-100 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={placeholder}
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50"
            style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all hover:opacity-90 disabled:opacity-40 shrink-0"
            style={{ backgroundColor: corPrimaria }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
