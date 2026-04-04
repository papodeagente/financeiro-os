'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar } from '@/hooks/useActivePillar';
import { PillarRail } from './PillarRail';
import { FeaturePanel } from './FeaturePanel';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { useState, useEffect, useCallback } from 'react';

const BREADCRUMB_MAP: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/grupos': 'Grupos',
  '/propostas': 'Propostas',
  '/propostas/nova': 'Nova proposta',
  '/propostas/analytics': 'Analytics',
  '/vendas': 'Vendas fechadas',
  '/vendas/nova': 'Nova venda',
  '/vendas/orcamentos': 'Orçamentos',
  '/voos': 'Buscar voos',
  '/hoteis': 'Buscar hotéis',
  '/destinos': 'Destinos',
  '/financeiro-ag': 'Visão geral',
  '/financeiro-ag/fluxo-caixa': 'Fluxo de caixa',
  '/financeiro-ag/dre': 'DRE',
  '/financeiro-ag/conciliacao': 'Conciliação',
  '/financeiro-ag/receber': 'Contas a receber',
  '/financeiro-ag/pagar': 'Contas a pagar',
  '/financeiro-ag/plano-contas': 'Plano de contas',
  '/financeiro-ag/contas-bancarias': 'Contas bancárias',
  '/financeiro-ag/transferencias': 'Transferências',
  '/financeiro-grupos': 'Financeiro por grupo',
  '/pessoas/clientes': 'Clientes',
  '/pessoas/fornecedores': 'Fornecedores',
  '/pessoas/equipe': 'Equipe',
  '/equipe/metas': 'Metas da equipe',
  '/equipe/comissoes': 'Comissões',
  '/equipe/planos-comissao': 'Planos de comissão',
  '/cac/dashboard': 'Dashboard CAC',
  '/cac/cenarios': 'Simulador CAC',
  '/planejamento/custos': 'Custos do negócio',
  '/planejamento/projetos': 'Projetos comerciais',
  '/relatorios/financeiro': 'Relatórios financeiros',
  '/relatorios/rentabilidade': 'Rentabilidade',
  '/relatorios/comparativo': 'Comparativo mensal',
  '/config/agencia': 'Configurações',
  '/config/usuarios': 'Usuários',
  '/config/crm': 'Integração CRM',
};

const PILLAR_LABELS: Record<string, string> = {
  planejamento: 'Planejamento',
  metas: 'Metas',
  produtos: 'Produtos',
  financeiro: 'Financeiro',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const activePillar = useActivePillar();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Track recent pages
  useEffect(() => {
    if (pathname && pathname !== '/login' && !pathname.startsWith('/p/')) {
      try {
        const key = 'entur:recentes';
        const stored = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const filtered = stored.filter(p => p !== pathname);
        filtered.unshift(pathname);
        localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
      } catch { /* ignore */ }
    }
  }, [pathname]);

  // Login page and public proposal preview — no shell
  if (pathname === '/login' || pathname.startsWith('/p/')) {
    return <>{children}</>;
  }

  // Loading session
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Build breadcrumb
  const breadcrumbLabel = BREADCRUMB_MAP[pathname];
  const pillarLabel = activePillar ? PILLAR_LABELS[activePillar] : null;
  const breadcrumbNode = breadcrumbLabel && pillarLabel ? (
    <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)]">
      <span className="text-[var(--t-text-secondary)] font-medium">{pillarLabel}</span>
      <span className="mx-1.5 text-[var(--t-text-muted)]">›</span>
      <span>{breadcrumbLabel}</span>
    </p>
  ) : undefined;

  return (
    <div className="flex h-full">
      {/* Column 1: Pillar Rail (72px) */}
      <PillarRail />

      {/* Column 2: Feature Panel (240px) */}
      <FeaturePanel />

      {/* Column 3: Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <TopBar
          onCommandPalette={() => setCommandPaletteOpen(true)}
          breadcrumb={breadcrumbNode}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-[var(--t-bg)]">
          {children}
        </main>
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
