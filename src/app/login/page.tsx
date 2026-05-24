'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

// Layout split (esquerda: imagem promocional / direita: form dark)
// inspirado em https://mkt.enturos.com/login mas com identidade
// propria do Entur OS Financeiro (logo FIN + acento azul/cyan).

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Erro ao fazer login');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Erro de conexão. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] bg-black">
      {/* LADO ESQUERDO — Campanha visual. Background com gradient
          colorido + elementos decorativos. Suporta override via CSS var
          --login-bg-image (ex.: setado em /admin pra trocar a imagem
          de campanha sem deploy). */}
      <div
        className="relative hidden lg:flex flex-col justify-between p-10 overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at 20% 30%, #ec4899 0%, transparent 45%),
            radial-gradient(circle at 80% 70%, #f59e0b 0%, transparent 50%),
            radial-gradient(circle at 50% 100%, #8b5cf6 0%, transparent 55%),
            linear-gradient(135deg, #1e1b4b 0%, #581c87 40%, #831843 100%)
          `,
        }}
      >
        {/* Grain / texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.15] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' seed='3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          }}
        />

        {/* Hero text */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[10px] uppercase tracking-[0.18em] text-white/85 font-semibold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Entur OS Financeiro
          </div>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-[64px] sm:text-[80px] leading-[0.92] font-black text-white tracking-tight uppercase drop-shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            Propostas<br />
            que <span className="bg-gradient-to-r from-amber-200 via-rose-200 to-fuchsia-200 bg-clip-text text-transparent">fecham</span><br />
            viagens.
          </h1>
          <p className="mt-6 text-[15px] text-white/80 leading-relaxed max-w-sm">
            Editor premium + CRM + financeiro + IA — tudo integrado para sua agência escalar.
          </p>
        </div>

        {/* Footer da coluna visual */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-white/60">
          <span>© {new Date().getFullYear()} Entur OS</span>
          <span>fin.enturos.com</span>
        </div>

        {/* Decoração: passes / boarding pass abstratos */}
        <div className="absolute -right-10 top-20 w-72 h-44 rotate-[8deg] rounded-2xl bg-white/8 backdrop-blur-sm border border-white/12 shadow-2xl"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))' }}>
          <div className="p-4 flex flex-col h-full justify-between">
            <div className="flex items-center justify-between text-white/70 text-[9px] uppercase tracking-wider font-bold">
              <span>Boarding</span>
              <span>2026</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-white text-3xl font-black">GRU</div>
                <div className="text-white/60 text-[9px] uppercase tracking-wider">São Paulo</div>
              </div>
              <svg width="40" height="20" viewBox="0 0 40 20" className="text-white/80">
                <path d="M2 10 L36 10 M30 4 L38 10 L30 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              <div className="text-right">
                <div className="text-white text-3xl font-black">CDG</div>
                <div className="text-white/60 text-[9px] uppercase tracking-wider">Paris</div>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -left-16 bottom-40 w-56 h-36 -rotate-[12deg] rounded-2xl bg-white/6 backdrop-blur-sm border border-white/10 shadow-2xl"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))' }}>
          <div className="p-3 flex flex-col h-full justify-between">
            <div className="text-white/70 text-[8px] uppercase tracking-wider font-bold">Itinerário</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                <span className="text-white/80 text-[10px]">Day 1 · Tour panorâmico</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                <span className="text-white/80 text-[10px]">Day 2 · Vinícolas</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-300" />
                <span className="text-white/80 text-[10px]">Day 3 · City + Spa</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LADO DIREITO — Form dark */}
      <div className="flex items-center justify-center p-8 sm:p-12 bg-black">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex items-center gap-1 mb-12">
            <span className="text-[28px] font-black tracking-tight text-white lowercase">entur<span className="text-white">os</span></span>
            <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-md bg-blue-500 text-white text-[10px] font-bold tracking-widest uppercase">
              FIN
            </span>
          </div>

          {/* Form card */}
          <div className="rounded-2xl bg-zinc-950 border border-zinc-800/80 p-7">
            <h2 className="text-2xl font-bold text-white mb-1">Entrar</h2>
            <p className="text-sm text-zinc-400 mb-6">Acesse sua conta para continuar</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-400 mb-2">
                  E-mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  autoComplete="email"
                  autoFocus
                  className="w-full h-11 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500/60 transition-all"
                />
              </div>

              {/* Senha */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-400">
                    Senha
                  </label>
                  <button
                    type="button"
                    className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                    onClick={() => alert('Em breve: recuperação de senha. Por enquanto, contate o suporte.')}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full h-11 px-3 pr-11 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500/60 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 mt-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ boxShadow: '0 4px 14px rgba(59,130,246,0.35)' }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Entrando…
                  </>
                ) : (
                  'Entrar'
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-[13px] text-zinc-400">
            Sua agência ainda não tem acesso?{' '}
            <Link href="/signup" className="text-blue-400 font-semibold hover:text-blue-300 hover:underline">
              Criar conta grátis
            </Link>
          </div>

          <p className="mt-6 text-center text-[10px] text-zinc-600 leading-relaxed max-w-xs mx-auto">
            Ao entrar, você concorda com nossos Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
