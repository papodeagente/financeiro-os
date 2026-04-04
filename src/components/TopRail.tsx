'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { CrmStatusBadge } from './CrmStatusBadge';
import { Sun, Moon, Search, LogOut, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface Props {
  onPillarClick?: (pillar: Pillar) => void;
  onCommandPalette?: () => void;
}

export function TopRail({ onPillarClick, onCommandPalette }: Props) {
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
    <header className="h-[52px] bg-[var(--t-sidebar-bg)] border-b border-[var(--t-border)] flex items-center px-4 shrink-0 z-40">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-2 mr-8 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[var(--t-green)] flex items-center justify-center">
          <span className="text-white font-bold text-xs dark:text-[#0a0a14]">E</span>
        </div>
      </Link>

      {/* Pillar pills */}
      <nav className="flex-1 flex items-center justify-center gap-1.5">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={getPillarDefaultRoute(pillar.id)}
              onClick={() => onPillarClick?.(pillar.id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[var(--text-body-sm)] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-[var(--t-green)]/8 text-[var(--t-green)]'
                  : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{pillar.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Utilities */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Command palette trigger */}
        <button
          onClick={onCommandPalette}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
          aria-label="Busca rapida"
          title="⌘K"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* CRM status */}
        <CrmStatusBadge variant="compacto" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
          aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User dropdown */}
        {user && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 ml-1 px-2 py-1 rounded-lg hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[var(--t-green)]/20 flex items-center justify-center">
                <span className="text-[10px] font-bold text-[var(--t-green)]">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[var(--t-text-muted)]" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-lg shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b border-[var(--t-border)]">
                  <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">{user.nome}</p>
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{user.email}</p>
                </div>
                <Link
                  href="/config/crm"
                  className="block px-3 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-sidebar-item-hover)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  Integracao CRM
                </Link>
                <Link
                  href="/config/agencia"
                  className="block px-3 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-sidebar-item-hover)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  Configuracoes
                </Link>
                <div className="border-t border-[var(--t-border)] mt-1 pt-1">
                  <button
                    onClick={logout}
                    className="w-full text-left px-3 py-2 text-[var(--text-body-sm)] text-red-400 hover:bg-red-400/10 flex items-center gap-2"
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

function getPillarDefaultRoute(pillar: Pillar): string {
  switch (pillar) {
    case 'planejamento': return '/cac/dashboard';
    case 'metas': return '/dashboard';
    case 'produtos': return '/grupos';
    case 'financeiro': return '/financeiro-ag';
  }
}
