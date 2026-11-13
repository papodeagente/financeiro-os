'use client';

import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { PlanejamentoIcon, MetasIcon, FinanceiroIcon } from '@/components/icons/PillarIcons';
import type { ComponentType } from 'react';

export type Pillar = 'planejamento' | 'metas' | 'financeiro' | 'configuracoes';

export interface PillarConfig {
  id: Pillar;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const PILLARS: PillarConfig[] = [
  { id: 'planejamento', label: 'Planejamento', icon: PlanejamentoIcon },
  { id: 'metas', label: 'Metas', icon: MetasIcon },
  { id: 'financeiro', label: 'Financeiro', icon: FinanceiroIcon },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];

// Order matters: more specific prefixes must come first
const ROUTE_MAP: [string, Pillar][] = [
  // Planejamento
  ['/cac', 'planejamento'],
  ['/planejamento', 'planejamento'],
  // Metas
  ['/dashboard', 'metas'],
  ['/equipe', 'metas'],
  // Catálogo e originação de venda saíram do menu (sistema focado no
  // financeiro). As telas continuam existindo e acessíveis por link direto —
  // apontam para o pilar Financeiro para a navegação seguir coerente.
  ['/grupos', 'financeiro'],
  ['/grupo/', 'financeiro'],
  ['/propostas', 'financeiro'],
  ['/vendas/orcamentos', 'financeiro'],
  ['/vendas/nova-orcamento', 'financeiro'],
  ['/vendas/nova', 'financeiro'],
  ['/voos', 'financeiro'],
  ['/hoteis', 'financeiro'],
  ['/destinos', 'financeiro'],
  // Financeiro
  ['/financeiro', 'financeiro'],
  ['/vendas', 'financeiro'],
  ['/pessoas', 'financeiro'],
  ['/relatorios', 'financeiro'],
  // Configurações
  ['/config', 'configuracoes'],
  ['/suporte', 'configuracoes'],
];

export function useActivePillar(): Pillar | null {
  const pathname = usePathname();

  if (!pathname || pathname === '/login' || pathname.startsWith('/p/')) {
    return null;
  }

  // Match most specific prefix first
  for (const [prefix, pillar] of ROUTE_MAP) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix)) {
      return pillar;
    }
  }

  // Default to metas (dashboard)
  return 'metas';
}
