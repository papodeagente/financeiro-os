'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/contexts/AppContext';
import {
  FolderOpen, LayoutDashboard, ShoppingCart, Receipt,
  Factory, TrendingUp, FileText, Gauge,
} from 'lucide-react';

const FINANCIAL_ITEMS = [
  { key: 'painel', label: 'PAINEL', icon: LayoutDashboard, tab: 'painel' },
  { key: 'vendas', label: 'VENDAS', icon: ShoppingCart, tab: 'vendas' },
  { key: 'recebimentos', label: 'RECEBIM.', icon: Receipt, tab: 'recebimentos' },
  { key: 'fornecedores', label: 'FORNEC.', icon: Factory, tab: 'fornecedores' },
  { key: 'fluxo_caixa', label: 'FLUXO CX', icon: TrendingUp, tab: 'fluxo_caixa' },
  { key: 'dre', label: 'DRE', icon: FileText, tab: 'dre' },
  { key: 'indicadores', label: 'INDICAD.', icon: Gauge, tab: 'indicadores' },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { activeGrupoId, activeGrupoLabel } = useApp();

  const isHome = pathname === '/';
  const isFinanceiro = pathname.startsWith('/financeiro');
  const activeFinTab = isFinanceiro ? pathname.split('/').pop() : null;

  return (
    <aside className="w-20 bg-[#1a1a2e] text-white flex flex-col items-center py-4 gap-1 overflow-y-auto shrink-0">
      {/* Logo */}
      <div className="mb-3 text-center">
        <div className="text-xs font-bold text-[#d4a853]">GRUPOS</div>
        <div className="text-[8px] text-gray-400">OS</div>
      </div>

      {/* GRUPOS */}
      <Link
        href="/"
        className={`w-16 py-2 rounded-lg text-center transition-all ${
          isHome ? 'bg-[#d4a853] text-[#1a1a2e]' : 'hover:bg-white/10'
        }`}
      >
        <FolderOpen className="w-4 h-4 mx-auto" />
        <div className="text-[9px] font-semibold mt-0.5">GRUPOS</div>
      </Link>

      <div className="w-12 border-t border-gray-600 my-2" />
      <div className="text-[8px] uppercase tracking-wider text-gray-400 mb-1">Financeiro</div>

      {/* Active grupo indicator */}
      {activeGrupoId && (
        <div className="w-16 px-1 py-1 mb-1 text-center">
          <div className="text-[7px] text-gray-500 truncate">{activeGrupoLabel || 'Grupo'}</div>
        </div>
      )}

      {/* Financial tabs */}
      {FINANCIAL_ITEMS.map(item => {
        const Icon = item.icon;
        const href = activeGrupoId ? `/financeiro/${activeGrupoId}/${item.tab}` : '#';
        const isActive = activeFinTab === item.tab;
        const disabled = !activeGrupoId;

        return (
          <Link
            key={item.key}
            href={href}
            onClick={e => { if (disabled) e.preventDefault(); }}
            className={`w-16 py-1.5 rounded-lg text-center transition-all ${
              isActive
                ? 'bg-[#d4a853] text-[#1a1a2e]'
                : disabled
                  ? 'opacity-30 cursor-not-allowed'
                  : 'hover:bg-white/10'
            }`}
          >
            <Icon className="w-4 h-4 mx-auto" />
            <div className="text-[9px] font-semibold mt-0.5">{item.label}</div>
          </Link>
        );
      })}
    </aside>
  );
}
