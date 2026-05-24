'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Check, Loader2 } from 'lucide-react';

interface Plano {
  slug: string;
  nome: string;
  descricao: string;
  preco_mensal: number;
  destaque: boolean;
  features: string[];
}

function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function SignupClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [planoSlug, setPlanoSlug] = useState(sp.get('plano') || '');
  const [nomeAgencia, setNomeAgencia] = useState('');
  const [nomeCompleto, setNomeCompleto] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/planos').then(r => r.json()).then((data: Plano[]) => {
      if (Array.isArray(data)) {
        setPlanos(data);
        if (!planoSlug) {
          const destaque = data.find(p => p.destaque);
          setPlanoSlug(destaque?.slug || data[0]?.slug || 'basic');
        }
      }
    }).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planoSelecionado = planos.find(p => p.slug === planoSlug);

  function validar(): string {
    if (!nomeAgencia.trim()) return 'Informe o nome da agência';
    if (!nomeCompleto.trim() || !/\s/.test(nomeCompleto.trim())) return 'Informe seu nome completo (nome + sobrenome)';
    if (!email.trim() || !validarEmail(email)) return 'E-mail inválido';
    if (senha.length < 8) return 'Senha deve ter pelo menos 8 caracteres';
    if (!planoSlug) return 'Selecione um plano';
    return '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const err = validar();
    if (err) { setError(err); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_agencia: nomeAgencia.trim(),
          nome_completo: nomeCompleto.trim(),
          email: email.trim().toLowerCase(),
          telefone: telefone.trim(),
          senha,
          plano_slug: planoSlug,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');
      // Cookie de sessao ja foi setado pelo server — redireciona pro dashboard
      router.push(data.redirect || '/dashboard');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top */}
      <div className="max-w-6xl mx-auto px-6 w-full pt-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> Voltar à página inicial
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Form */}
          <div className="p-8 sm:p-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-slate-900">Entur OS</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Crie sua conta</h1>
            <p className="text-sm text-slate-600 mb-6">14 dias grátis · sem cartão de crédito</p>

            <form onSubmit={submit} className="space-y-3">
              <Field label="Nome da agência *">
                <input
                  type="text" value={nomeAgencia} onChange={e => setNomeAgencia(e.target.value)}
                  placeholder="Ex: Viagens Mundo Aberto"
                  className="input"
                />
              </Field>
              <Field label="Seu nome completo *">
                <input
                  type="text" value={nomeCompleto} onChange={e => setNomeCompleto(e.target.value)}
                  placeholder="Nome + sobrenome" autoComplete="name"
                  className="input"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="E-mail *">
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="voce@agencia.com.br" autoComplete="email"
                    className="input"
                  />
                </Field>
                <Field label="WhatsApp">
                  <input
                    type="tel" value={telefone} onChange={e => setTelefone(e.target.value)}
                    placeholder="(11) 99999-9999" autoComplete="tel"
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Senha * (mín. 8 caracteres)">
                <input
                  type="password" value={senha} onChange={e => setSenha(e.target.value)}
                  autoComplete="new-password" minLength={8}
                  className="input"
                />
              </Field>

              {/* Seletor de plano (chips) */}
              <Field label="Plano">
                <div className="grid grid-cols-3 gap-2">
                  {planos.map(p => {
                    const ativo = planoSlug === p.slug;
                    return (
                      <button
                        type="button"
                        key={p.slug}
                        onClick={() => setPlanoSlug(p.slug)}
                        className={`relative p-2 rounded-lg border-2 text-left transition-all ${
                          ativo
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        {p.destaque && (
                          <div className="absolute -top-2 right-2 px-1.5 py-0.5 rounded-full bg-blue-600 text-[8px] font-bold text-white uppercase">
                            Popular
                          </div>
                        )}
                        <div className="text-xs font-bold text-slate-900">{p.nome}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          R$ {Number(p.preco_mensal).toLocaleString('pt-BR')}/mês
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full py-3 mt-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Criar conta grátis
              </button>

              <p className="text-[11px] text-slate-500 text-center">
                Ao criar a conta, você concorda com nossos termos. Após 14 dias, entraremos em contato para ativar o plano escolhido.
              </p>

              <div className="text-center pt-2 text-sm text-slate-600">
                Já tem conta? <Link href="/login" className="font-semibold text-slate-900 hover:underline">Entrar</Link>
              </div>
            </form>
          </div>

          {/* Resumo do plano à direita */}
          <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-8 sm:p-10 text-white hidden lg:flex flex-col">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-bold mb-2">Plano selecionado</div>
            {planoSelecionado ? (
              <>
                <div className="text-3xl font-bold">{planoSelecionado.nome}</div>
                <div className="mt-2 text-slate-300 text-sm">{planoSelecionado.descricao}</div>
                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold">R$ {Number(planoSelecionado.preco_mensal).toLocaleString('pt-BR')}</span>
                  <span className="text-slate-400 text-sm">/mês</span>
                </div>
                <p className="text-xs text-blue-300 mt-1">grátis nos primeiros 14 dias</p>

                <div className="mt-8 space-y-2.5 flex-1">
                  {(planoSelecionado.features || []).map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" strokeWidth={2.5} />
                      <span className="text-slate-200">{f}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-slate-400 text-sm">Carregando plano…</div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.6rem 0.9rem;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 0.6rem;
          font-size: 0.875rem;
          color: #0f172a;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
