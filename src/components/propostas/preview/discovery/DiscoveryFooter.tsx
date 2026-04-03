'use client';

import { useState } from 'react';
import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  proposta: Proposta;
  slug: string;
  idioma: IdiomaProposal;
}

export function DiscoveryFooter({ proposta, slug, idioma }: Props) {
  const i18n = t(idioma);
  const corPrimaria = proposta.visual.cor_primaria || '#004aad';
  const viagem = proposta.viagem;
  const rodape = proposta.rodape;

  const [leadForm, setLeadForm] = useState({ nome: '', email: '', telefone: '', mensagem: '' });
  const [leadSent, setLeadSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.nome || !leadForm.email) return;
    setSending(true);
    try {
      await fetch(`/api/propostas/public/${slug}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadForm),
      });
      setLeadSent(true);
    } catch {}
    setSending(false);
  };

  return (
    <footer id="discovery-footer">
      {/* Contact / Lead form */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 gap-10">
            {/* Consultant card */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                {i18n.entrarEmContato}
              </h3>
              {rodape.nome_vendedor && (
                <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
                  <p className="font-semibold text-gray-900">{rodape.nome_vendedor}</p>
                  {rodape.email_vendedor && (
                    <p className="text-sm text-gray-500 mt-1">{rodape.email_vendedor}</p>
                  )}
                  {rodape.whatsapp_vendedor && (
                    <a
                      href={`https://wa.me/${rodape.whatsapp_vendedor.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full text-white text-sm font-medium transition-all hover:scale-105"
                      style={{ backgroundColor: '#25D366' }}
                    >
                      WhatsApp
                    </a>
                  )}
                  {rodape.telefone_vendedor && (
                    <p className="text-sm text-gray-500 mt-2">{rodape.telefone_vendedor}</p>
                  )}
                </div>
              )}
            </div>

            {/* Lead form */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                {i18n.interesseViagem}
              </h3>
              {leadSent ? (
                <div className="bg-white rounded-xl p-6 border border-gray-100 text-center">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="font-semibold text-gray-900">{i18n.obrigadoLead}</p>
                  <p className="text-sm text-gray-500 mt-1">{i18n.retornoBreve}</p>
                </div>
              ) : (
                <form onSubmit={handleLeadSubmit} className="space-y-3">
                  <input
                    type="text"
                    value={leadForm.nome}
                    onChange={e => setLeadForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder={i18n.nomeLeadPlaceholder}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                  />
                  <input
                    type="email"
                    value={leadForm.email}
                    onChange={e => setLeadForm(f => ({ ...f, email: e.target.value }))}
                    placeholder={i18n.emailLeadPlaceholder}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                  />
                  <input
                    type="tel"
                    value={leadForm.telefone}
                    onChange={e => setLeadForm(f => ({ ...f, telefone: e.target.value }))}
                    placeholder={i18n.telefonePlaceholder}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                  />
                  <textarea
                    value={leadForm.mensagem}
                    onChange={e => setLeadForm(f => ({ ...f, mensagem: e.target.value }))}
                    placeholder={i18n.mensagemPlaceholder}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 resize-none focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': corPrimaria } as React.CSSProperties}
                  />
                  <button
                    type="submit"
                    disabled={sending}
                    className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all hover:scale-[1.02] disabled:opacity-50"
                    style={{ backgroundColor: corPrimaria }}
                  >
                    {sending ? '...' : i18n.enviarLead}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* About agency */}
      {viagem?.sobre_agencia && (
        <section className="py-12 bg-white">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{i18n.sobreAgencia}</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{viagem.sobre_agencia}</p>
          </div>
        </section>
      )}

      {/* Terms */}
      {viagem?.termos_condicoes && (
        <section className="py-12 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{i18n.termos}</h3>
            <div className="text-xs text-gray-500 leading-relaxed whitespace-pre-line">{viagem.termos_condicoes}</div>
          </div>
        </section>
      )}

      {/* Bottom bar */}
      <div className="py-8 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h3 className="text-lg font-bold mb-1">{proposta.cabecalho.titulo}</h3>
          {proposta.cabecalho.subtitulo && (
            <p className="text-gray-400 text-sm">{proposta.cabecalho.subtitulo}</p>
          )}
          {rodape.nome_vendedor && (
            <p className="mt-4 text-gray-400 text-sm">
              {i18n.conecteSe} {rodape.nome_vendedor}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
