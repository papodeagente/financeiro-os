'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function AdminNewTenantPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [nome, setNome] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [plano, setPlano] = useState('free')
  const [emailAdmin, setEmailAdmin] = useState('')
  const [senhaAdmin, setSenhaAdmin] = useState('')

  function handleNomeChange(value: string) {
    setNome(value)
    if (!slugManual) {
      setSlug(slugify(value))
    }
  }

  function handleSlugChange(value: string) {
    setSlugManual(true)
    setSlug(slugify(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          slug,
          cnpj: cnpj || null,
          plano,
          admin_email: emailAdmin,
          admin_password: senhaAdmin,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Erro ao criar agencia')
        return
      }

      router.push('/admin/tenants')
    } catch {
      setError('Erro ao conectar com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para Agencias
      </Link>

      <h1 className="text-2xl font-bold text-[var(--fin-text)] mb-6">Nova Agencia</h1>

      <form onSubmit={handleSubmit} className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-6 space-y-5">
        {error && (
          <div className="bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 text-[var(--fin-negative-text)] text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Nome da Agencia</label>
            <input
              type="text"
              value={nome}
              onChange={e => handleNomeChange(e.target.value)}
              required
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
              placeholder="Agencia Exemplo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={e => handleSlugChange(e.target.value)}
              required
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
              placeholder="agencia-exemplo"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">CNPJ</label>
            <input
              type="text"
              value={cnpj}
              onChange={e => setCnpj(e.target.value)}
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Plano</label>
            <select
              value={plano}
              onChange={e => setPlano(e.target.value)}
              className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)]"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>

        <div className="border-t border-[var(--fin-border)] pt-5">
          <h3 className="text-sm font-semibold text-[var(--fin-text-3)] mb-4">Administrador da Agencia</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Email do Admin</label>
              <input
                type="email"
                value={emailAdmin}
                onChange={e => setEmailAdmin(e.target.value)}
                required
                className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
                placeholder="admin@agencia.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Senha do Admin</label>
              <input
                type="password"
                value={senhaAdmin}
                onChange={e => setSenhaAdmin(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)] placeholder-[var(--fin-text-3)]"
                placeholder="Min. 6 caracteres"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] font-medium rounded-lg px-5 py-2.5 text-sm hover:bg-[var(--fin-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Criando...
              </>
            ) : (
              'Criar Agencia'
            )}
          </button>

          <Link
            href="/admin/tenants"
            className="text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] transition-colors px-3 py-2"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
