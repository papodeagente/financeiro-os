'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar } from '@/hooks/useActivePillar';
import { TopBar } from './TopBar';
import { PillarSidebar } from './PillarSidebar';
import { CommandPalette } from './CommandPalette';
import { ImpersonationBanner } from './ImpersonationBanner';
import { Breadcrumbs } from './Breadcrumbs';
import { RouteProgress } from './RouteProgress';
import { buildTrail } from '@/lib/breadcrumbs';
import { usePillarProgress } from '@/hooks/usePillarProgress';
import { useState, useEffect, useCallback } from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const activePillar = useActivePillar();
  const { markVisited } = usePillarProgress();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Persist sidebar state
  useEffect(() => {
    try {
      const saved = localStorage.getItem('entur:sidebar-collapsed');
      if (saved === 'true') setSidebarCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('entur:sidebar-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(prev => !prev);
    }
    // Ctrl+B to toggle sidebar (VS Code shortcut)
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  }, [toggleSidebar]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Track pillar progress
  useEffect(() => {
    if (activePillar) markVisited(activePillar);
  }, [activePillar, markVisited]);

  // Track recent pages
  useEffect(() => {
    if (pathname && pathname !== '/login' && !pathname.startsWith('/p/')) {
      try {
        const key = 'entur:recentes';
        const stored = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const filtered = stored.filter(p => p !== pathname);
        filtered.unshift(pathname);
        localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
      } catch { /* ignore */ }
    }
  }, [pathname]);

  // Login page and public proposal preview — no shell
  if (pathname === '/login' || pathname.startsWith('/p/') || pathname.startsWith('/admin')) {
    return <>{children}</>;
  }

  // Fluxograma editor — fullscreen canvas
  if (/^\/planejamento\/fluxogramas\/[^/]+$/.test(pathname)) {
    return <>{children}</>;
  }

  // Loading session
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Build breadcrumb trail
  const trail = buildTrail(pathname);
  const breadcrumbNode = trail.length ? <Breadcrumbs trail={trail} /> : undefined;

  return (
    <div className="flex flex-col h-full">
      <ImpersonationBanner />
      <RouteProgress />
      <TopBar
        onCommandPalette={() => setCommandPaletteOpen(true)}
        breadcrumb={breadcrumbNode}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <div className="flex flex-1 overflow-hidden">
        <PillarSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <main className="flex-1 overflow-y-auto bg-[var(--t-bg)]">
          <div className="content-enter">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
