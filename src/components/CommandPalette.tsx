'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, FolderOpen, FileText, BarChart3, Plane, Hotel, Globe,
  LayoutDashboard, Medal, Percent, Settings, Wallet, FolderKanban,
  Gauge, TrendingUp, Receipt, CreditCard, BookOpen, Landmark,
  ArrowRightLeft, Package, ShoppingCart, ListOrdered, UserPlus,
  Building2, Briefcase, DollarSign, Link2, FileSpreadsheet, Plus,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  section: 'navegacao' | 'criar' | 'recentes' | 'crm';
}

const NAVIGATION_ITEMS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" />, section: 'navegacao' },
  { id: 'grupos', label: 'Grupos', href: '/grupos', icon: <FolderOpen className="w-4 h-4" />, section: 'navegacao' },
  { id: 'propostas', label: 'Propostas', href: '/propostas', icon: <FileText className="w-4 h-4" />, section: 'navegacao' },
  { id: 'orcamentos', label: 'Orçamentos', href: '/vendas/orcamentos', icon: <BarChart3 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'vendas', label: 'Vendas fechadas', href: '/vendas', icon: <ListOrdered className="w-4 h-4" />, section: 'navegacao' },
  { id: 'voos', label: 'Buscar voos', href: '/voos', icon: <Plane className="w-4 h-4" />, section: 'navegacao' },
  { id: 'hoteis', label: 'Buscar hotéis', href: '/hoteis', icon: <Hotel className="w-4 h-4" />, section: 'navegacao' },
  { id: 'destinos', label: 'Destinos', href: '/destinos', icon: <Globe className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fluxo', label: 'Fluxo de caixa', href: '/financeiro-ag/fluxo-caixa', icon: <DollarSign className="w-4 h-4" />, section: 'navegacao' },
  { id: 'dre', label: 'DRE', href: '/financeiro-ag/dre', icon: <FileSpreadsheet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'receber', label: 'Contas a receber', href: '/financeiro-ag/receber', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  { id: 'pagar', label: 'Contas a pagar', href: '/financeiro-ag/pagar', icon: <CreditCard className="w-4 h-4" />, section: 'navegacao' },
  { id: 'conciliacao', label: 'Conciliação', href: '/financeiro-ag/conciliacao', icon: <FileSpreadsheet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'transferencias', label: 'Transferências', href: '/financeiro-ag/transferencias', icon: <ArrowRightLeft className="w-4 h-4" />, section: 'navegacao' },
  { id: 'plano-contas', label: 'Plano de contas', href: '/financeiro-ag/plano-contas', icon: <BookOpen className="w-4 h-4" />, section: 'navegacao' },
  { id: 'contas-bancarias', label: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias', icon: <Landmark className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fin-grupos', label: 'Financeiro por grupo', href: '/financeiro-grupos', icon: <Package className="w-4 h-4" />, section: 'navegacao' },
  { id: 'clientes', label: 'Clientes', href: '/pessoas/clientes', icon: <UserPlus className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fornecedores', label: 'Fornecedores', href: '/pessoas/fornecedores', icon: <Building2 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'equipe', label: 'Equipe', href: '/pessoas/equipe', icon: <Briefcase className="w-4 h-4" />, section: 'navegacao' },
  { id: 'metas', label: 'Metas da equipe', href: '/equipe/metas', icon: <Medal className="w-4 h-4" />, section: 'navegacao' },
  { id: 'comissoes', label: 'Comissões', href: '/equipe/comissoes', icon: <Percent className="w-4 h-4" />, section: 'navegacao' },
  { id: 'planos-comissao', label: 'Planos de comissão', href: '/equipe/planos-comissao', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  { id: 'custos', label: 'Custos do negócio', href: '/planejamento/custos', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'projetos', label: 'Projetos comerciais', href: '/planejamento/projetos', icon: <FolderKanban className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cac', label: 'Dashboard CAC', href: '/cac/dashboard', icon: <Gauge className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cenarios', label: 'Simulador CAC', href: '/cac/cenarios', icon: <TrendingUp className="w-4 h-4" />, section: 'navegacao' },
  { id: 'relatorios', label: 'Relatórios financeiros', href: '/relatorios/financeiro', icon: <DollarSign className="w-4 h-4" />, section: 'navegacao' },
  { id: 'rentabilidade', label: 'Rentabilidade', href: '/relatorios/rentabilidade', icon: <TrendingUp className="w-4 h-4" />, section: 'navegacao' },
  { id: 'config-agencia', label: 'Configurações', href: '/config/agencia', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
];

const CREATE_ITEMS: CommandItem[] = [
  { id: 'novo-grupo', label: 'Novo grupo', href: '/grupos', icon: <Plus className="w-4 h-4" />, section: 'criar' },
  { id: 'nova-proposta', label: 'Nova proposta', href: '/propostas/nova', icon: <Plus className="w-4 h-4" />, section: 'criar' },
  { id: 'nova-venda', label: 'Nova venda', href: '/vendas/nova', icon: <ShoppingCart className="w-4 h-4" />, section: 'criar' },
];

const CRM_ITEMS: CommandItem[] = [
  { id: 'crm-status', label: 'Status da integração CRM', href: '/config/crm', icon: <Link2 className="w-4 h-4" />, section: 'crm' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const recents = useMemo(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = JSON.parse(localStorage.getItem('entur:recentes') || '[]') as string[];
      return stored.slice(0, 5).map(href => {
        const found = NAVIGATION_ITEMS.find(i => i.href === href);
        return found ? { ...found, section: 'recentes' as const } : null;
      }).filter(Boolean) as CommandItem[];
    } catch { return []; }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return [...CREATE_ITEMS, ...recents.slice(0, 3), ...CRM_ITEMS];
    }
    const q = query.toLowerCase();
    const all = [...CREATE_ITEMS, ...NAVIGATION_ITEMS, ...CRM_ITEMS];
    return all.filter(item => item.label.toLowerCase().includes(q));
  }, [query, recents]);

  const handleSelect = (item: CommandItem) => {
    onClose();
    router.push(item.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      handleSelect(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  const sectionLabels: Record<string, string> = {
    criar: 'Criar',
    recentes: 'Recentes',
    navegacao: 'Navegação',
    crm: 'Integração',
  };

  let lastSection = '';
  let globalIdx = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--t-border)]">
          <Search className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar paginas, criar..."
            className="flex-1 bg-transparent text-[var(--text-body)] text-[var(--t-text)] outline-none placeholder:text-[var(--t-text-muted)]"
          />
          <kbd className="text-[10px] text-[var(--t-text-muted)] bg-[var(--t-sidebar-item-hover)] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-[var(--text-body-sm)] text-[var(--t-text-muted)]">Nenhum resultado</p>
          )}
          {filtered.map((item) => {
            globalIdx++;
            const idx = globalIdx;
            const showSection = item.section !== lastSection;
            lastSection = item.section;

            return (
              <div key={item.id}>
                {showSection && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                    {sectionLabels[item.section]}
                  </div>
                )}
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2 text-[var(--text-body-sm)] transition-colors ${
                    idx === selectedIdx
                      ? 'bg-[var(--t-green)]/8 text-[var(--t-green)]'
                      : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-sidebar-item-hover)]'
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
