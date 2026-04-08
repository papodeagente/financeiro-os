'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { PILLAR_MENUS } from './PillarSidebar';
import { Logo } from './Logo';
import { X } from 'lucide-react';

const PILLAR_DESCRIPTIONS: Record<Pillar, string> = {
  planejamento: 'Custos, CAC e cenários',
  metas: 'KPIs, metas e comissões',
  produtos: 'Grupos, propostas e vendas',
  financeiro: 'Contas, relatórios e CRM',
};

interface Props {
  /** Pilar cujo conteúdo deve aparecer no drawer. `null` = drawer fechado. */
  pillar: Pillar | null;
  /** Chamado ao fechar (link clicado, Esc, X, etc.) */
  onClose: () => void;
}

/**
 * Drawer flutuante de navegação. Substitui o antigo FeaturePanel-coluna.
 * Ancorado à direita do PillarRail (left: 80px), aparece sobre o conteúdo
 * sem empurrá-lo. O AppShell controla o `pillar` selecionado e cuida de
 * click-outside / Esc / mudança de rota → todos chamam `onClose`.
 *
 * Mantemos o nome do arquivo (FeaturePanel.tsx) por compatibilidade dos
 * imports já existentes; o componente exportado também segue como
 * `FeaturePanel` para minimizar churn.
 */
export function FeaturePanel({ pillar, onClose }: Props) {
  const pathname = usePathname();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  // Foca o primeiro link quando o drawer abre — facilita teclado/leitor de tela.
  useEffect(() => {
    if (pillar && firstLinkRef.current) {
      firstLinkRef.current.focus();
    }
  }, [pillar]);

  if (!pillar) return null;

  const sections = PILLAR_MENUS[pillar];
  const pillarConfig = PILLARS.find(p => p.id === pillar);
  const PillarIcon = pillarConfig?.icon;

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`Menu ${pillarConfig?.label ?? ''}`}
      data-pillar-drawer
      className="pillar-drawer absolute left-[80px] top-0 bottom-0 w-[280px] z-50 bg-[var(--t-surface)] border-r border-[var(--t-border)] shadow-[var(--elevation-3)] rounded-r-2xl flex flex-col overflow-hidden"
    >
      {/* Logo + close */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-2">
        <Logo variant="sidebar" href="/dashboard" />
        <button
          onClick={onClose}
          aria-label="Fechar menu"
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Header com contexto do pilar */}
      <div className="px-5 pb-4 border-b border-[var(--t-border)]">
        <div className="flex items-center gap-3">
          {PillarIcon && (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--t-primary-bg)' }}
            >
              <PillarIcon className="w-[18px] h-[18px] text-[var(--t-green)]" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-[var(--text-body)] font-semibold text-[var(--t-text)] tracking-tight leading-tight">
              {pillarConfig?.label}
            </h2>
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-0.5 leading-tight">
              {PILLAR_DESCRIPTIONS[pillar]}
            </p>
          </div>
        </div>
      </div>

      {/* Itens de navegação */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="feature-panel-content" key={pillar}>
          {sections.map((section, sIdx) => {
            // Determina se o primeiro <Link> deste mapa precisa do ref de foco.
            // Só o primeiríssimo link do drawer recebe.
            return (
              <div key={sIdx} className={sIdx > 0 ? 'mt-4' : 'mt-2'}>
                {section.title && (
                  <div className="flex items-center gap-2 px-3 mb-1.5">
                    <span className="flex-1 h-px bg-[var(--t-border)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--t-text-muted)]">
                      {section.title}
                    </span>
                    <span className="flex-1 h-px bg-[var(--t-border)]" />
                  </div>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item, iIdx) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    const isFirst = sIdx === 0 && iIdx === 0;
                    return (
                      <Link
                        key={item.key}
                        ref={isFirst ? firstLinkRef : undefined}
                        href={item.href}
                        onClick={onClose}
                        className={`flex items-center gap-3 px-3 py-2 text-[var(--text-body-sm)] rounded-xl transition-all duration-150 relative group ${
                          active
                            ? 'bg-gradient-to-r from-[var(--t-green)]/8 to-transparent text-[var(--t-green)] font-medium'
                            : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] hover:translate-x-0.5'
                        }`}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                            style={{ background: 'var(--t-accent-gradient)' }}
                          />
                        )}
                        <Icon
                          className={`w-4 h-4 shrink-0 transition-colors ${
                            active ? '' : 'text-[var(--t-text-muted)] group-hover:text-[var(--t-text-secondary)]'
                          }`}
                        />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
