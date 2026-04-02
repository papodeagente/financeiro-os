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
            className={`w-full flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-all ${
              isGroupActive(item)
                ? 'bg-[#4ade80]/10 text-[#4ade80]'
                : 'text-[#8888a0] hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-50" /> : <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
          </button>
          {isOpen && (
            <div className="ml-[18px] mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-3 mb-1">
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
            ? 'bg-[#4ade80] text-[#0a0a14] font-medium shadow-lg shadow-[#4ade80]/20'
            : 'text-[#8888a0] hover:bg-white/[0.04] hover:text-white'
        }`}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="w-60 bg-[#0e0e1a] flex flex-col shrink-0 overflow-hidden border-r border-white/[0.06]">
      {/* Logo */}
      <div className="px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#4ade80] flex items-center justify-center">
            <span className="text-[#0a0a14] font-bold text-sm">E</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-white tracking-tight">Entur <span className="text-[#4ade80]">OS</span></div>
            <div className="text-[10px] text-[#8888a0] -mt-0.5">Financeiro</div>
          </div>
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/[0.06]" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {MENU.map(item => renderItem(item))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/[0.06]">
        <div className="text-[10px] text-[#555] tracking-wider uppercase">Fase 1 — MVP</div>
      </div>
    </aside>
  );
}
