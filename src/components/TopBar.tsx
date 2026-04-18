'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { CrmStatusBadge } from './CrmStatusBadge';
import { Logo } from './Logo';
import { Sun, Moon, Search, LogOut, ChevronDown, Settings, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface Props {
  onCommandPalette?: () => void;
  breadcrumb?: React.ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
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

export function TopBar({ onCommandPalette, breadcrumb, sidebarCollapsed, onToggleSidebar }: Props) {
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
    <header className="h-[56px] bg-[var(--t-surface)]/90 backdrop-blur-xl border-b border-[var(--t-border)] flex items-center px-5 shrink-0 z-40" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
      {/* Left: Logo + Greeting */}
      <div className="flex items-center gap-4 shrink-0 mr-4">
        <Logo variant="sidebar" href="/dashboard" />
        {user && (
          <div className="hidden lg:flex flex-col justify-center">
            <span className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)] leading-tight">
              {getGreeting()}, <span className="text-[var(--t-text)] font-medium">{user.nome?.split(' ')[0]}</span>
            </span>
            {breadcrumb && (
              <div className="mt-0.5">{breadcrumb}</div>
            )}
          </div>
        )}
      </div>

      {/* Center: Pillar pills */}
      <nav className="flex-1 flex items-center justify-center gap-1">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={getPillarDefaultRoute(pillar.id)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-[var(--text-body-sm)] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-[var(--t-green)]/10 text-[var(--t-green)]'
                  : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{pillar.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right: Actions + Utilities */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Quick actions */}
        <Link
          href="/vendas/nova"
          className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium text-white transition-all hover:brightness-110"
          style={{ background: 'var(--t-accent-gradient)', boxShadow: '0 1px 3px var(--t-green-shadow)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Nova Venda
        </Link>
        <Link
          href="/propostas/nova"
          className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Proposta
        </Link>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--t-border)] mx-1 hidden xl:block" />

        {/* Search trigger */}
        <button
          onClick={onCommandPalette}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg)] text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:border-[var(--t-border-hover)] transition-all text-[var(--text-body-sm)] min-w-[140px] lg:min-w-[200px]"
          title="⌘K"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden lg:inline flex-1 text-left">Buscar...</span>
          <kbd className="hidden lg:inline text-[10px] text-[var(--t-text-muted)] bg-[var(--t-surface)] border border-[var(--t-border)] px-1.5 py-0.5 rounded ml-1" style={{ boxShadow: 'var(--elevation-1)' }}>⌘K</kbd>
        </button>

        {/* CRM status */}
        <CrmStatusBadge variant="compacto" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
          aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User dropdown */}
        {user && (
          <div className="relative" ref={dropdownRef}>
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
              <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl py-1.5 z-50 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
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
