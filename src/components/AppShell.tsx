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
import { X } from 'lucide-react';
import { Logo } from './Logo';
import { useState, useEffect, useCallback } from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const activePillar = useActivePillar();
  const { markVisited } = usePillarProgress();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /**
   * Tela estreita.
   *
   * Abaixo de 768px a barra lateral vira GAVETA, não trilho de ícones.
   *
   * O trilho resolvia a largura — devolvia 319px ao conteúdo — mas ao custo de
   * 22 ícones sem rótulo ocupando 56px permanentes. Ícone sem nome só se lê
   * por tooltip, e tooltip não existe no toque: no celular a navegação ficava
   * literalmente adivinhável. A gaveta devolve os 56px E os nomes, e some
   * quando não está em uso, que é o padrão de telefone.
   */
  const [telaEstreita, setTelaEstreita] = useState(false);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const isMindMapImport = /^\/planejamento\/mapas-mentais\/importar\/[^/]+$/.test(pathname);

  // Persist sidebar state
  useEffect(() => {
    try {
      const saved = localStorage.getItem('entur:sidebar-collapsed');
      // Estado hidratado de uma preferência externa; efeito intencional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'true') setSidebarCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 767px)');
    const aplicar = () => {
      setTelaEstreita(consulta.matches);
      // Alargou: o trilho volta e a gaveta não tem mais razão de existir.
      // Deixá-la "aberta" em segundo plano faria ela ressurgir sozinha na
      // próxima vez que a janela encolhesse.
      if (!consulta.matches) setGavetaAberta(false);
    };
    aplicar();
    consulta.addEventListener('change', aplicar);
    return () => consulta.removeEventListener('change', aplicar);
  }, []);

  useEffect(() => {
    if (!gavetaAberta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setGavetaAberta(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [gavetaAberta]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('entur:sidebar-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Canal de controle externo: telas que precisam de mais espaco
  // (ex.: editor de proposta drag-and-drop) podem forcar o colapso da
  // sidebar via CustomEvent e restaurar no unmount. Nao persiste no
  // localStorage — preferencia do usuario fica intacta.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ collapsed: boolean }>).detail;
      if (detail && typeof detail.collapsed === 'boolean') {
        setSidebarCollapsed(detail.collapsed);
      }
    };
    window.addEventListener('entur:force-sidebar', handler);
    return () => window.removeEventListener('entur:force-sidebar', handler);
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
    if (
      pathname
      && pathname !== '/login'
      && !pathname.startsWith('/p/')
      && !pathname.startsWith('/mapas-mentais/publico/')
      && !isMindMapImport
    ) {
      try {
        const key = 'entur:recentes';
        const stored = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const filtered = stored.filter(p => p !== pathname);
        filtered.unshift(pathname);
        localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
      } catch { /* ignore */ }
    }
  }, [isMindMapImport, pathname]);

  // Login page, signup, landing page, public proposal preview, admin
  // e iframe de preview no editor — sem shell (sao paginas publicas
  // ou sem header/sidebar).
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/mapas-mentais/publico/') ||
    pathname.startsWith('/admin') ||
    pathname === '/preview-iframe'
  ) {
    return <>{children}</>;
  }

  // Fluxograma editor — fullscreen canvas
  if (/^\/planejamento\/fluxogramas\/[^/]+$/.test(pathname)) {
    return <>{children}</>;
  }

  // Funil editor — fullscreen canvas
  if (/^\/planejamento\/funis\/[^/]+$/.test(pathname)) {
    return <>{children}</>;
  }

  // Loading session
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="size-8 animate-spin rounded-full border-2 border-[var(--fin-accent)] border-t-transparent" />
      </div>
    );
  }

  // Build breadcrumb trail
  // O último segmento da importação é um bearer token: ele não deve aparecer
  // no breadcrumb nem ser gravado no histórico local de páginas recentes.
  const trail = buildTrail(
    isMindMapImport ? '/planejamento/mapas-mentais/importar' : pathname,
    isMindMapImport ? 'Importar mapa' : undefined,
  );
  const breadcrumbNode = trail.length ? <Breadcrumbs trail={trail} /> : undefined;

  // Rotas que precisam de altura fixa (editor com layout flex de 3 colunas
  // e scroll interno no canvas, pra que paineis laterais fiquem visualmente
  // sticky enquanto a proposta scrolla). Default das demais paginas continua
  // sendo height auto -> scroll no <main> (comportamento atual preservado).
  const needsFixedHeight = pathname
    ? /^\/propostas\/(nova|[^/]+)$/.test(pathname)
      || /^\/planejamento\/mapas-mentais\/[^/]+$/.test(pathname)
    : false;

  return (
    <div className="flex flex-col h-full w-full overflow-x-hidden">
      <ImpersonationBanner />
      <RouteProgress />
      <TopBar
        onCommandPalette={() => setCommandPaletteOpen(true)}
        breadcrumb={breadcrumbNode}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onAbrirMenu={() => setGavetaAberta(true)}
      />
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Largo: trilho fixo, recolhível. Estreito: nada aqui — a navegação
            mora na gaveta, sobreposta, e o conteúdo usa a largura inteira. */}
        {!telaEstreita && (
          <PillarSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        )}
        <main className="min-shell min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--fin-bg)]">
          <div className={`content-enter ${needsFixedHeight ? 'h-full' : ''}`}>
            {children}
          </div>
        </main>
      </div>
      {telaEstreita && gavetaAberta && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden="true"
            onClick={() => setGavetaAberta(false)}
            className="absolute inset-0 bg-[rgba(16,24,40,0.32)] motion-safe:animate-[fadeIn_140ms_ease-out]"
          />
          <div
            onClick={e => {
              if ((e.target as HTMLElement).closest('a')) setGavetaAberta(false);
            }}
            className="absolute inset-y-0 left-0 flex w-[276px] max-w-[86vw] flex-col bg-[var(--fin-surface-2)] motion-safe:animate-[slideInLeft_180ms_ease-out]"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--fin-border)] pl-3 pr-2">
              <Logo variant="sidebar" href="/dashboard" />
              <button
                type="button"
                onClick={() => setGavetaAberta(false)}
                aria-label="Fechar menu"
                className="inline-flex size-9 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] transition-colors hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]"
              >
                <X className="size-[18px]" />
              </button>
            </div>
            <PillarSidebar collapsed={false} comSeletorDePilar />
          </div>
        </div>
      )}

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
