'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { CrmStatusBadge } from './CrmStatusBadge';
import { Sun, Moon, Search, LogOut, ChevronDown, Settings } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface Props {
  onCommandPalette?: () => void;
  breadcrumb?: React.ReactNode;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function TopBar({ onCommandPalette, breadcrumb }: Props) {
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
    <header className="h-[52px] bg-[var(--t-surface)] border-b border-[var(--t-border)] flex items-center px-6 shrink-0 z-30">
      {/* Breadcrumb / Greeting */}
      <div className="flex-1 min-w-0">
        {breadcrumb || (
          user && (
            <span className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">
              {getGreeting()}, <span className="text-[var(--t-text)] font-medium">{user.nome?.split(' ')[0]}</span>
            </span>
          )
        )}
      </div>

      {/* Utilities */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Search trigger */}
        <button
          onClick={onCommandPalette}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--t-bg)] text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors text-[var(--text-body-sm)]"
          title="⌘K"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Buscar...</span>
          <kbd className="hidden lg:inline text-[10px] text-[var(--t-text-muted)] bg-[var(--t-surface)] px-1.5 py-0.5 rounded ml-2">⌘K</kbd>
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
              className="flex items-center gap-2 ml-1 px-2 py-1.5 rounded-xl hover:bg-[var(--t-surface-hover)] transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--t-green)]/12 flex items-center justify-center ring-2 ring-[var(--t-green)]/20">
                <span className="text-[11px] font-bold text-[var(--t-green)]">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[var(--t-text-muted)]" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl shadow-lg py-1.5 z-50">
                <div className="px-4 py-3 border-b border-[var(--t-border)]">
                  <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">{user.nome}</p>
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{user.email}</p>
                </div>
                <Link
                  href="/config/crm"
                  className="flex items-center gap-2 px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] mx-1.5 my-0.5 rounded-lg"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Integração CRM
                </Link>
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
