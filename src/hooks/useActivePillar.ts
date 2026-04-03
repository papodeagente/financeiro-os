'use client';

import { usePathname } from 'next/navigation';
import {
  Calculator, Target, Package, DollarSign,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type Pillar = 'planejamento' | 'metas' | 'produtos' | 'financeiro';

export interface PillarConfig {
  id: Pillar;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const PILLARS: PillarConfig[] = [
  { id: 'planejamento', label: 'Planejamento', icon: Calculator },
  { id: 'metas', label: 'Metas', icon: Target },
  { id: 'produtos', label: 'Produtos', icon: Package },
  { id: 'financeiro', label: 'Financeiro', icon: DollarSign },
];

const ROUTE_MAP: [string, Pillar][] = [
  // Planejamento
  ['/cac', 'planejamento'],
  ['/planejamento', 'planejamento'],
  // Metas
  ['/dashboard', 'metas'],
  ['/equipe', 'metas'],
  // Produtos
  ['/grupos', 'produtos'],
  ['/grupo/', 'produtos'],
  ['/propostas', 'produtos'],
  ['/vendas/orcamentos', 'produtos'],
  ['/vendas/nova-orcamento', 'produtos'],
  ['/voos', 'produtos'],
  ['/hoteis', 'produtos'],
  ['/destinos', 'produtos'],
  // Financeiro
  ['/financeiro', 'financeiro'],
  ['/vendas', 'financeiro'],
  ['/pessoas', 'financeiro'],
  ['/relatorios', 'financeiro'],
];

export function useActivePillar(): Pillar | null {
  const pathname = usePathname();

  if (!pathname || pathname === '/login' || pathname.startsWith('/p/') || pathname.startsWith('/config')) {
    return null;
  }

  // /vendas/orcamentos must match 'produtos' before /vendas matches 'financeiro'
  for (const [prefix, pillar] of ROUTE_MAP) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix)) {
      return pillar;
    }
  }

  // Default to metas (dashboard)
  return 'metas';
}
