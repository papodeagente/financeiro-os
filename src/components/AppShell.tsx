'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar } from '@/hooks/useActivePillar';
import { PillarRail } from './PillarRail';
import { FeaturePanel } from './FeaturePanel';
import { TopBar } from './TopBar';
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(prev => !prev);
    }
  }, []);

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

  // Loading session
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Build breadcrumb trail (navegável)
  const trail = buildTrail(pathname);
  const breadcrumbNode = trail.length ? <Breadcrumbs trail={trail} /> : undefined;

  return (
    <div className="flex flex-col h-full">
      <ImpersonationBanner />
      <RouteProgress />
      <div className="flex flex-1 min-h-0">
      {/* Column 1: Pillar Rail (80px) */}
      <PillarRail />

      {/* Column 2: Feature Panel (240px) */}
      <FeaturePanel />

      {/* Column 3: Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <TopBar
          onCommandPalette={() => setCommandPaletteOpen(true)}
          breadcrumb={breadcrumbNode}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-[var(--t-bg)]">
          <div className="content-enter">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      </div>
    </div>
  );
}
