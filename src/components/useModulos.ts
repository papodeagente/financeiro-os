'use client';

import { useAuth } from '@/contexts/AuthContext';
import { SEM_MODULOS, moduloLigado, type ModuloId, type ModulosDaConta } from '@/lib/modulos';

/**
 * Versão e módulos da agência na tela. Só decide o que MOSTRAR: a rota do
 * módulo confere de novo no servidor (modulos-servidor.ts).
 */
export function useModulos(): ModulosDaConta & { carregando: boolean; tem: (id: ModuloId) => boolean } {
  const { user, loading } = useAuth();
  const m = user?.tenantModulos ?? SEM_MODULOS;
  return { ...m, carregando: loading, tem: (id: ModuloId) => moduloLigado(m, id) };
}
