'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, type Pillar } from '@/hooks/useActivePillar';
import {
  // Planejamento
  Wallet, FolderKanban, Gauge, TrendingUp,
  // Metas
  LayoutDashboard, Medal, Percent, Settings,
  // Produtos
  FolderOpen, Plus, FileText, BarChart3,
  Plane, Hotel, Globe,
  // Financeiro
  BarChart3 as FluxoIcon, FileSpreadsheet, Receipt, CreditCard,
  BookOpen, Landmark, ArrowRightLeft, Package,
  ShoppingCart, ListOrdered, UserPlus, Building2, Briefcase,
  DollarSign, TrendingUp as RentIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface SidebarItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const PLANEJAMENTO_MENU: SidebarSection[] = [
  {
    title: 'Custos',
    items: [
      { key: 'custos-negocio', label: 'Custos do Negocio', icon: Wallet, href: '/planejamento/custos' },
      { key: 'custos-projeto', label: 'Custos de Projeto', icon: FolderKanban, href: '/planejamento/projetos' },
    ],
  },
  {
    title: 'CAC',
    items: [
      { key: 'cac-dashboard', label: 'Dashboard CAC', icon: Gauge, href: '/cac/dashboard' },
      { key: 'cac-cenarios', label: 'Cenarios', icon: TrendingUp, href: '/cac/cenarios' },
    ],
  },
];

const METAS_MENU: SidebarSection[] = [
  {
    title: 'Indicadores',
    items: [
      { key: 'dashboard-kpi', label: 'Dashboard KPI', icon: LayoutDashboard, href: '/dashboard' },
    ],
  },
  {
    title: 'Equipe',
    items: [
      { key: 'metas-ranking', label: 'Metas e Ranking', icon: Medal, href: '/equipe/metas' },
      { key: 'comissoes', label: 'Comissoes', icon: Percent, href: '/equipe/comissoes' },
      { key: 'planos-comissao', label: 'Planos de Comissao', icon: Settings, href: '/equipe/planos-comissao' },
    ],
  },
];

const PRODUTOS_MENU: SidebarSection[] = [
  {
    title: 'Criar',
    items: [
      { key: 'grupos', label: 'Grupos', icon: FolderOpen, href: '/grupos' },
      { key: 'nova-proposta', label: 'Nova Proposta', icon: Plus, href: '/propostas/nova' },
      { key: 'orcamentos', label: 'Orcamentos', icon: FileText, href: '/vendas/orcamentos' },
    ],
  },
  {
    title: 'Propostas',
    items: [
      { key: 'minhas-propostas', label: 'Minhas Propostas', icon: FileText, href: '/propostas' },
      { key: 'analytics', label: 'Analytics', icon: BarChart3, href: '/propostas/analytics' },
    ],
  },
  {
    title: 'Ferramentas',
    items: [
      { key: 'buscar-voos', label: 'Buscar Voos', icon: Plane, href: '/voos' },
      { key: 'buscar-hoteis', label: 'Buscar Hoteis', icon: Hotel, href: '/hoteis' },
      { key: 'destinos', label: 'Banco de Destinos', icon: Globe, href: '/destinos' },
    ],
  },
];

const FINANCEIRO_MENU: SidebarSection[] = [
  {
    title: 'Visao Geral',
    items: [
      { key: 'fluxo-caixa', label: 'Fluxo de Caixa', icon: FluxoIcon, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'DRE', icon: FileSpreadsheet, href: '/financeiro-ag/dre' },
      { key: 'conciliacao', label: 'Conciliacao', icon: FileSpreadsheet, href: '/financeiro-ag/conciliacao' },
    ],
  },
  {
    title: 'Contas',
    items: [
      { key: 'receber', label: 'Contas a Receber', icon: Receipt, href: '/financeiro-ag/receber' },
      { key: 'pagar', label: 'Contas a Pagar', icon: CreditCard, href: '/financeiro-ag/pagar' },
      { key: 'plano-contas', label: 'Plano de Contas', icon: BookOpen, href: '/financeiro-ag/plano-contas' },
      { key: 'contas-bancarias', label: 'Contas Bancarias', icon: Landmark, href: '/financeiro-ag/contas-bancarias' },
      { key: 'transferencias', label: 'Transferencias', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
    ],
  },
  {
    title: 'Grupos',
    items: [
      { key: 'fin-grupos', label: 'Financeiro de Grupos', icon: Package, href: '/financeiro-grupos' },
    ],
  },
  {
    title: 'Vendas',
    items: [
      { key: 'nova-venda', label: 'Nova Venda', icon: ShoppingCart, href: '/vendas/nova' },
      { key: 'lista-vendas', label: 'Lista de Vendas', icon: ListOrdered, href: '/vendas' },
    ],
  },
  {
    title: 'Pessoas',
    items: [
      { key: 'clientes', label: 'Clientes', icon: UserPlus, href: '/pessoas/clientes' },
      { key: 'fornecedores', label: 'Fornecedores', icon: Building2, href: '/pessoas/fornecedores' },
      { key: 'equipe', label: 'Equipe', icon: Briefcase, href: '/pessoas/equipe' },
    ],
  },
  {
    title: 'Relatorios',
    items: [
      { key: 'rel-financeiro', label: 'Financeiro', icon: DollarSign, href: '/relatorios/financeiro' },
      { key: 'rel-rentabilidade', label: 'Rentabilidade', icon: RentIcon, href: '/relatorios/rentabilidade' },
      { key: 'rel-comparativo', label: 'Comparativo Mensal', icon: BarChart3, href: '/relatorios/comparativo' },
    ],
  },
];

const PILLAR_MENUS: Record<Pillar, SidebarSection[]> = {
  planejamento: PLANEJAMENTO_MENU,
  metas: METAS_MENU,
  produtos: PRODUTOS_MENU,
  financeiro: FINANCEIRO_MENU,
};

export function PillarSidebar() {
  const pathname = usePathname();
  const activePillar = useActivePillar();

  if (!activePillar) return null;

  const sections = PILLAR_MENUS[activePillar];

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <aside className="w-[232px] bg-[var(--t-sidebar-bg)] border-r border-[var(--t-border)] flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="sidebar-content" key={activePillar}>
          {sections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? 'mt-5' : ''}>
              {section.title && (
                <div className="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--t-text-muted)]">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-2.5 text-[13px] rounded-lg transition-colors duration-150 relative ${
                        active
                          ? 'bg-[var(--t-sidebar-item-hover)] text-[var(--t-text)] font-medium'
                          : 'text-[var(--t-sidebar-item)] hover:bg-[var(--t-sidebar-item-hover)] hover:text-[var(--t-text)]'
                      }`}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--t-green)]" />
                      )}
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}
