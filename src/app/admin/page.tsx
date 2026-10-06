'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/dashboard')
  }, [router])

  return (
    <div className="min-h-screen bg-[var(--fin-surface)] flex items-center justify-center">
      <p className="text-[var(--fin-text-3)]">Redirecionando...</p>
    </div>
  )
}
