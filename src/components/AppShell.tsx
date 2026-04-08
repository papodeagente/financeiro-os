'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar } from '@/hooks/useActivePillar';
import type { Pillar } from '@/hooks/useActivePillar';
import { PillarRail } from './PillarRail';
import { FeaturePanel } from './FeaturePanel';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { ImpersonationBanner } from './ImpersonationBanner';
import { Breadcrumbs } from './Breadcrumbs';
import { RouteProgress } from './RouteProgress';
import { buildTrail } from '@/lib/breadcrumbs';
import { usePillarProgress } from '@/hooks/usePillarProgress';
import { useState, useEffect, useCallback, useRef } from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const activePillar = useActivePillar();
  const { markVisited } = usePillarProgress();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [openPillar, setOpenPillar] = useState<Pillar | null>(null);

  const closeDrawer = useCallback(() => setOpenPillar(null), []);

  const togglePillar = useCallback((pillar: Pillar) => {
    setOpenPillar(prev => (prev === pillar ? null : pillar));
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpenPillar(null); // abrir paleta fecha drawer
      setCommandPaletteOpen(prev => !prev);
      return;
    }
    if (e.key === 'Escape' && openPillar) {
      e.preventDefault();
      setOpenPillar(null);
    }
  }, [openPillar]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Click-outside: fecha drawer se o clique não foi nele nem no rail.
  useEffect(() => {
    if (!openPillar) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-pillar-drawer]')) return;
      if (target.closest('[data-pillar-rail]')) return;
      setOpenPillar(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openPillar]);

  // Fecha drawer ao mudar de rota (cobre nav via paleta, breadcrumbs, etc).
  // Comparamos via ref para só chamar setState quando a rota muda DE FATO,
  // evitando set redundante no mount inicial.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      // setState(null) é idempotente; o lint reclama mas não há cascading render real.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenPillar(null);
    }
  }, [pathname]);

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

  // Fluxograma editor — fullscreen canvas (sem PillarRail/FeaturePanel/TopBar)
  // A listagem (/planejamento/fluxogramas) continua dentro do shell padrão.
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

  // Build breadcrumb trail (navegável)
  const trail = buildTrail(pathname);
  const breadcrumbNode = trail.length ? <Breadcrumbs trail={trail} /> : undefined;

  return (
    <div className="flex flex-col h-full">
      <ImpersonationBanner />
      <RouteProgress />
      <div className="flex flex-1 min-h-0 relative">
        {/* Column 1: Pillar Rail (80px) — único elemento de navegação fixo */}
        <PillarRail openPillar={openPillar} onPillarToggle={togglePillar} />

        {/* Drawer flutuante: aparece sobre o conteúdo, ancorado ao rail */}
        <FeaturePanel pillar={openPillar} onClose={closeDrawer} />

        {/* Column 2: Content area (ganhou os 240px que eram do FeaturePanel) */}
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            onCommandPalette={() => setCommandPaletteOpen(true)}
            breadcrumb={breadcrumbNode}
          />

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
