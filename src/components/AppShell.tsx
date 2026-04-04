'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar } from '@/hooks/useActivePillar';
import { TopRail } from './TopRail';
import { PillarSidebar } from './PillarSidebar';
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
  '/vendas/orcamentos': 'Orcamentos',
  '/voos': 'Buscar voos',
  '/hoteis': 'Buscar hoteis',
  '/destinos': 'Destinos',
  '/financeiro-ag': 'Visao geral',
  '/financeiro-ag/fluxo-caixa': 'Fluxo de caixa',
  '/financeiro-ag/dre': 'DRE',
  '/financeiro-ag/conciliacao': 'Conciliacao',
  '/financeiro-ag/receber': 'Contas a receber',
  '/financeiro-ag/pagar': 'Contas a pagar',
  '/financeiro-ag/plano-contas': 'Plano de contas',
  '/financeiro-ag/contas-bancarias': 'Contas bancarias',
  '/financeiro-ag/transferencias': 'Transferencias',
  '/financeiro-grupos': 'Financeiro por grupo',
  '/pessoas/clientes': 'Clientes',
  '/pessoas/fornecedores': 'Fornecedores',
  '/pessoas/equipe': 'Equipe',
  '/equipe/metas': 'Metas da equipe',
  '/equipe/comissoes': 'Comissoes',
  '/equipe/planos-comissao': 'Planos de comissao',
  '/cac/dashboard': 'Dashboard CAC',
  '/cac/cenarios': 'Simulador CAC',
  '/planejamento/custos': 'Custos do negocio',
  '/planejamento/projetos': 'Projetos comerciais',
  '/relatorios/financeiro': 'Relatorios financeiros',
  '/relatorios/rentabilidade': 'Rentabilidade',
  '/relatorios/comparativo': 'Comparativo mensal',
  '/config/agencia': 'Configuracoes',
  '/config/usuarios': 'Usuarios',
  '/config/crm': 'Integracao CRM',
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
  const showBreadcrumb = breadcrumbLabel && pillarLabel && pathname.includes('/');

  return (
    <div className="flex flex-col h-full">
      <TopRail onCommandPalette={() => setCommandPaletteOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <PillarSidebar />
        <div className="flex-1 overflow-y-auto">
          {showBreadcrumb && (
            <div className="px-6 pt-4 pb-0">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
                {pillarLabel} <span className="mx-1">›</span> {breadcrumbLabel}
              </p>
            </div>
          )}
          {children}
        </div>
      </div>
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
