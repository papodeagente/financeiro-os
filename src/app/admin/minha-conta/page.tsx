'use client'

/**
 * Minha conta, para quem é da plataforma (super admin ou CS): trocar a senha
 * provisória ou a de sempre. Ao trocar, todas as sessões caem, esta também.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SENHA_MINIMA_DA_PLATAFORMA } from '@/lib/plataforma'

export default function MinhaContaDaPlataformaPage() {
  const router = useRouter()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (nova !== confirmacao) { setErro('A confirmação não bate com a senha nova.'); return }
    setSalvando(true)
    try {
      const r = await fetch('/api/admin/auth/senha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: atual, senha_nova: nova }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Não foi possível trocar a senha.')
      router.push('/admin/login?senha=trocada')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível trocar a senha.')
      setSalvando(false)
    }
  }

  const campo = 'w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 text-sm text-[var(--fin-text)] focus:border-[var(--fin-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/40'

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold text-[var(--fin-text)]">Minha conta</h1>
      <p className="mt-1 text-sm text-[var(--fin-text-2)]">
        Troque a senha que você recebeu ou a que usa hoje. Depois de trocar, você entra de novo com a senha nova e o código do autenticador.
      </p>
      <form onSubmit={salvar} className="mt-6 space-y-4 rounded-xl border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5">
        <div>
          <label htmlFor="senha-atual" className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">Senha atual</label>
          <input id="senha-atual" type="password" className={campo} value={atual} onChange={e => setAtual(e.target.value)} required autoComplete="current-password" />
        </div>
        <div>
          <label htmlFor="senha-nova" className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">Senha nova</label>
          <input id="senha-nova" type="password" className={campo} value={nova} onChange={e => setNova(e.target.value)} required minLength={SENHA_MINIMA_DA_PLATAFORMA} autoComplete="new-password" />
          <p className="mt-1 text-xs text-[var(--fin-text-3)]">Ao menos {SENHA_MINIMA_DA_PLATAFORMA} caracteres.</p>
        </div>
        <div>
          <label htmlFor="senha-confirmacao" className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">Repita a senha nova</label>
          <input id="senha-confirmacao" type="password" className={campo} value={confirmacao} onChange={e => setConfirmacao(e.target.value)} required autoComplete="new-password" />
        </div>
        {erro ? <p role="alert" className="text-sm text-[var(--fin-negative-text)]">{erro}</p> : null}
        <Button type="submit" disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : null} Trocar senha
        </Button>
      </form>
    </div>
  )
}
