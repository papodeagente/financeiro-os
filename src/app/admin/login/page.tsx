'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Loader2 } from 'lucide-react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Credenciais invalidas')
        return
      }

      router.push('/admin/dashboard')
    } catch {
      setError('Erro ao conectar com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--fin-bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[var(--fin-surface)] border border-[var(--fin-border)] mb-4">
            <Shield className="w-7 h-7 text-[var(--fin-accent)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--fin-text)]">Entur OS Admin</h1>
          <p className="text-[var(--fin-text-3)] text-sm mt-1">Painel de administracao</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 text-[var(--fin-negative-text)] text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
              placeholder="admin@entur.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] font-medium rounded-lg px-4 py-2.5 text-sm hover:bg-[var(--fin-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
    </div>
  )
}
