'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Loader2, ExternalLink } from 'lucide-react'

interface Tenant {
  id: string
  nome: string
  slug: string
  plano: string
  status: string
  user_count: number
  created_at: string
}

export default function AdminTenantsPage() {
  const router = useRouter()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchTenants()
  }, [])

  async function fetchTenants() {
    try {
      const res = await fetch('/api/admin/tenants')
      if (!res.ok) throw new Error('Falha ao carregar agencias')
      const data = await res.json()
      setTenants(data)
    } catch {
      setError('Erro ao carregar agencias')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[var(--fin-text-3)] animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 text-[var(--fin-negative-text)] rounded-xl p-4">
        {error}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--fin-text)]">Agencias</h1>
        <Link
          href="/admin/tenants/novo"
          className="bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] font-medium rounded-lg px-4 py-2 text-sm hover:bg-[var(--fin-accent-hover)] transition-colors inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nova Agencia
        </Link>
      </div>

      <div className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--fin-border)]">
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Nome</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Slug</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Plano</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Usuarios</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Criado em</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length > 0 ? (
                tenants.map(tenant => (
                  <tr key={tenant.id} className="border-b border-[var(--fin-border)] last:border-0 hover:bg-[var(--fin-text)]/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-[var(--fin-text)] font-medium">{tenant.nome}</td>
                    <td className="px-5 py-3 text-sm text-[var(--fin-text-3)] font-mono">{tenant.slug}</td>
                    <td className="px-5 py-3">
                      <PlanBadge plano={tenant.plano} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--fin-text-3)]">{tenant.user_count}</td>
                    <td className="px-5 py-3 text-sm text-[var(--fin-text-3)]">
                      {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="text-[var(--fin-accent)] hover:text-[var(--fin-accent)] text-sm inline-flex items-center gap-1 transition-colors"
                      >
                        Ver <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-[var(--fin-text-3)]">
                    Nenhuma agencia cadastrada
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
