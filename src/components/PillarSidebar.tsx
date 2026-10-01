'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, PILLARS as PILARES_DO_MENU, type Pillar } from '@/hooks/useActivePillar';

/** Mesma tabela da barra de cima: a gaveta e o topo abrem a mesma porta. */
const ROTA_DO_PILAR: Record<Pillar, string> = {
  planejamento: '/planejamento/custos',
  metas: '/dashboard',
  financeiro: '/financeiro-ag',
  configuracoes: '/config/agencia',
};
import {
  Wallet, Gauge,
  Wallet2,
  ShoppingBag,
  LayoutDashboard, Medal, Percent, Settings, UserCheck,
  BarChart3,
  BarChart3 as FluxoIcon, FileSpreadsheet, Receipt, CreditCard,
  BookOpen, Landmark, ArrowRightLeft, Package,
  ListOrdered, UserPlus, Building2, Briefcase,
  DollarSign, TrendingUp as RentIcon, Link2,
  GitBranch as MindIcon,
  Users, ClipboardList,
  PanelLeftClose, PanelLeftOpen,
  Eraser, LifeBuoy, FileText,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export interface SidebarItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

export interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const PLANEJAMENTO_MENU: SidebarSection[] = [
  {
    title: 'Planejamento',
    items: [
      { key: 'custos-negocio', label: 'Custos do negócio', icon: Wallet, href: '/planejamento/custos' },
      { key: 'mapas-mentais', label: 'Mapa mental', icon: MindIcon, href: '/planejamento/mapas-mentais' },
    ],
  },
];

const METAS_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'dashboard-kpi', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
      { key: 'metas-ranking', label: 'Metas da equipe', icon: Medal, href: '/equipe/metas' },
    ],
  },
  {
    title: 'Equipe',
    items: [
      { key: 'comissoes', label: 'Comissões', icon: Percent, href: '/equipe/comissoes' },
      { key: 'vendedores', label: 'Vendedores e planos', icon: UserCheck, href: '/equipe/vendedores' },
      { key: 'folha', label: 'Folha', icon: Wallet2, href: '/equipe/folha' },
      { key: 'planos-comissao', label: 'Planos de comissão', icon: Settings, href: '/equipe/planos-comissao' },
    ],
  },
];

const FINANCEIRO_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'fin-hub', label: 'Visão geral', icon: FluxoIcon, href: '/financeiro-ag' },
      { key: 'fluxo-caixa', label: 'Fluxo de caixa', icon: FluxoIcon, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'DRE', icon: FileSpreadsheet, href: '/financeiro-ag/dre' },
      { key: 'receber', label: 'Contas a receber', icon: Receipt, href: '/financeiro-ag/receber' },
      { key: 'recebimentos-plataformas', label: 'Recebimentos', icon: Receipt, href: '/financeiro-ag/recebimentos' },
      { key: 'pagar', label: 'Contas a pagar', icon: CreditCard, href: '/financeiro-ag/pagar' },
      { key: 'notas-fiscais', label: 'Notas fiscais', icon: FileText, href: '/financeiro-ag/notas' },
      { key: 'conciliacao', label: 'Conciliação', icon: FileSpreadsheet, href: '/financeiro-ag/conciliacao' },
      { key: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
      { key: 'plano-contas', label: 'Plano de contas', icon: BookOpen, href: '/financeiro-ag/plano-contas' },
      { key: 'contas-bancarias', label: 'Contas bancárias', icon: Landmark, href: '/financeiro-ag/contas-bancarias' },
      { key: 'cartoes-corp', label: 'Cartões', icon: CreditCard, href: '/financeiro-ag/cartoes' },
    ],
  },
  {
    title: 'Produtos e vendas',
    items: [
      { key: 'fin-grupos', label: 'Por produto', icon: Package, href: '/financeiro-grupos' },
      { key: 'lista-vendas', label: 'Vendas fechadas', icon: ListOrdered, href: '/vendas' },
    ],
  },
  {
    title: 'Pessoas',
    items: [
      { key: 'clientes', label: 'Clientes', icon: UserPlus, href: '/pessoas/clientes' },
      { key: 'fornecedores', label: 'Fornecedores', icon: Building2, href: '/pessoas/fornecedores' },
      { key: 'equipe', label: 'Equipe', icon: Briefcase, href: '/equipe/vendedores' },
    ],
  },
  {
    title: 'Relatórios',
    items: [
      { key: 'rel-financeiro', label: 'Relatórios', icon: DollarSign, href: '/relatorios/financeiro' },
      { key: 'rel-lucro-real', label: 'Lucro real', icon: Wallet, href: '/relatorios/lucro-real' },
      { key: 'rel-rentabilidade', label: 'Rentabilidade', icon: RentIcon, href: '/relatorios/rentabilidade' },
      { key: 'rel-comparativo', label: 'Comparativo mensal', icon: BarChart3, href: '/relatorios/comparativo' },
      { key: 'rel-taxas', label: 'Taxas de pagamento', icon: Percent, href: '/relatorios/taxas' },
      { key: 'cac-dashboard', label: 'Dashboard CAC', icon: Gauge, href: '/cac/dashboard' },
    ],
  },
];

