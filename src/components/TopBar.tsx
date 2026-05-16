'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { CrmStatusBadge } from './CrmStatusBadge';
import { NotificacoesBell } from './NotificacoesBell';
import { Logo } from './Logo';
import { Sun, Moon, Search, LogOut, ChevronDown, Settings, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface Props {
  onCommandPalette?: () => void;
  breadcrumb?: React.ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function getPillarDefaultRoute(pillar: Pillar): string {
  switch (pillar) {
    case 'planejamento': return '/planejamento/custos';
    case 'metas': return '/dashboard';
    case 'produtos': return '/grupos';
    case 'financeiro': return '/financeiro-ag';
    case 'configuracoes': return '/config/agencia';
  }
}

export function TopBar({ onCommandPalette }: Props) {
  const activePillar = useActivePillar();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-[56px] w-full lg-glass-thin flex items-center px-3 sm:px-5 shrink-0 z-40 min-w-0 overflow-hidden" style={{ fontFamily: 'var(--font-inter-tight), var(--font-inter), system-ui, sans-serif' }}>
      {/* Left: Logo somente — saudacao/breadcrumb removidos pra ganhar
          espaco e manter a topbar limpa (so icones e logo). */}
      <div className="flex items-center shrink-0 mr-2 sm:mr-4">
        <Logo variant="sidebar" href="/dashboard" />
      </div>

      {/* Center: Pillar icons — so icones, sem labels, com tooltip
          nativo (title) revelando o nome ao hover. */}
      <nav className="flex-1 flex items-center justify-center gap-0.5 sm:gap-1 min-w-0 overflow-hidden">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={getPillarDefaultRoute(pillar.id)}
              className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150 shrink-0 ${
                isActive
                  ? 'bg-[var(--ink)]/10 text-[var(--ink)]'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--ink)]/5'
              }`}
              title={pillar.label}
              aria-label={pillar.label}
            >
              <Icon className="w-4 h-4 shrink-0" />
            </Link>
          );
        })}
      </nav>

      {/* Right: Actions + Utilities — todos como icone unico */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {/* Nova Venda — botao primario icon-only */}
        <Link
          href="/vendas/nova"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-white transition-all hover:brightness-110 shrink-0"
          style={{ background: 'var(--t-accent-gradient)', boxShadow: '0 1px 3px var(--t-green-shadow)' }}
          title="Nova venda"
          aria-label="Nova venda"
        >
          <Plus className="w-4 h-4" />
        </Link>

        {/* Search trigger — icon-only com tooltip; abre o cmd palette */}
        <button
          onClick={onCommandPalette}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors shrink-0"
          title="Buscar (⌘K)"
          aria-label="Buscar"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* CRM status — so em telas largas (icone compacto ja) */}
        <div className="hidden lg:flex items-center shrink-0">
          <CrmStatusBadge variant="compacto" />
        </div>

        {/* Notifications */}
        <div className="shrink-0">
          <NotificacoesBell />
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors shrink-0"
          aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User dropdown — sempre visivel e nunca cortado */}
        {user && (
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 ml-0.5 px-1.5 py-1 rounded-xl hover:bg-[var(--t-surface-hover)] transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-offset-1 ring-[var(--t-green)]/20 ring-offset-[var(--t-surface)]"
                style={{ background: 'var(--t-accent-gradient)' }}
              >
                <span className="text-[11px] font-bold text-white">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[var(--t-text-muted)]" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 lg-glass-thick py-1.5 z-50 dropdown-enter">
                <div className="px-4 py-3 border-b border-[var(--t-border)]">
                  <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">{user.nome}</p>
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{user.email}</p>
                </div>
                <Link
                  href="/config/agencia"
                  className="flex items-center gap-2 px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] mx-1.5 my-0.5 rounded-lg"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Configurações
                </Link>
                <div className="border-t border-[var(--t-border)] mt-1 pt-1">
                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2.5 text-[var(--text-body-sm)] text-red-400 hover:bg-red-400/10 flex items-center gap-2 mx-1.5 rounded-lg"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
