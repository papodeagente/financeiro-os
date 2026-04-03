'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { Sun, Moon, Settings, LogOut } from 'lucide-react';

interface Props {
  onPillarClick?: (pillar: Pillar) => void;
}

export function TopRail({ onPillarClick }: Props) {
  const activePillar = useActivePillar();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="h-12 bg-[var(--t-sidebar-bg)] border-b border-[var(--t-border)] flex items-center px-4 shrink-0 z-40">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-2 mr-8 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[var(--t-green)] flex items-center justify-center">
          <span className="text-white font-bold text-xs dark:text-[#0a0a14]">E</span>
        </div>
        <div className="hidden sm:block">
          <span className="text-[13px] font-semibold text-[var(--t-text)] tracking-tight">
            Entur <span className="text-[var(--t-green)]">OS</span>
          </span>
        </div>
      </Link>

      {/* Pillar pills — centered */}
      <nav className="flex-1 flex items-center justify-center gap-1">
        {PILLARS.map(pillar => {
          const Icon = pillar.icon;
          const isActive = activePillar === pillar.id;

          return (
            <Link
              key={pillar.id}
              href={getPillarDefaultRoute(pillar.id)}
              onClick={() => onPillarClick?.(pillar.id)}
              className={`relative flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                isActive
                  ? 'text-[var(--t-text)]'
                  : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{pillar.label}</span>
              {/* Active indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[var(--t-green)] rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Utilities */}
      <div className="flex items-center gap-1 shrink-0">
        <Link
          href="/config"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
        >
          <Settings className="w-4 h-4" />
        </Link>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-sidebar-item-hover)] transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {user && (
          <div className="flex items-center gap-1 ml-1">
            <div className="w-7 h-7 rounded-full bg-[var(--t-green)]/20 flex items-center justify-center">
              <span className="text-[10px] font-bold text-[var(--t-green)]">
                {user.nome?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <button
              onClick={logout}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
              title="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
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
    case 'financeiro': return '/financeiro-ag/fluxo-caixa';
  }
}