const CONFIGURACOES_MENU: SidebarSection[] = [
  {
    title: 'Geral',
    items: [
      { key: 'cfg-agencia', label: 'Dados da agência', icon: Building2, href: '/config/agencia' },
      { key: 'cfg-usuarios', label: 'Usuários', icon: Users, href: '/config/usuarios' },
    ],
  },
  {
    title: 'Integrações',
    items: [
      // Uma entrada só. CRM, nota fiscal e IA estão dentro, cada um com a
      // sua página — três linhas de menu para três telas parecidas era o
      // que fazia ninguém achar nada.
      { key: 'cfg-plataformas', label: 'Plataformas de venda', icon: ShoppingBag, href: '/config/plataformas' },
      { key: 'cfg-integracoes', label: 'Integrações', icon: Link2, href: '/config/integracoes' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { key: 'cfg-suporte', label: 'Suporte', icon: LifeBuoy, href: '/suporte' },
      { key: 'cfg-auditoria', label: 'Auditoria', icon: ClipboardList, href: '/config/auditoria' },
      { key: 'cfg-reset', label: 'Resetar dados', icon: Eraser, href: '/config/reset' },
    ],
  },
];

export const PILLAR_MENUS: Record<Pillar, SidebarSection[]> = {
  planejamento: PLANEJAMENTO_MENU,
  metas: METAS_MENU,
  financeiro: FINANCEIRO_MENU,
  configuracoes: CONFIGURACOES_MENU,
};

interface PillarSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  /**
   * Na gaveta do celular o trilho também carrega a troca de pilar, que no
   * desktop mora na barra de cima. Sem isto a gaveta mostraria as páginas de
   * um pilar sem oferecer caminho para os outros três.
   */
  comSeletorDePilar?: boolean;
}

export function PillarSidebar({ collapsed = false, onToggle, comSeletorDePilar = false }: PillarSidebarProps) {
  const pathname = usePathname();
  const activePillar = useActivePillar();

  if (!activePillar) return null;

  const sections = PILLAR_MENUS[activePillar];

  const isActive = (href: string) => {
    if (href === '/vendas' && pathname === '/vendas') return true;
    if (href === '/propostas' && pathname === '/propostas') return true;
    if (href === '/grupos' && (pathname === '/grupos' || pathname === '/')) return true;
    if (href === '/financeiro-ag' && pathname === '/financeiro-ag') return true;
    return pathname === href || (pathname.startsWith(href + '/') && href !== '/');
  };

  return (
    <TooltipProvider delay={collapsed ? 100 : 600}>
      {/* O trilho é RECUADO, não uma folha branca: fica um degrau abaixo da
          tela (--fin-surface-2), a tela fica em --fin-bg e os cartões em
          branco. Três níveis de elevação numa ordem só, em vez de duas folhas
          brancas disputando a atenção com uma borda entre elas. */}
      <aside
        className={`flex shrink-0 flex-col overflow-hidden border-r border-[var(--fin-border)] bg-[var(--fin-surface-2)] transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[56px]' : 'w-[232px]'
        }`}
      >
        {/* min-h-0 é o que faz o scroll acontecer AQUI e não empurrar o rodapé
            para fora: sem ele o botão de recolher subia por cima do último
            item da lista. */}
        {comSeletorDePilar && (
          <div className="shrink-0 border-b border-[var(--fin-border)] p-2">
            {PILARES_DO_MENU.map(pilar => {
              const Icone = pilar.icon;
              const selecionado = activePillar === pilar.id;
              return (
                <Link
                  key={pilar.id}
                  href={ROTA_DO_PILAR[pilar.id]}
                  aria-current={selecionado ? 'page' : undefined}
                  className={[
                    'flex h-9 items-center gap-2.5 rounded-[var(--fin-r-md)] px-3 fin-t-body transition-colors',
                    selecionado
                      ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
                      : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface)]',
                  ].join(' ')}
                >
                  <Icone className="size-[18px] shrink-0" />
                  <span className="truncate">{pilar.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="sidebar-content" key={activePillar}>
            {sections.map((section, sIdx) => (
              <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
                {section.title && !collapsed && (
                  <div className="fin-t-overline px-3 pb-1.5 pt-4 text-[var(--fin-text-3)]">
                    {section.title}
                  </div>
                )}
                {section.title && collapsed && (
                  <div className="mx-2 mb-1.5 mt-1.5 h-px bg-[var(--fin-border)]" />
                )}
                <div className="space-y-px">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const active = isActive(item.href);

                    const linkContent = (
                      <Link
                        key={item.key}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'sidebar-item flex h-9 items-center gap-2.5 rounded-[var(--fin-r-md)] px-3',
                          'fin-t-body transition-colors duration-150',
                          'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
                          active
                            ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
                            : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)]',
                        ].join(' ')}
                      >
                        <Icon className="size-[18px] shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.key}>
                          <TooltipTrigger
                            render={
                              <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={[
                                  'sidebar-item relative mx-auto flex size-9 items-center justify-center rounded-[var(--fin-r-md)]',
                                  'transition-colors duration-150',
                                  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
                                  active
                                    ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
                                    : 'text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)]',
                                ].join(' ')}
                              />
                            }
                          >
                            <Icon className="size-[18px] shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return linkContent;
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Na gaveta não há o que recolher: ela já some ao fechar. */}
        {onToggle && (
        <>
        {/* shrink-0 mantém o rodapé fora da rolagem: com a lista mais alta que
            a janela ele era empurrado e cobria o último item do menu. */}
        <div className="shrink-0 border-t border-[var(--fin-border)] px-2 py-2">
          <button
            onClick={onToggle}
            className={[
              'sidebar-item flex h-9 items-center rounded-[var(--fin-r-md)] transition-colors duration-150',
              'text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)]',
              'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
              collapsed ? 'mx-auto w-9 justify-center' : 'w-full gap-2.5 px-3',
            ].join(' ')}
            title={collapsed ? 'Expandir menu (Ctrl+B)' : 'Recolher menu (Ctrl+B)'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed
              ? <PanelLeftOpen className="size-[18px]" />
              : <><PanelLeftClose className="size-[18px] shrink-0" /><span className="fin-t-caption">Recolher</span></>
            }
          </button>
        </div>
        </>
        )}
      </aside>
    </TooltipProvider>
  );
}
