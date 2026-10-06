'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Building2, LogOut, Shield, Sparkles, Image as ImageIcon, Link as LinkIcon, MessageSquare } from 'lucide-react'

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/tenants', label: 'Agencias', icon: Building2 },
  { href: '/admin/planos', label: 'Planos', icon: Sparkles },
  { href: '/admin/convites', label: 'Convites', icon: LinkIcon },
  { href: '/admin/marketing', label: 'Marketing', icon: ImageIcon },
  { href: '/admin/support', label: 'Suporte', icon: MessageSquare },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) return
    fetch('/api/admin/auth/session')
      .then(res => {
        if (!res.ok) {
          setAuthenticated(false)
          router.push('/admin/login')
        } else {
          setAuthenticated(true)
        }
      })
      .catch(() => {
        setAuthenticated(false)
        router.push('/admin/login')
      })
  }, [router, isLoginPage])

  async function handleLogout() {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' })
    } catch {}
    router.push('/admin/login')
  }

  // Login page has its own layout — just render children
  if (isLoginPage) {
    return <>{children}</>
  }

  if (authenticated === null || !authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--fin-bg)]">
        <p className="fin-t-body text-[var(--fin-text-3)]">{authenticated === null ? 'Carregando...' : 'Redirecionando...'}</p>
      </div>
    )
  }

  // Super Admin usa a MESMA base do app (barra branca, item ativo em azul
  // suave, tokens --fin-*). O contexto administrativo fica marcado pelo selo
  // violeta no topo: é ali que a pessoa sabe que está fora da própria agência.
  const marca = (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]">
        <Shield className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="fin-t-body-strong truncate text-[var(--fin-text)]">Entur OS</span>
        <span className="fin-t-caption font-medium text-[var(--fin-violet)]">Super Admin</span>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-[var(--fin-bg)] text-[var(--fin-text)] md:flex-row">
      {/* Celular: barra superior com a navegação rolável no lugar da lateral fixa */}
      <header className="sticky top-0 z-[var(--fin-z-cabecalho)] border-b border-[var(--fin-border)] bg-[var(--fin-surface)] md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          {marca}
          <button
            onClick={handleLogout}
            aria-label="Sair do Super Admin"
            className="grid size-11 place-items-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-negative-text)]"
          >
            <LogOut className="size-5" />
          </button>
        </div>
        <nav aria-label="Super Admin" className="flex gap-1 overflow-x-auto px-3 pb-2">
          {navItems.map(item => {
            const ativo = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={`fin-t-body inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--fin-r-md)] px-3 ${
                  ativo ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]' : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]'
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {/* Desktop: barra lateral branca, igual à do app */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--fin-border)] bg-[var(--fin-surface)] md:flex">
        <div className="border-b border-[var(--fin-border)] px-4 py-4">{marca}</div>
        <nav aria-label="Super Admin" className="flex-1 space-y-px px-3 py-3">
          {navItems.map(item => {
            const ativo = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={`fin-t-body flex h-10 items-center gap-3 rounded-[var(--fin-r-md)] px-3 transition-colors duration-[var(--fin-dur-rapida)] ${
                  ativo
                    ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
                    : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]'
                }`}
              >
                <item.icon className="size-[18px] shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-[var(--fin-border)] px-3 py-2">
          <button
            onClick={handleLogout}
            className="fin-t-body flex h-10 w-full items-center gap-3 rounded-[var(--fin-r-md)] px-3 text-[var(--fin-text-3)] transition-colors hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-negative-text)]"
          >
            <LogOut className="size-[18px]" />
            Sair
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
        <div className="mx-auto w-full max-w-[var(--fin-page-max)]">{children}</div>
      </main>
    </div>
  )
}
