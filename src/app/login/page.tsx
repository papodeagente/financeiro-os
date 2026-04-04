'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

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

      // Success — redirect to dashboard
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Erro de conexao. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--t-bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--t-green)] flex items-center justify-center">
              <span className="text-white font-bold text-xl dark:text-[#0a0a14]">E</span>
            </div>
            <div className="text-left">
              <div className="text-xl font-bold text-[var(--t-text)] tracking-tight">
                Entur <span className="text-[var(--t-green)]">OS</span>
              </div>
              <div className="text-xs text-[var(--t-text-secondary)] -mt-0.5">Financeiro</div>
            </div>
          </div>
          <p className="text-sm text-[var(--t-text-secondary)]">
            Acesse sua conta para continuar
          </p>
        </div>

        {/* Form */}
        <div className="bg-[var(--t-surface)] rounded-[20px] shadow-[var(--t-card-shadow)] p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide font-medium">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  autoComplete="email"
                  autoFocus
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] text-sm placeholder:text-[var(--t-text-muted)] focus:outline-none focus:border-[var(--t-green)] transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide font-medium">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Sua senha"
                  required
                  autoComplete="current-password"
                  className="w-full h-11 pl-10 pr-11 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] text-sm placeholder:text-[var(--t-text-muted)] focus:outline-none focus:border-[var(--t-green)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
              style={{ boxShadow: '0 4px 15px var(--t-green-shadow)' }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-[var(--t-text-muted)]">
          Entur OS Financeiro &middot; Acesso restrito
        </div>
      </div>
    </div>
  );
}
