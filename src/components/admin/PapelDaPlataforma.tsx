'use client'

import { createContext, useContext } from 'react'
import type { PapelDaPlataforma } from '@/lib/plataforma'

/** O papel de quem está no painel /admin, dado pelo layout (ver src/lib/plataforma.ts). */
export const PapelDaPlataformaContext = createContext<PapelDaPlataforma | null>(null)

/** true quando a tela deve mostrar as ações que só o super admin faz. */
export function useEhSuperAdmin(): boolean {
  return useContext(PapelDaPlataformaContext) === 'SUPER_ADMIN'
}
