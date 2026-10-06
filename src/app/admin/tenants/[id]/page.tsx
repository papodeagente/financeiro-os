'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Users, Layers, DollarSign, UserCheck, Pause, Play, Save } from 'lucide-react'
import { toast } from '@/lib/toast'

interface TenantDetail {
  id: string
  nome: string
  slug: string
  cnpj: string | null
  plano: string
  status: string
  created_at: string
  stats: {
    usuarios: number
    grupos: number
    vendas: number
  }
}

export default function AdminTenantDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Edit form state
  const [editNome, setEditNome] = useState('')
  const [editPlano, setEditPlano] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // Action states
  const [actionLoading, setActionLoading] = useState('')

  useEffect(() => {
    fetchTenant()
  }, [id])

  async function fetchTenant() {
    try {
      const res = await fetch(`/api/admin/tenants/${id}`)
      if (!res.ok) throw new Error('Falha ao carregar agencia')
      const data = await res.json()
      setTenant(data)
      setEditNome(data.nome)
      setEditPlano(data.plano)
    } catch {
      setError('Erro ao carregar agencia')
    } finally {
      setLoading(false)
    }
  }

  async function handleImpersonate() {
    setActionLoading('impersonate')
    try {
      const res = await fetch(`/api/admin/tenants/${id}/impersonate`, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao impersonar')
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      toast.error('Erro ao impersonar agência')
    } finally {
      setActionLoading('')
    }
  }

  async function handleSuspend() {
    if (!confirm('Tem certeza que deseja suspender esta agencia?')) return
    setActionLoading('suspend')
    try {
      const res = await fetch(`/api/admin/tenants/${id}/suspend`, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao suspender')
      await fetchTenant()
    } catch {
      toast.error('Erro ao suspender agência')
    } finally {
      setActionLoading('')
    }
  }

  async function handleReactivate() {
    setActionLoading('reactivate')
    try {
      const res = await fetch(`/api/admin/tenants/${id}/reactivate`, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao reativar')
      await fetchTenant()
    } catch {
      toast.error('Erro ao reativar agência')
    } finally {
      setActionLoading('')
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMessage('')
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: editNome, plano: editPlano }),
      })
      if (!res.ok) throw new Error('Falha ao salvar')
      setSaveMessage('Salvo com sucesso')
      await fetchTenant()
      setTimeout(() => setSaveMessage(''), 3000)
    } catch {
      setSaveMessage('Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[var(--fin-text-3)] animate-spin" />
      </div>
    )
  }

  if (error || !tenant) {
    return (
      <div className="bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 text-[var(--fin-negative-text)] rounded-xl p-4">
        {error || 'Agencia nao encontrada'}
      </div>
    )
  }

  const statCards = [
    { label: 'Usuarios', value: tenant.stats.usuarios, icon: Users, color: 'text-[var(--fin-accent)]' },
    { label: 'Grupos', value: tenant.stats.grupos, icon: Layers, color: 'text-[var(--fin-violet)]' },
    { label: 'Vendas', value: tenant.stats.vendas, icon: DollarSign, color: 'text-[var(--fin-positive)]' },
  ]

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para Agencias
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fin-text)]">{tenant.nome}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm text-[var(--fin-text-3)] font-mono">{tenant.slug}</span>
            <StatusBadge status={tenant.status} />
            <PlanBadge plano={tenant.plano} />
          </div>
          {tenant.cnpj && (
            <p className="text-sm text-[var(--fin-text-3)] mt-1">CNPJ: {tenant.cnpj}</p>
          )}
          <p className="text-sm text-[var(--fin-text-3)] mt-0.5">
            Criado em {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {statCards.map(card => (
          <div key={card.label} className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[var(--fin-text-3)]">{card.label}</span>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-3xl font-bold text-[var(--fin-text)]">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-[var(--fin-text)] mb-4">Ações</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleImpersonate}
            disabled={!!actionLoading}
            className="bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] font-medium rounded-lg px-4 py-2 text-sm hover:bg-[var(--fin-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {actionLoading === 'impersonate' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserCheck className="w-4 h-4" />
            )}
            Impersonar
          </button>

          {tenant.status === 'ativo' || tenant.status === 'trial' ? (
            <button
              onClick={handleSuspend}
              disabled={!!actionLoading}
              className="bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] border border-[var(--fin-negative)]/30 font-medium rounded-lg px-4 py-2 text-sm hover:bg-[var(--fin-negative)]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {actionLoading === 'suspend' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
              Suspender
            </button>
          ) : (
            <button
              onClick={handleReactivate}
              disabled={!!actionLoading}
              className="bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] border border-[var(--fin-positive)]/30 font-medium rounded-lg px-4 py-2 text-sm hover:bg-[var(--fin-positive)]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {actionLoading === 'reactivate' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Reativar
            </button>
          )}
        </div>
      </div>

      {/* Edit Form */}
      <div className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[var(--fin-text)] mb-4">Editar Agencia</h2>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Nome</label>
              <input
                type="text"
                value={editNome}
                onChange={e => setEditNome(e.target.value)}
                required
                className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--fin-text-3)] mb-1.5">Plano</label>
              <select
                value={editPlano}
                onChange={e => setEditPlano(e.target.value)}
                className="w-full bg-[var(--fin-surface)] border border-[var(--fin-border)] text-[var(--fin-text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/50 focus:border-[var(--fin-accent)]"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] font-medium rounded-lg px-5 py-2.5 text-sm hover:bg-[var(--fin-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Salvar
            </button>

            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('Erro') ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-positive)]'}`}>
                {saveMessage}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ativo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
    suspenso: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
    trial: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-[var(--fin-surface)] text-[var(--fin-text-3)]'}`}>
      {status}
    </span>
  )
}

function PlanBadge({ plano }: { plano: string }) {
  const styles: Record<string, string> = {
    free: 'bg-[var(--fin-text)]/50 text-[var(--fin-text-3)]',
    pro: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
    enterprise: 'bg-[var(--fin-accent)]/15 text-[var(--fin-accent)]',
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[plano] || 'bg-[var(--fin-surface)] text-[var(--fin-text-3)]'}`}>
      {plano}
    </span>
  )
}
