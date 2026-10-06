'use client'

import { useEffect, useState } from 'react'
import { Building2, Users, Activity, CreditCard, Loader2 } from 'lucide-react'

interface Metrics {
  totalTenants: number
  activeTenants: number
  totalUsers: number
  totalPlans: number
  recentTenants: {
    id: string
    nome: string
    slug: string
    plano: string
    status: string
    created_at: string
  }[]
}

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMetrics()
  }, [])

  async function fetchMetrics() {
    try {
      const res = await fetch('/api/admin/metrics')
      if (!res.ok) throw new Error('Falha ao carregar metricas')
      const data = await res.json()
      setMetrics(data)
    } catch (err) {
      setError('Erro ao carregar metricas')
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

  const cards = [
    { label: 'Total Agencias', value: metrics?.totalTenants ?? 0, icon: Building2, color: 'text-[var(--fin-accent)]' },
    { label: 'Agencias Ativas', value: metrics?.activeTenants ?? 0, icon: Activity, color: 'text-[var(--fin-positive)]' },
    { label: 'Total Usuarios', value: metrics?.totalUsers ?? 0, icon: Users, color: 'text-[var(--fin-violet)]' },
    { label: 'Planos', value: metrics?.totalPlans ?? 0, icon: CreditCard, color: 'text-[var(--fin-accent)]' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--fin-text)] mb-6">Dashboard</h1>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(card => (
          <div
            key={card.label}
            className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[var(--fin-text-3)]">{card.label}</span>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-3xl font-bold text-[var(--fin-text)]">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recent Tenants */}
      <div className="bg-[var(--fin-surface)] border border-[var(--fin-border)] rounded-xl">
        <div className="px-5 py-4 border-b border-[var(--fin-border)]">
          <h2 className="text-lg font-semibold text-[var(--fin-text)]">Agencias Recentes</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--fin-border)]">
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Nome</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Slug</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Plano</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-[var(--fin-text-3)] uppercase tracking-wider px-5 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {metrics?.recentTenants && metrics.recentTenants.length > 0 ? (
                metrics.recentTenants.map(tenant => (
                  <tr key={tenant.id} className="border-b border-[var(--fin-border)] last:border-0">
                    <td className="px-5 py-3 text-sm text-[var(--fin-text)]">{tenant.nome}</td>
                    <td className="px-5 py-3 text-sm text-[var(--fin-text-3)] font-mono">{tenant.slug}</td>
                    <td className="px-5 py-3">
                      <PlanBadge plano={tenant.plano} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--fin-text-3)]">
                      {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-[var(--fin-text-3)]">
                    Nenhuma agencia encontrada
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
