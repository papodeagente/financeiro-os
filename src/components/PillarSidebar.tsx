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
  Workflow, Filter as FunilIcon, GitBranch as MindIcon,
  Sparkles, Users, ClipboardList,
  PanelLeftClose, PanelLeftOpen,
  Eraser,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

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
    title: 'Planejamento',
    items: [
      { key: 'custos-negocio', label: 'Custos do negócio', icon: Wallet, href: '/planejamento/custos' },
      { key: 'fluxogramas', label: 'Fluxogramas', icon: Workflow, href: '/planejamento/fluxogramas' },
      { key: 'funis-campanhas', label: 'Funis e campanhas', icon: FunilIcon, href: '/planejamento/funis' },
      { key: 'mapas-mentais', label: 'Mapa mental', icon: MindIcon, href: '/planejamento/mapas-mentais' },
    ],
  },
];

const METAS_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'dashboard-kpi', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
      { key: 'metas-ranking', label: 'Metas da equipe', icon: Medal, href: '/equipe/metas' },
    ],
  },
  {
    title: 'Equipe',
    items: [
      { key: 'comissoes', label: 'Comissões', icon: Percent, href: '/equipe/comissoes' },
      { key: 'planos-comissao', label: 'Planos de comissão', icon: Settings, href: '/equipe/planos-comissao' },
    ],
  },
];

const PRODUTOS_MENU: SidebarSection[] = [
  {
    title: 'Catálogo',
    items: [
      { key: 'grupos', label: 'Produtos', icon: FolderOpen, href: '/grupos' },
      { key: 'gestao-grupos', label: 'Gestão de grupos', icon: Users, href: '/grupos/gestao' },
    ],
  },
  {
    title: 'Vendas',
    items: [
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
      { key: 'cfg-reset', label: 'Resetar dados', icon: Eraser, href: '/config/reset' },
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

interface PillarSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function PillarSidebar({ collapsed = false, onToggle }: PillarSidebarProps) {
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
    <TooltipProvider delay={collapsed ? 100 : 600}>
      <aside
        className={`flex flex-col shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-[56px]' : 'w-[220px]'
        }`}
        style={{
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          background: 'var(--lg-surface-solid)',
          borderRight: '1px solid #F1F5F9',
        }}
      >
        <nav className="flex-1 overflow-y-auto sidebar-scroll px-2 py-3">
          <div className="sidebar-content" key={activePillar}>
            {sections.map((section, sIdx) => (
              <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
                {section.title && !collapsed && (
                  <div
                    className="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase"
                    style={{ letterSpacing: '0.05em', color: 'var(--lg-text-4)' }}
                  >
                    {section.title}
                  </div>
                )}
                {section.title && collapsed && (
                  <div className="mx-2 mb-1.5 border-t border-[var(--lg-border-light,#F1F5F9)]" />
                )}
                <div className="space-y-0.5">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const active = isActive(item.href);

                    const linkContent = (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={`sidebar-item flex items-center transition-colors duration-150 ${
                          collapsed
                            ? 'justify-center w-10 h-10 mx-auto rounded-lg'
                            : 'gap-2.5 px-3 py-2 rounded-lg'
                        } ${
                          active
                            ? 'font-semibold'
                            : 'hover:bg-[#F1F5F9]'
                        }`}
                        style={{
                          fontSize: '14px',
                          color: active ? 'var(--lg-accent)' : 'var(--lg-text-2)',
                          background: active ? 'var(--lg-accent-fill)' : undefined,
                        }}
                      >
                        <Icon className="shrink-0 w-[18px] h-[18px]" />
                        {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.key}>
                          <TooltipTrigger
                            render={
                              <Link
                                href={item.href}
                                className={`sidebar-item flex items-center rounded-lg transition-colors duration-150 relative justify-center w-10 h-10 mx-auto ${
                                  active
                                    ? 'bg-[var(--t-green)]/8 text-[var(--t-green)] font-medium'
                                    : 'text-[var(--t-sidebar-item)] hover:bg-[var(--t-sidebar-item-hover)] hover:text-[var(--t-text)]'
                                }`}
                              />
                            }
                          >
                            {active && (
                              <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full bg-[var(--t-green)]" />
                            )}
                            <Icon className="w-5 h-5 shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return linkContent;
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Toggle collapse button */}
        <div className="px-2 py-2 border-t border-[var(--t-border)]">
          <button
            onClick={onToggle}
            className={`sidebar-item flex items-center rounded-lg text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors ${
              collapsed
                ? 'justify-center w-10 h-10 mx-auto'
                : 'gap-3 px-3 py-2 w-full'
            }`}
            title={collapsed ? 'Expandir menu (Ctrl+B)' : 'Recolher menu (Ctrl+B)'}
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <><PanelLeftClose className="w-4 h-4" /><span className="text-[12px]">Recolher</span></>
            }
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
