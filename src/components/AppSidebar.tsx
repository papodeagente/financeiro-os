'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard, Users, UserPlus, Building2, Briefcase,
  ShoppingCart, ListOrdered, FileText as FileTextIcon,
  FolderOpen, Receipt, Factory, TrendingUp, FileText, Gauge,
  DollarSign, CreditCard, BookOpen, Landmark, Package,
  Settings, Building, UserCog,
  ChevronDown, ChevronRight,
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
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all ${
              isGroupActive(item)
                ? 'bg-[#d4a853]/20 text-[#d4a853]'
                : 'text-gray-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">{item.label}</span>
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {isOpen && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-700 pl-2">
              {item.children!.map(child => renderItem(child))}
            </div>
          )}
        </div>
      );
    }

    // Leaf item
    const href = item.href || '#';
    const active = isActive(item.href);

    return (
      <Link
        key={item.key}
        href={href}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all ${
          active
            ? 'bg-[#d4a853] text-[#1a1a2e] font-semibold'
            : 'text-gray-300 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="w-56 bg-[#1a1a2e] text-white flex flex-col shrink-0 overflow-hidden">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-700">
        <Link href="/dashboard" className="block">
          <div className="text-lg font-bold">Entur <span className="text-[#d4a853]">OS</span></div>
          <div className="text-[10px] text-gray-400">Financeiro</div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {MENU.map(item => renderItem(item))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 text-[9px] text-gray-500">
        Fase 1 — MVP v0.3
      </div>
    </aside>
  );
}
