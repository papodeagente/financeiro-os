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
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4">
        {error}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Agencias</h1>
        <Link
          href="/admin/tenants/novo"
          className="bg-[#d4a853] text-gray-950 font-medium rounded-lg px-4 py-2 text-sm hover:bg-[#c49a48] transition-colors inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nova Agencia
        </Link>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Nome</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Slug</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Plano</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Usuarios</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Criado em</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length > 0 ? (
                tenants.map(tenant => (
                  <tr key={tenant.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-gray-100 font-medium">{tenant.nome}</td>
                    <td className="px-5 py-3 text-sm text-gray-400 font-mono">{tenant.slug}</td>
                    <td className="px-5 py-3">
                      <PlanBadge plano={tenant.plano} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-400">{tenant.user_count}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">
                      {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="text-[#d4a853] hover:text-[#e0b864] text-sm inline-flex items-center gap-1 transition-colors"
                      >
                        Ver <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-500">
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
    ativo: 'bg-green-500/15 text-green-400',
    suspenso: 'bg-red-500/15 text-red-400',
    trial: 'bg-yellow-500/15 text-yellow-400',
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  )
}

function PlanBadge({ plano }: { plano: string }) {
  const styles: Record<string, string> = {
    free: 'bg-gray-700/50 text-gray-300',
    pro: 'bg-blue-500/15 text-blue-400',
    enterprise: 'bg-[#d4a853]/15 text-[#d4a853]',
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[plano] || 'bg-gray-700 text-gray-300'}`}>
      {plano}
    </span>
  )
}
