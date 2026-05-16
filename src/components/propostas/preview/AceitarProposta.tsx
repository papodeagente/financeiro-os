'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

// ============ Validacoes ============

function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function validarTelefone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}
function validarNome(s: string): boolean {
  const t = s.trim();
  return t.length >= 3 && /\s/.test(t); // ao menos 2 palavras
}

// ============ Idempotency key ============
// Gera um request_id por SESSAO do componente. Re-cliques ou
// re-submits do mesmo form usam o mesmo id → backend bloqueia
// duplicidade. Reset apos sucesso (so se o usuario fechar e abrir
// de novo, mas ai ele ja vai ver tela de sucesso).
function gerarRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Chave do localStorage que registra que esta sessao de browser ja
// enviou pra essa proposta (proteciona contra reenvio apos refresh).
function localStorageKey(slug: string, tipo: 'aceite' | 'alteracao'): string {
  return `entur:proposta-submit:${slug}:${tipo}`;
}

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

  // Idempotency: cada par (modo, tentativa) tem um request_id. Reset
  // quando trocar modo idle <-> form.
  const requestIdRef = useRef<{ aceite: string; alteracao: string }>({
    aceite: gerarRequestId(),
    alteracao: gerarRequestId(),
  });

  // Verifica no mount: se ja enviou nesta proposta+modo, marca como
  // concluido sem mostrar form (protege contra refresh apos sucesso).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const aceiteEnv = localStorage.getItem(localStorageKey(slug, 'aceite'));
      const altEnv = localStorage.getItem(localStorageKey(slug, 'alteracao'));
      if (aceiteEnv) setMode('aceito');
      else if (altEnv) setMode('alteracao_enviada');
    } catch { /* ignore */ }
  }, [slug]);

  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';

  const validation = useMemo(() => {
    const v: { nome?: string; telefone?: string; email?: string; anotacao?: string; termos?: string } = {};
    if (nome.trim() && !validarNome(nome)) v.nome = 'Informe nome e sobrenome';
    if (telefone.trim() && !validarTelefone(telefone)) v.telefone = 'Telefone inválido';
    if (email.trim() && !validarEmail(email)) v.email = 'E-mail inválido';
    return v;
  }, [nome, telefone, email]);

  // Already accepted (server ou local storage)
  if (status === 'ACEITO' || mode === 'aceito') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-[20px] border-2 border-emerald-200 bg-emerald-50">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <ThumbsUp className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-emerald-800">Recebemos sua confirmação</h3>
          <p className="text-emerald-700 mt-2 text-sm leading-relaxed max-w-md mx-auto">
            Nossa equipe continuará o atendimento com você em breve.
          </p>
          {aceite?.nome_aceite && (
            <p className="text-emerald-600 mt-3 text-xs">
              {aceite.nome_aceite} — {new Date(aceite.data_aceite).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {vendedorNome && (
            <p className="text-emerald-500 text-sm mt-3">
              {vendedorNome} {i18n.voltarContato}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'RECUSADO') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-[20px] border-2 border-red-200 bg-red-50">
          <h3 className="text-lg font-bold text-red-800">Proposta Recusada</h3>
        </div>
      </div>
    );
  }

  if (mode === 'alteracao_enviada') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center p-8 rounded-[20px] border-2 border-blue-200 bg-blue-50">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-blue-800">Recebemos sua solicitação de alteração</h3>
          <p className="text-blue-700 mt-2 text-sm leading-relaxed max-w-md mx-auto">
            Nossa equipe vai revisar as observações e retornar em breve.
          </p>
          {vendedorNome && (
            <p className="text-blue-500 text-sm mt-3">
              {vendedorNome} {i18n.voltarContato}
            </p>
          )}
        </div>
      </div>
    );
  }

  function validarSubmit(tipo: 'aceitar' | 'alteracao'): string {
    if (!nome.trim()) return 'Nome obrigatório';
    if (!validarNome(nome)) return 'Informe nome e sobrenome';
    if (!telefone.trim()) return 'Telefone obrigatório';
    if (!validarTelefone(telefone)) return 'Telefone inválido (10-15 dígitos)';
    if (!email.trim()) return 'E-mail obrigatório';
    if (!validarEmail(email)) return 'E-mail inválido';
    if (tipo === 'aceitar' && !termos) return 'Aceite os termos para continuar';
    if (tipo === 'alteracao' && !anotacao.trim()) return 'Descreva a alteração desejada';
    return '';
  }

  const handleAceitar = async () => {
    if (loading) return; // double-click guard
    const err = validarSubmit('aceitar');
    if (err) { setError(err); return; }

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
          request_id: requestIdRef.current.aceite,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      try { localStorage.setItem(localStorageKey(slug, 'aceite'), new Date().toISOString()); } catch { /* ignore */ }
      setMode('aceito');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro');
    }
    setLoading(false);
  };

  const handleAlteracao = async () => {
    if (loading) return;
    const err = validarSubmit('alteracao');
    if (err) { setError(err); return; }

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
          request_id: requestIdRef.current.alteracao,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      try { localStorage.setItem(localStorageKey(slug, 'alteracao'), new Date().toISOString()); } catch { /* ignore */ }
      setMode('alteracao_enviada');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro');
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

        {(mode === 'aceitar' || mode === 'alteracao') && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">
                {mode === 'aceitar' ? i18n.aceitarProposta : i18n.solicitarAlteracoes}
              </h4>
              <button
                onClick={() => { setMode('idle'); setError(''); }}
                className="text-gray-400 hover:text-gray-600"
                disabled={loading}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nome */}
            <div>
              <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                <User className="w-3.5 h-3.5" /> Nome completo *
              </label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Seu nome e sobrenome"
                autoComplete="name"
                disabled={loading}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-60 ${
                  validation.nome ? 'border-red-300' : 'border-gray-200'
                }`}
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
              {validation.nome && <p className="text-[11px] text-red-500 mt-1">{validation.nome}</p>}
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
                autoComplete="tel"
                disabled={loading}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-60 ${
                  validation.telefone ? 'border-red-300' : 'border-gray-200'
                }`}
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
              {validation.telefone && <p className="text-[11px] text-red-500 mt-1">{validation.telefone}</p>}
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
                autoComplete="email"
                disabled={loading}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-60 ${
                  validation.email ? 'border-red-300' : 'border-gray-200'
                }`}
                style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
              />
              {validation.email && <p className="text-[11px] text-red-500 mt-1">{validation.email}</p>}
            </div>

            {mode === 'alteracao' && (
              <div>
                <label className="text-sm text-gray-600 flex items-center gap-1.5 mb-1">
                  <FileText className="w-3.5 h-3.5" /> Descrição da alteração *
                </label>
                <textarea
                  value={anotacao}
                  onChange={e => setAnotacao(e.target.value)}
                  rows={4}
                  placeholder="Descreva o que você gostaria de mudar (datas, hotel, voos, valor, etc)"
                  disabled={loading}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-60"
                  style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                />
              </div>
            )}

            {mode === 'aceitar' && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termos}
                  onChange={e => setTermos(e.target.checked)}
                  disabled={loading}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300"
                />
                <span className="text-sm text-gray-600 leading-relaxed">
                  Li e concordo com os termos da proposta.
                </span>
              </label>
            )}

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <span className="font-bold shrink-0">!</span>
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={mode === 'aceitar' ? handleAceitar : handleAlteracao}
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-wait ${
                mode === 'aceitar' ? 'text-white' : 'border-2'
              }`}
              style={mode === 'aceitar'
                ? { backgroundColor: corPrimaria }
                : { borderColor: corPrimaria, color: corPrimaria }
              }
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</>
                : mode === 'aceitar'
                  ? <><CheckCircle className="w-4 h-4" /> Confirmar aceite</>
                  : <><Send className="w-4 h-4" /> Enviar solicitação</>
              }
            </button>

            <p className="text-[10px] text-gray-400 text-center leading-relaxed">
              Ao enviar, seus dados serão registrados pelo vendedor desta proposta para retorno do atendimento.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
