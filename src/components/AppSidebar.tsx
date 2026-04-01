'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/contexts/AppContext';
import { useState } from 'react';
import {
  LayoutDashboard, Users, UserPlus, Building2, Briefcase,
  ShoppingCart, ListOrdered, FileText as FileTextIcon,
  FolderOpen, Receipt, Factory, TrendingUp, FileText, Gauge,
  DollarSign, CreditCard, BookOpen, Landmark,
  Settings, Building, UserCog,
  ChevronDown, ChevronRight, Package,
} from 'lucide-react';

interface MenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: MenuItem[];
  requiresGrupo?: boolean;
  grupoTab?: string;
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
    key: 'grupos',
    label: 'Grupos',
    icon: FolderOpen,
    href: '/',
  },
  {
    key: 'fin-grupo',
    label: 'Fin. Grupo',
    icon: Package,
    requiresGrupo: true,
    children: [
      { key: 'fin-painel', label: 'Painel', icon: LayoutDashboard, grupoTab: 'painel', requiresGrupo: true },
      { key: 'fin-vendas', label: 'Vendas', icon: ShoppingCart, grupoTab: 'vendas', requiresGrupo: true },
      { key: 'fin-recebimentos', label: 'Recebim.', icon: Receipt, grupoTab: 'recebimentos', requiresGrupo: true },
      { key: 'fin-fornecedores', label: 'Fornec.', icon: Factory, grupoTab: 'fornecedores', requiresGrupo: true },
      { key: 'fin-fluxo', label: 'Fluxo Cx', icon: TrendingUp, grupoTab: 'fluxo_caixa', requiresGrupo: true },
      { key: 'fin-dre', label: 'DRE', icon: FileText, grupoTab: 'dre', requiresGrupo: true },
      { key: 'fin-indicadores', label: 'Indicadores', icon: Gauge, grupoTab: 'indicadores', requiresGrupo: true },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    children: [
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
  const { activeGrupoId, activeGrupoLabel } = useApp();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const isGroupActive = (item: MenuItem) => {
    if (!item.children) return isActive(item.href);
    return item.children.some(c => {
      if (c.grupoTab) {
        return pathname === `/financeiro/${activeGrupoId}/${c.grupoTab}`;
      }
      return isActive(c.href);
    });
  };

  const renderItem = (item: MenuItem, depth = 0) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = expanded[item.key] || isGroupActive(item);
    const disabled = item.requiresGrupo && !activeGrupoId;

    if (hasChildren) {
      return (
        <div key={item.key}>
          <button
            onClick={() => !disabled && toggle(item.key)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all ${
              isGroupActive(item)
                ? 'bg-[#d4a853]/20 text-[#d4a853]'
                : disabled
                  ? 'opacity-40 cursor-not-allowed text-gray-400'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">{item.label}</span>
            {disabled && activeGrupoId === null && item.requiresGrupo && (
              <span className="text-[8px] text-gray-500">selecione grupo</span>
            )}
            {!disabled && (isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
          </button>
          {isOpen && !disabled && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-700 pl-2">
              {item.children!.map(child => renderItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // Leaf item
    const href = item.grupoTab
      ? (activeGrupoId ? `/financeiro/${activeGrupoId}/${item.grupoTab}` : '#')
      : (item.href || '#');

    const active = item.grupoTab
      ? pathname === `/financeiro/${activeGrupoId}/${item.grupoTab}`
      : isActive(item.href);

    return (
      <Link
        key={item.key}
        href={href}
        onClick={e => { if (disabled) e.preventDefault(); }}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all ${
          active
            ? 'bg-[#d4a853] text-[#1a1a2e] font-semibold'
            : disabled
              ? 'opacity-30 cursor-not-allowed text-gray-400'
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
        <Link href="/" className="block">
          <div className="text-lg font-bold">Grupos <span className="text-[#d4a853]">OS</span></div>
          <div className="text-[10px] text-gray-400">Sistema de Gestão de Viagens</div>
        </Link>
      </div>

      {/* Active grupo badge */}
      {activeGrupoId && (
        <div className="px-4 py-2 border-b border-gray-700 bg-white/5">
          <div className="text-[9px] uppercase text-gray-500">Grupo ativo</div>
          <Link href={`/grupo/${activeGrupoId}`} className="text-xs text-[#d4a853] font-semibold truncate block hover:underline">
            {activeGrupoLabel || 'Sem ID'}
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {MENU.map(item => renderItem(item))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 text-[9px] text-gray-500">
        Fase 1 — MVP v0.2
      </div>
    </aside>
  );
}
