'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  LayoutDashboard, Users, UserPlus, Building2, Briefcase,
  ShoppingCart, ListOrdered, FileText as FileTextIcon,
  FolderOpen, Receipt, Factory, TrendingUp, FileText, Gauge,
  DollarSign, CreditCard, BookOpen, Landmark, Package,
  Settings, Building, UserCog, Target, ArrowRightLeft,
  FileSpreadsheet, BarChart3,
  ChevronDown, ChevronRight, Sun, Moon,
} from 'lucide-react';

interface MenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: MenuItem[];
}

const MENU: MenuItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
  },
  {
    key: 'pessoas',
    label: 'Pessoas',
    icon: Users,
    children: [
      { key: 'clientes', label: 'Clientes', icon: UserPlus, href: '/pessoas/clientes' },
      { key: 'fornecedores-crm', label: 'Fornecedores', icon: Building2, href: '/pessoas/fornecedores' },
      { key: 'equipe', label: 'Equipe', icon: Briefcase, href: '/pessoas/equipe' },
    ],
  },
  {
    key: 'vendas-menu',
    label: 'Vendas',
    icon: ShoppingCart,
    children: [
      { key: 'nova-venda', label: 'Nova Venda', icon: ShoppingCart, href: '/vendas/nova' },
      { key: 'lista-vendas', label: 'Lista de Vendas', icon: ListOrdered, href: '/vendas' },
      { key: 'orcamentos', label: 'Orçamentos', icon: FileTextIcon, href: '/vendas/orcamentos' },
    ],
  },
  {
    key: 'produtos',
    label: 'Produtos',
    icon: Package,
    children: [
      { key: 'grupos', label: 'Grupos (Criar Produto)', icon: FolderOpen, href: '/grupos' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    children: [
      { key: 'fin-grupos', label: 'Financeiro de Grupos', icon: Package, href: '/financeiro-grupos' },
      { key: 'contas-receber', label: 'Contas a Receber', icon: Receipt, href: '/financeiro-ag/receber' },
      { key: 'contas-pagar', label: 'Contas a Pagar', icon: CreditCard, href: '/financeiro-ag/pagar' },
      { key: 'plano-contas', label: 'Plano de Contas', icon: BookOpen, href: '/financeiro-ag/plano-contas' },
      { key: 'contas-bancarias', label: 'Contas Bancárias', icon: Landmark, href: '/financeiro-ag/contas-bancarias' },
      { key: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
      { key: 'conciliacao', label: 'Conciliação Bancária', icon: FileSpreadsheet, href: '/financeiro-ag/conciliacao' },
      { key: 'fluxo-caixa', label: 'Fluxo de Caixa', icon: BarChart3, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'DRE', icon: FileTextIcon, href: '/financeiro-ag/dre' },
    ],
  },
  {
    key: 'cac',
    label: 'CAC',
    icon: Target,
    children: [
      { key: 'cac-dashboard', label: 'Dashboard', icon: Gauge, href: '/cac/dashboard' },
      { key: 'cac-cenarios', label: 'Cenários', icon: TrendingUp, href: '/cac/cenarios' },
    ],
  },
  {
    key: 'config',
    label: 'Configurações',
    icon: Settings,
    children: [
      { key: 'agencia', label: 'Dados da Agência', icon: Building, href: '/config/agencia' },
      { key: 'usuarios', label: 'Usuários', icon: UserCog, href: '/config/usuarios' },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === '/grupos') return pathname === '/' || pathname === '/grupos';
    return pathname.startsWith(href);
  };

  const isGroupActive = (item: MenuItem) => {
    if (!item.children) return isActive(item.href);
    return item.children.some(c => isActive(c.href));
  };

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = expanded[item.key] || isGroupActive(item);

    if (hasChildren) {
      return (
        <div key={item.key}>
          <button
            onClick={() => toggle(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-all ${
              isGroupActive(item)
                ? 'bg-[var(--t-sidebar-group)] text-[var(--t-sidebar-group-text)]'
                : 'text-[var(--t-sidebar-item)] hover:bg-[var(--t-sidebar-item-hover)] hover:text-[var(--t-text)]'
            }`}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-50" /> : <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
          </button>
          {isOpen && (
            <div className="ml-[18px] mt-0.5 space-y-0.5 border-l border-[var(--t-border)] pl-3 mb-1">
              {item.children!.map(child => renderItem(child))}
            </div>
          )}
        </div>
      );
    }

    const href = item.href || '#';
    const active = isActive(item.href);

    return (
      <Link
        key={item.key}
        href={href}
        className={`flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-all ${
          active
            ? 'bg-[var(--t-sidebar-active-bg)] text-[var(--t-sidebar-active-text)] font-medium shadow-lg'
            : 'text-[var(--t-sidebar-item)] hover:bg-[var(--t-sidebar-item-hover)] hover:text-[var(--t-text)]'
        }`}
        style={active ? { boxShadow: `0 4px 15px var(--t-green-shadow)` } : {}}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="w-60 bg-[var(--t-sidebar-bg)] flex flex-col shrink-0 overflow-hidden border-r border-[var(--t-border)] transition-colors duration-200">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--t-green)] flex items-center justify-center">
            <span className="text-white font-bold text-sm dark:text-[#0a0a14]">E</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-[var(--t-text)] tracking-tight">Entur <span className="text-[var(--t-green)]">OS</span></div>
            <div className="text-[10px] text-[var(--t-text-secondary)] -mt-0.5">Financeiro</div>
          </div>
        </Link>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-[var(--t-border)]" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {MENU.map(item => renderItem(item))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[var(--t-border)]">
        <div className="text-[10px] text-[var(--t-text-muted)] tracking-wider uppercase">Fase 1 — MVP</div>
      </div>
    </aside>
  );
}
