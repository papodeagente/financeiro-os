'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { CrmStatusBadge } from './CrmStatusBadge';
import { NotificacoesBell } from './NotificacoesBell';
import { Logo } from './Logo';
import { Sun, Moon, Search, LogOut, ChevronDown, Settings, User as UserIcon } from 'lucide-react';
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
    case 'financeiro': return '/financeiro-ag';
    case 'configuracoes': return '/config/agencia';
  }
}

export function TopBar({ onCommandPalette }: Props) {
  const activePillar = useActivePillar();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Calcula posição do dropdown a partir do botão ao abrir — necessário
  // porque o <header> tem overflow-hidden e clipava o menu antes.
  // Render via portal pro body escapa esse clipping.
  useEffect(() => {
    if (!dropdownOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [dropdownOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(t)
        && dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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

        {/* User dropdown — botão; menu renderizado via portal pra
            escapar do overflow-hidden do <header> */}
        {user && (
          <button
            ref={triggerRef}
            onClick={() => setDropdownOpen(s => !s)}
            className="flex items-center gap-1.5 ml-0.5 px-1.5 py-1 rounded-xl hover:bg-[var(--t-surface-hover)] transition-colors shrink-0"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
          >
            {user.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.foto}
                alt={user.nome}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-offset-1 ring-[var(--t-green)]/20 ring-offset-[var(--t-surface)]"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-offset-1 ring-[var(--t-green)]/20 ring-offset-[var(--t-surface)]"
                style={{ background: 'var(--t-accent-gradient)' }}
              >
                <span className="text-[11px] font-bold text-white">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
            )}
            <ChevronDown className={`w-3 h-3 text-[var(--t-text-muted)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Menu via portal — fica fora do header pra escapar overflow */}
      {mounted && user && dropdownOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          role="menu"
          className="fixed w-60 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl shadow-2xl py-1.5 z-[100] dropdown-enter"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div className="px-4 py-3 border-b border-[var(--t-border)] flex items-center gap-3">
            {user.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.foto} alt={user.nome} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'var(--t-accent-gradient)' }}
              >
                <span className="text-sm font-bold text-white">
                  {user.nome?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--t-text)] truncate">{user.nome}</p>
              <p className="text-[11px] text-[var(--t-text-muted)] truncate">{user.email}</p>
            </div>
          </div>
          <Link
            href="/perfil"
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] mx-1.5 my-0.5 rounded-lg"
            onClick={() => setDropdownOpen(false)}
            role="menuitem"
          >
            <UserIcon className="w-3.5 h-3.5" />
            <div className="flex-1">
              <div className="font-medium text-[var(--t-text)]">Meu perfil</div>
              <div className="text-[10px] text-[var(--t-text-muted)]">Foto, nome, telefone</div>
            </div>
          </Link>
          <Link
            href="/config/agencia"
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] mx-1.5 my-0.5 rounded-lg"
            onClick={() => setDropdownOpen(false)}
            role="menuitem"
          >
            <Settings className="w-3.5 h-3.5" />
            <div className="flex-1">
              <div className="font-medium text-[var(--t-text)]">Configurações</div>
              <div className="text-[10px] text-[var(--t-text-muted)]">Agência, usuários, integrações</div>
            </div>
          </Link>
          <div className="border-t border-[var(--t-border)] mt-1 pt-1">
            <button
              onClick={() => { setDropdownOpen(false); logout(); }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 mx-1.5 rounded-lg"
              role="menuitem"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="font-medium">Sair</span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}
