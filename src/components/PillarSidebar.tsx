'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, type Pillar } from '@/hooks/useActivePillar';
import {
  Wallet, Gauge, TrendingUp,
  LayoutDashboard, Medal, Percent, Settings,
  FolderOpen, FileText, BarChart3,
  Plane, Hotel, Globe,
  BarChart3 as FluxoIcon, FileSpreadsheet, Receipt, CreditCard,
  BookOpen, Landmark, ArrowRightLeft, Package,
  ShoppingCart, ListOrdered, UserPlus, Building2, Briefcase,
  DollarSign, TrendingUp as RentIcon, Link2,
  Workflow, Filter as FunilIcon,
  Sparkles, Users, ClipboardList,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface SidebarItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

export interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const PLANEJAMENTO_MENU: SidebarSection[] = [
  {
    items: [
      { key: 'custos-negocio', label: 'Custos do negócio', icon: Wallet, href: '/planejamento/custos' },
      { key: 'fluxogramas', label: 'Fluxogramas', icon: Workflow, href: '/planejamento/fluxogramas' },
      { key: 'funis-campanhas', label: 'Funis e campanhas', icon: FunilIcon, href: '/planejamento/funis' },
    ],
  },
];

const METAS_MENU: SidebarSection[] = [
  {
    items: [
      { key: 'dashboard-kpi', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
      { key: 'metas-ranking', label: 'Metas da equipe', icon: Medal, href: '/equipe/metas' },
      { key: 'comissoes', label: 'Comissões', icon: Percent, href: '/equipe/comissoes' },
      { key: 'planos-comissao', label: 'Planos de comissão', icon: Settings, href: '/equipe/planos-comissao' },
    ],
  },
];

const PRODUTOS_MENU: SidebarSection[] = [
  {
    items: [
      { key: 'grupos', label: 'Produtos', icon: FolderOpen, href: '/grupos' },
      { key: 'minhas-propostas', label: 'Propostas', icon: FileText, href: '/propostas' },
      { key: 'orcamentos', label: 'Orçamentos', icon: BarChart3, href: '/vendas/orcamentos' },
      { key: 'nova-venda', label: 'Nova venda', icon: ShoppingCart, href: '/vendas/nova' },
    ],
  },
];

const FINANCEIRO_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'fin-hub', label: 'Visão geral', icon: FluxoIcon, href: '/financeiro-ag' },
      { key: 'fluxo-caixa', label: 'Fluxo de caixa', icon: FluxoIcon, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'DRE', icon: FileSpreadsheet, href: '/financeiro-ag/dre' },
      { key: 'receber', label: 'Contas a receber', icon: Receipt, href: '/financeiro-ag/receber' },
      { key: 'pagar', label: 'Contas a pagar', icon: CreditCard, href: '/financeiro-ag/pagar' },
      { key: 'conciliacao', label: 'Conciliação', icon: FileSpreadsheet, href: '/financeiro-ag/conciliacao' },
      { key: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
      { key: 'plano-contas', label: 'Plano de contas', icon: BookOpen, href: '/financeiro-ag/plano-contas' },
      { key: 'contas-bancarias', label: 'Contas bancárias', icon: Landmark, href: '/financeiro-ag/contas-bancarias' },
      { key: 'cartoes-corp', label: 'Cartões', icon: CreditCard, href: '/financeiro-ag/cartoes' },
    ],
  },
  {
    title: 'Produtos e vendas',
    items: [
      { key: 'fin-grupos', label: 'Por produto', icon: Package, href: '/financeiro-grupos' },
      { key: 'lista-vendas', label: 'Vendas fechadas', icon: ListOrdered, href: '/vendas' },
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
    title: 'Relatórios',
    items: [
      { key: 'rel-financeiro', label: 'Relatórios', icon: DollarSign, href: '/relatorios/financeiro' },
      { key: 'rel-rentabilidade', label: 'Rentabilidade', icon: RentIcon, href: '/relatorios/rentabilidade' },
      { key: 'rel-comparativo', label: 'Comparativo mensal', icon: BarChart3, href: '/relatorios/comparativo' },
      { key: 'cac-dashboard', label: 'Dashboard CAC', icon: Gauge, href: '/cac/dashboard' },
    ],
  },
];

const CONFIGURACOES_MENU: SidebarSection[] = [
  {
    title: 'Geral',
    items: [
      { key: 'cfg-agencia', label: 'Dados da agência', icon: Building2, href: '/config/agencia' },
      { key: 'cfg-usuarios', label: 'Usuários', icon: Users, href: '/config/usuarios' },
    ],
  },
  {
    title: 'Inteligência Artificial',
    items: [
      { key: 'cfg-ia', label: 'Chaves de API (IA)', icon: Sparkles, href: '/config/integracoes' },
    ],
  },
  {
    title: 'Integrações',
    items: [
      { key: 'cfg-crm', label: 'Integração CRM', icon: Link2, href: '/config/crm' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { key: 'cfg-auditoria', label: 'Auditoria', icon: ClipboardList, href: '/config/auditoria' },
    ],
  },
];

export const PILLAR_MENUS: Record<Pillar, SidebarSection[]> = {
  planejamento: PLANEJAMENTO_MENU,
  metas: METAS_MENU,
  produtos: PRODUTOS_MENU,
  financeiro: FINANCEIRO_MENU,
  configuracoes: CONFIGURACOES_MENU,
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
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <aside className="w-[240px] bg-[var(--t-sidebar-bg)] border-r border-[var(--t-border)] flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="sidebar-content" key={activePillar}>
          {sections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? 'mt-5' : ''}>
              {section.title && (
                <div className="px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t-text-muted)]">
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
                      className={`flex items-center gap-3 px-4 py-2.5 text-[var(--text-body-sm)] rounded-lg transition-colors duration-150 relative ${
                        active
                          ? 'bg-[var(--t-green)]/8 text-[var(--t-green)] font-medium'
                          : 'text-[var(--t-sidebar-item)] hover:bg-[var(--t-sidebar-item-hover)] hover:text-[var(--t-text)]'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-[var(--t-green)]" />
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
