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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
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
    <header className="h-[60px] bg-[var(--t-surface)]/85 backdrop-blur-xl border-b border-[var(--t-border)] flex items-center px-5 shrink-0 z-40">
      {/* Logo + Greeting */}
      <div className="flex items-center gap-3 mr-6 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[var(--t-green)] flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-sm">E</span>
          </div>
        </Link>
        {user && (
          <span className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hidden lg:inline">
            {getGreeting()}, <span className="text-[var(--t-text)] font-medium">{user.nome?.split(' ')[0]}</span>
          </span>
        )}
      </div>

      {/* Pillar pills */}
      <nav className="flex-1 flex items-center justify-center gap-1">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={getPillarDefaultRoute(pillar.id)}
              onClick={() => onPillarClick?.(pillar.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[var(--text-body-sm)] font-medium transition-all duration-150 ${
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

      {/* Utilities */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Command palette trigger */}
        <button
          onClick={onCommandPalette}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
          aria-label="Busca rápida"
          title="⌘K"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* CRM status */}
        <CrmStatusBadge variant="compacto" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
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
              <div className="w-8 h-8 rounded-full bg-[var(--t-green)]/15 flex items-center justify-center ring-2 ring-[var(--t-green)]/20">
                <span className="text-[11px] font-bold text-[var(--t-green)]">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[var(--t-text-muted)]" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-[20px] shadow-lg py-1.5 z-50">
                <div className="px-4 py-2.5 border-b border-[var(--t-border)]">
                  <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">{user.nome}</p>
                  <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{user.email}</p>
                </div>
                <Link
                  href="/config/crm"
                  className="block px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] rounded-lg mx-1.5 my-0.5"
                  onClick={() => setDropdownOpen(false)}
                >
                  Integração CRM
                </Link>
                <Link
                  href="/config/agencia"
                  className="block px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] rounded-lg mx-1.5 my-0.5"
                  onClick={() => setDropdownOpen(false)}
                >
                  Configurações
                </Link>
                <div className="border-t border-[var(--t-border)] mt-1 pt-1">
                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2 text-[var(--text-body-sm)] text-red-400 hover:bg-red-400/10 flex items-center gap-2 rounded-lg mx-1.5"
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
    case 'planejamento': return '/planejamento/custos';
    case 'metas': return '/dashboard';
    case 'produtos': return '/grupos';
    case 'financeiro': return '/financeiro-ag';
    case 'configuracoes': return '/config/agencia';
  }
}
